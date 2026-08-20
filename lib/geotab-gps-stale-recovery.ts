import {
  createGeotabClient,
  geotabArray,
  geotabGet,
  geotabObjectId,
  geotabRecord,
  geotabText,
  type GeotabClientEnv,
  type GeotabJsonRecord,
} from './geotab-client';
import { YARD_DEFINITIONS, type YardKey, type YardSelection } from './yards';

type Env = GeotabClientEnv & { DB: D1Database };
type Point = { x: number; y: number };
type YardZone = { key: YardKey; id: string; name: string; points: Point[] };
type TargetRow = {
  equipment_id: number;
  unit: string;
  equipment_type: string;
  geotab_device_id: string;
  latitude: number | null;
  longitude: number | null;
  gps_observed_at: string | null;
  gps_received_at: string | null;
  gps_source: string | null;
  communicating: number | null;
  communication_observed_at: string | null;
  yard: string | null;
  yard_zone_id: string | null;
  yard_zone_name: string | null;
  yard_confirmed_at: string | null;
};
type Snapshot = {
  deviceId: string;
  latitude: number | null;
  longitude: number | null;
  observedAt: string | null;
  communicating: boolean | null;
};
type YardPin = {
  yard_key: string;
  expected_name: string;
  geotab_zone_id: string | null;
};
type RecoveryOptions = {
  trailerBucket?: 0 | 1 | null;
};

const TARGET_BATCH_SIZE = 40;
const MAX_SECOND_PASS = 120;
const VEHICLE_RECOVERY_AGE_MINUTES = 10;
const TRAILER_RECOVERY_AGE_MINUTES = 45;

function parseDateMs(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function boolValue(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return null;
}

function currentZone(zone: GeotabJsonRecord, now = Date.now()) {
  const from = parseDateMs(geotabText(geotabGet(zone, 'activeFrom', 'ActiveFrom')).trim());
  const to = parseDateMs(geotabText(geotabGet(zone, 'activeTo', 'ActiveTo')).trim());
  return (from == null || from <= now) && (to == null || to > now);
}

function zonePoints(zone: GeotabJsonRecord): Point[] {
  const points: Point[] = [];
  for (const raw of geotabArray(geotabGet(zone, 'points', 'Points'))) {
    const x = numberValue(geotabGet(raw, 'x', 'X'));
    const y = numberValue(geotabGet(raw, 'y', 'Y'));
    if (x != null && y != null) points.push({ x, y });
  }
  return points;
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

function matchYard(longitude: number, latitude: number, zones: YardZone[]) {
  const match = zones.find((zone) => pointInPolygon(longitude, latitude, zone.points));
  return match ? { yard: match.key as YardSelection, zoneId: match.id, zoneName: match.name } : null;
}

function statusSnapshots(rows: GeotabJsonRecord[]) {
  const result = new Map<string, Snapshot>();
  for (const status of rows) {
    const deviceId = geotabObjectId(geotabGet(status, 'device', 'Device')) || geotabObjectId(status);
    if (!deviceId) continue;
    const latitude = numberValue(geotabGet(status, 'latitude', 'Latitude'));
    const longitude = numberValue(geotabGet(status, 'longitude', 'Longitude'));
    const validPosition = latitude != null && longitude != null
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
    const observedAt = geotabText(geotabGet(status, 'dateTime', 'DateTime')).trim() || null;
    result.set(deviceId, {
      deviceId,
      latitude: validPosition ? latitude : null,
      longitude: validPosition ? longitude : null,
      observedAt: validPosition ? observedAt : null,
      communicating: boolValue(geotabGet(status, 'isDeviceCommunicating', 'IsDeviceCommunicating')),
    });
  }
  return result;
}

function rowsFromMultiCallChild(value: unknown) {
  if (Array.isArray(value)) return geotabArray(value);
  const wrapped = geotabRecord(value);
  return geotabArray(geotabGet(wrapped, 'result', 'Result'));
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchTargetBatch(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  deviceIds: string[],
) {
  if (!deviceIds.length) return new Map<string, Snapshot>();
  const calls = deviceIds.map((id) => ({
    method: 'Get',
    params: {
      typeName: 'DeviceStatusInfo',
      search: { deviceSearch: { id } },
    },
  }));
  const result = await client.call<unknown[]>('ExecuteMultiCall', { calls });
  const recovered = new Map<string, Snapshot>();
  for (const child of Array.isArray(result) ? result : []) {
    for (const [id, snapshot] of statusSnapshots(rowsFromMultiCallChild(child))) recovered.set(id, snapshot);
  }
  return recovered;
}

async function fetchTargetedStatuses(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  deviceIds: string[],
) {
  const recovered = new Map<string, Snapshot>();
  for (let index = 0; index < deviceIds.length; index += TARGET_BATCH_SIZE) {
    const batch = deviceIds.slice(index, index + TARGET_BATCH_SIZE);
    try {
      const batchResult = await fetchTargetBatch(client, batch);
      for (const [id, snapshot] of batchResult) recovered.set(id, snapshot);
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'geotab_targeted_gps_batch_failed',
        batchSize: batch.length,
        error: String(error),
      }));
    }
  }

  let missing = deviceIds.filter((id) => !recovered.has(id));
  const retryIds = missing.slice(0, MAX_SECOND_PASS);
  if (retryIds.length) {
    await wait(750 + Math.floor(Math.random() * 500));
    for (let index = 0; index < retryIds.length; index += TARGET_BATCH_SIZE) {
      const batch = retryIds.slice(index, index + TARGET_BATCH_SIZE);
      try {
        const batchResult = await fetchTargetBatch(client, batch);
        for (const [id, snapshot] of batchResult) recovered.set(id, snapshot);
      } catch (error) {
        console.warn(JSON.stringify({
          event: 'geotab_targeted_gps_retry_failed',
          batchSize: batch.length,
          error: String(error),
        }));
      }
    }
    missing = deviceIds.filter((id) => !recovered.has(id));
  }

  return {
    recovered,
    firstPassMissing: deviceIds.length - (deviceIds.length - retryIds.length === deviceIds.length ? recovered.size : 0),
    retried: retryIds.length,
    stillMissing: missing.length,
  };
}

