import { createGeotabClient } from './geotab-client';
import type { GeotabEnv } from './geotab';
import { YARD_DEFINITIONS, type YardKey, type YardSelection } from './yards';

type JsonRecord = Record<string, unknown>;
type Client = Awaited<ReturnType<typeof createGeotabClient>>;
type Position = { deviceId: string; latitude: number; longitude: number; dateTime: string };
type Point = { x: number; y: number };
type YardZone = { name: string; points: Point[] };
type YardCounts = Record<YardKey, number>;
type YardZoneFound = Record<YardKey, boolean>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function get(source: JsonRecord, ...names: string[]) {
  for (const name of names) if (name in source) return source[name];
  return undefined;
}

function objectId(value: unknown) {
  return text(get(record(value), 'id', 'Id')).trim();
}

function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function dateValue(value: unknown) {
  const raw = text(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentZone(zone: JsonRecord, now = Date.now()) {
  const activeFrom = dateValue(get(zone, 'activeFrom', 'ActiveFrom'));
  const activeTo = dateValue(get(zone, 'activeTo', 'ActiveTo'));
  return (activeFrom == null || activeFrom <= now) && (activeTo == null || activeTo > now);
}

function zonePoints(zone: JsonRecord): Point[] {
  const points: Point[] = [];
  for (const raw of array(get(zone, 'points', 'Points'))) {
    const x = number(get(raw, 'x', 'X'));
    const y = number(get(raw, 'y', 'Y'));
    if (x != null && y != null) points.push({ x, y });
  }
  return points;
}

function findYardZone(zones: JsonRecord[], expectedName: string): YardZone | null {
  const normalized = expectedName.toLowerCase();
  const match = zones.find((zone) => currentZone(zone) && text(get(zone, 'name', 'Name')).trim().toLowerCase() === normalized);
  if (!match) return null;
  const points = zonePoints(match);
  if (points.length < 3) return null;
  return { name: text(get(match, 'name', 'Name')).trim() || expectedName, points };
}

function pointInPolygon(longitude: number, latitude: number, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const crosses = (yi > latitude) !== (yj > latitude)
      && longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

async function currentPositions(client: Client): Promise<Position[]> {
  const statuses = await client.call<JsonRecord[]>('Get', { typeName: 'DeviceStatusInfo' });
  const positions: Position[] = [];
  for (const status of statuses) {
    const deviceId = objectId(get(status, 'device', 'Device')) || objectId(status);
    const latitude = number(get(status, 'latitude', 'Latitude'));
    const longitude = number(get(status, 'longitude', 'Longitude'));
    if (!deviceId || latitude == null || longitude == null) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    positions.push({
      deviceId,
      latitude,
      longitude,
      dateTime: text(get(status, 'dateTime', 'DateTime')).trim(),
    });
  }
  return positions;
}

async function writeSyncState(env: GeotabEnv, state: {
  status: string;
  message: string;
  positions: number;
  counts: YardCounts;
  outside: number;
  zoneFound: YardZoneFound;
}) {
  await env.DB.prepare(`
    INSERT INTO geotab_yard_sync_state (
      id,status,message,positions,clare,cadillac,gr,taylor,boyne,outside,
      clare_zone_found,cadillac_zone_found,gr_zone_found,taylor_zone_found,boyne_zone_found,updated_at
    ) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      message=excluded.message,
      positions=excluded.positions,
      clare=excluded.clare,
      cadillac=excluded.cadillac,
      gr=excluded.gr,
      taylor=excluded.taylor,
      boyne=excluded.boyne,
      outside=excluded.outside,
      clare_zone_found=excluded.clare_zone_found,
      cadillac_zone_found=excluded.cadillac_zone_found,
      gr_zone_found=excluded.gr_zone_found,
      taylor_zone_found=excluded.taylor_zone_found,
      boyne_zone_found=excluded.boyne_zone_found,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    state.status,
    state.message,
    state.positions,
    state.counts.clare,
    state.counts.cadillac,
    state.counts.gr,
    state.counts.taylor,
    state.counts.boyne,
    state.outside,
    state.zoneFound.clare ? 1 : 0,
    state.zoneFound.cadillac ? 1 : 0,
    state.zoneFound.gr ? 1 : 0,
    state.zoneFound.taylor ? 1 : 0,
    state.zoneFound.boyne ? 1 : 0,
  ).run();
}

export async function syncGeotabYardPresence(env: GeotabEnv) {
  try {
    const client = await createGeotabClient(env);
    const [positions, zones] = await Promise.all([
      currentPositions(client),
      client.call<JsonRecord[]>('Get', { typeName: 'Zone' }),
    ]);

    const yardZones = new Map<YardKey, YardZone | null>(
      YARD_DEFINITIONS.map((definition) => [definition.key, findYardZone(zones, definition.zoneName)]),
    );
    const counts = Object.fromEntries(YARD_DEFINITIONS.map((definition) => [definition.key, 0])) as YardCounts;
    const zoneFound = Object.fromEntries(
      YARD_DEFINITIONS.map((definition) => [definition.key, Boolean(yardZones.get(definition.key))]),
    ) as YardZoneFound;
    const statements: D1PreparedStatement[] = [];
    let outside = 0;

    for (const position of positions) {
      let currentYard: YardSelection = '';
      let zoneName = '';
      const matchedDefinition = YARD_DEFINITIONS.find((definition) => {
        const zone = yardZones.get(definition.key);
        return Boolean(zone && pointInPolygon(position.longitude, position.latitude, zone.points));
      });
      if (matchedDefinition) {
        const zone = yardZones.get(matchedDefinition.key)!;
        currentYard = matchedDefinition.key;
        zoneName = zone.name;
        counts[matchedDefinition.key] += 1;
      } else {
        outside += 1;
      }

      statements.push(env.DB.prepare(`
        UPDATE equipment
        SET geotab_latitude = ?,
            geotab_longitude = ?,
            geotab_position_at = NULLIF(?, ''),
            current_yard = ?,
            current_yard_zone = ?,
            yard_updated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE active = 1 AND geotab_device_id = ?
      `).bind(position.latitude, position.longitude, position.dateTime, currentYard, zoneName, position.deviceId));
    }

    await env.DB.prepare(`
      UPDATE equipment
      SET current_yard = '', current_yard_zone = '', yard_updated_at = CURRENT_TIMESTAMP
      WHERE active = 1 AND geotab_device_id IS NOT NULL AND TRIM(geotab_device_id) <> ''
    `).run();

    for (let index = 0; index < statements.length; index += 75) {
      await env.DB.batch(statements.slice(index, index + 75));
    }

    const missing = YARD_DEFINITIONS
      .filter((definition) => !yardZones.get(definition.key))
      .map((definition) => definition.zoneName);
    const status = missing.length ? 'warning' : 'ok';
    const message = missing.length
      ? `Geotab connected, but these yard zones were not found exactly: ${missing.join(', ')}.`
      : `Geotab yard check completed using zones ${YARD_DEFINITIONS.map((definition) => yardZones.get(definition.key)!.name).join(', ')}.`;

    await writeSyncState(env, {
      status,
      message,
      positions: positions.length,
      counts,
      outside,
      zoneFound,
    });

    return {
      ok: status === 'ok',
      status,
      message,
      positions: positions.length,
      clare: counts.clare,
      cadillac: counts.cadillac,
      gr: counts.gr,
      taylor: counts.taylor,
      boyne: counts.boyne,
      outside,
      clareZoneFound: zoneFound.clare,
      cadillacZoneFound: zoneFound.cadillac,
      grZoneFound: zoneFound.gr,
      taylorZoneFound: zoneFound.taylor,
      boyneZoneFound: zoneFound.boyne,
      clareZoneName: yardZones.get('clare')?.name ?? '',
      cadillacZoneName: yardZones.get('cadillac')?.name ?? '',
      grZoneName: yardZones.get('gr')?.name ?? '',
      taylorZoneName: yardZones.get('taylor')?.name ?? '',
      boyneZoneName: yardZones.get('boyne')?.name ?? '',
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await writeSyncState(env, {
        status: 'error',
        message,
        positions: 0,
        counts: { clare: 0, cadillac: 0, gr: 0, taylor: 0, boyne: 0 },
        outside: 0,
        zoneFound: { clare: false, cadillac: false, gr: false, taylor: false, boyne: false },
      });
    } catch (stateError) {
      console.error(JSON.stringify({ event: 'geotab_yard_sync_state_failed', error: String(stateError) }));
    }
    throw error;
  }
}