async function loadTargets(db: D1Database, trailerBucket: 0 | 1 | null) {
  const result = await db.prepare(`
    SELECT
      e.id AS equipment_id,
      e.unit,
      COALESCE(e.equipment_type, '') AS equipment_type,
      d.geotab_device_id,
      s.latitude,
      s.longitude,
      s.gps_observed_at,
      s.gps_received_at,
      s.gps_source,
      s.communicating,
      s.communication_observed_at,
      s.yard,
      s.yard_zone_id,
      s.yard_zone_name,
      s.yard_confirmed_at
    FROM equipment_geotab_devices d
    JOIN equipment e ON e.id = d.equipment_id
    LEFT JOIN geotab_unit_state s ON s.equipment_id = e.id AND s.geotab_device_id = d.geotab_device_id
    WHERE d.current = 1
      AND e.active = 1
      AND e.archived_at IS NULL
      AND e.merged_into_equipment_id IS NULL
    ORDER BY e.id
  `).all<TargetRow>();

  const now = Date.now();
  return result.results.filter((row) => {
    const trailer = row.equipment_type.toLowerCase() === 'trailer';
    if (trailer) {
      if (trailerBucket == null || Math.abs(Number(row.equipment_id)) % 2 !== trailerBucket) return false;
    }
    const observedMs = parseDateMs(row.gps_observed_at);
    if (observedMs == null) return true;
    const ageMinutes = Math.max(0, (now - observedMs) / 60000);
    return ageMinutes > (trailer ? TRAILER_RECOVERY_AGE_MINUTES : VEHICLE_RECOVERY_AGE_MINUTES);
  });
}

async function loadZones(db: D1Database, client: Awaited<ReturnType<typeof createGeotabClient>>) {
  const [zoneRows, pinRows] = await Promise.all([
    client.call<GeotabJsonRecord[]>('Get', { typeName: 'Zone' }),
    db.prepare(`
      SELECT yard_key, expected_name, geotab_zone_id
      FROM geotab_yard_zones
      ORDER BY yard_key
    `).all<YardPin>(),
  ]);
  const activeZones = zoneRows.filter((zone) => currentZone(zone));
  const byId = new Map(activeZones.map((zone) => [geotabObjectId(zone), zone]).filter(([id]) => Boolean(id)));
  const pins = new Map(pinRows.results.map((row) => [row.yard_key, row]));
  const zones: YardZone[] = [];

  for (const definition of YARD_DEFINITIONS) {
    const pin = pins.get(definition.key);
    let zone: GeotabJsonRecord | undefined;
    if (pin?.geotab_zone_id) zone = byId.get(pin.geotab_zone_id);
    if (!zone) {
      const expectedName = (pin?.expected_name || definition.zoneName).trim().toLowerCase();
      zone = activeZones.find((candidate) => geotabText(geotabGet(candidate, 'name', 'Name')).trim().toLowerCase() === expectedName);
    }
    if (!zone) continue;
    const id = geotabObjectId(zone);
    const name = geotabText(geotabGet(zone, 'name', 'Name')).trim() || definition.zoneName;
    const points = zonePoints(zone);
    if (id && points.length >= 3) zones.push({ key: definition.key, id, name, points });
  }

  return { zones, allResolved: zones.length === YARD_DEFINITIONS.length };
}

function stateStatement(db: D1Database, row: TargetRow, snapshot: Snapshot, zones: YardZone[], allZonesResolved: boolean) {
  const incomingMs = parseDateMs(snapshot.observedAt);
  const existingMs = parseDateMs(row.gps_observed_at);
  const newerPosition = snapshot.latitude != null && snapshot.longitude != null && incomingMs != null
    && (existingMs == null || incomingMs > existingMs);

  let latitude = row.latitude;
  let longitude = row.longitude;
  let observedAt = row.gps_observed_at;
  let receivedAt = row.gps_received_at;
  let source = row.gps_source || 'NO_DATA';
  let yard = row.yard || '';
  let yardZoneId = row.yard_zone_id;
  let yardZoneName = row.yard_zone_name;
  let yardConfirmedAt = row.yard_confirmed_at;

  if (newerPosition) {
    latitude = snapshot.latitude;
    longitude = snapshot.longitude;
    observedAt = snapshot.observedAt;
    receivedAt = new Date().toISOString();
    source = 'DeviceStatusInfoTargeted';
    const match = matchYard(snapshot.longitude!, snapshot.latitude!, zones);
    if (match) {
      yard = match.yard;
      yardZoneId = match.zoneId;
      yardZoneName = match.zoneName;
      yardConfirmedAt = snapshot.observedAt;
    } else if (allZonesResolved) {
      yard = '';
      yardZoneId = null;
      yardZoneName = null;
      yardConfirmedAt = snapshot.observedAt;
    }
  }

  const communicating = snapshot.communicating == null ? row.communicating : snapshot.communicating ? 1 : 0;
  const communicationObservedAt = snapshot.communicating == null
    ? row.communication_observed_at
    : new Date().toISOString();

  return db.prepare(`
    INSERT INTO geotab_unit_state (
      equipment_id, geotab_device_id, latitude, longitude, gps_observed_at, gps_received_at,
      gps_source, communicating, communication_observed_at, yard, yard_zone_id,
      yard_zone_name, yard_confirmed_at, last_successful_sync_at, last_error_code, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(equipment_id) DO UPDATE SET
      geotab_device_id = excluded.geotab_device_id,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      gps_observed_at = excluded.gps_observed_at,
      gps_received_at = excluded.gps_received_at,
      gps_source = excluded.gps_source,
      communicating = excluded.communicating,
      communication_observed_at = excluded.communication_observed_at,
      yard = excluded.yard,
      yard_zone_id = excluded.yard_zone_id,
      yard_zone_name = excluded.yard_zone_name,
      yard_confirmed_at = excluded.yard_confirmed_at,
      last_successful_sync_at = CURRENT_TIMESTAMP,
      last_error_code = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    row.equipment_id,
    row.geotab_device_id,
    latitude,
    longitude,
    observedAt,
    receivedAt,
    source,
    communicating,
    communicationObservedAt,
    yard,
    yardZoneId,
    yardZoneName,
    yardConfirmedAt,
  );
}

export async function recoverStaleGeotabGps(env: Env, options: RecoveryOptions = {}) {
  const trailerBucket = options.trailerBucket ?? null;
  const targets = await loadTargets(env.DB, trailerBucket);
  if (!targets.length) {
    return { ok: true, targeted: 0, returned: 0, stillMissing: 0, trailerBucket };
  }

  const client = await createGeotabClient(env);
  const [{ recovered, retried, stillMissing }, zoneState] = await Promise.all([
    fetchTargetedStatuses(client, targets.map((row) => row.geotab_device_id)),
    loadZones(env.DB, client),
  ]);

  const statements: D1PreparedStatement[] = [];
  let newerPositions = 0;
  for (const row of targets) {
    const snapshot = recovered.get(row.geotab_device_id);
    if (!snapshot) continue;
    const incomingMs = parseDateMs(snapshot.observedAt);
    const existingMs = parseDateMs(row.gps_observed_at);
    if (snapshot.latitude != null && snapshot.longitude != null && incomingMs != null && (existingMs == null || incomingMs > existingMs)) {
      newerPositions += 1;
    }
    statements.push(stateStatement(env.DB, row, snapshot, zoneState.zones, zoneState.allResolved));
  }

  for (let index = 0; index < statements.length; index += 60) {
    await env.DB.batch(statements.slice(index, index + 60));
  }

  const result = {
    ok: true,
    targeted: targets.length,
    returned: recovered.size,
    retried,
    stillMissing,
    newerPositions,
    zonesResolved: zoneState.zones.length,
    trailerBucket,
  };
  console.log(JSON.stringify({ event: 'geotab_targeted_gps_recovery', ...result }));
  return result;
}
