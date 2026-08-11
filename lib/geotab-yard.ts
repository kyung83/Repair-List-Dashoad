import { geotabProtectedConfig } from './geotab-protected-config';
import type { GeotabEnv } from './geotab';

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Login = { database: string; userName: string; password: string };
type Auth = { endpoint: string; credentials: Credentials };
type ProtectedConfig = { database: string; serviceUsername: string; servicePassword: string };
type Payload<T> = { result?: T; error?: { message?: string; name?: string } };
type YardKey = '' | 'clare' | 'cadillac';
type Position = { deviceId: string; latitude: number; longitude: number; dateTime: string };
type Point = { x: number; y: number };
type YardZone = { name: string; points: Point[] };

const CLARE_ZONE = 'z';
const CADILLAC_ZONE = 'new cadillac yard';
let loginPromise: Promise<Login> | undefined;

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

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodePem(value: string) {
  const base64 = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!base64) throw new Error('Geotab configuration private key is invalid');
  return decodeBase64(base64);
}

async function protectedLogin(env: GeotabEnv): Promise<Login> {
  if (env.GEOTAB_DATABASE && env.GEOTAB_USERNAME && env.GEOTAB_PASSWORD) {
    return { database: env.GEOTAB_DATABASE, userName: env.GEOTAB_USERNAME, password: env.GEOTAB_PASSWORD };
  }
  if (!env.GEOTAB_CONFIG_PRIVATE_KEY) throw new Error('Geotab configuration is missing');

  if (!loginPromise) {
    loginPromise = (async () => {
      const privateKey = await crypto.subtle.importKey(
        'pkcs8', decodePem(env.GEOTAB_CONFIG_PRIVATE_KEY!), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'],
      );
      const rawAesKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' }, privateKey, decodeBase64(geotabProtectedConfig.wrappedKey),
      );
      const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64(geotabProtectedConfig.iv) },
        aesKey,
        decodeBase64(geotabProtectedConfig.ciphertext),
      );
      const config = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<ProtectedConfig>;
      if (!config.database || !config.serviceUsername || !config.servicePassword) throw new Error('Geotab protected configuration is incomplete');
      return { database: config.database, userName: config.serviceUsername, password: config.servicePassword };
    })();
  }
  return loginPromise;
}

function endpointFromPath(pathValue: unknown) {
  const path = text(pathValue).trim();
  if (!path || path.toLowerCase() === 'thisserver') return 'https://my.geotab.com/apiv1';
  const host = path.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('Geotab returned an invalid API path');
  return `https://${host}/apiv1`;
}

async function rpc<T>(endpoint: string, method: string, params: JsonRecord): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) throw new Error(`Geotab ${method} returned HTTP ${response.status}`);
  const payload = await response.json() as Payload<T>;
  if (payload.error) throw new Error(`Geotab ${method} failed: ${payload.error.name || payload.error.message || 'unknown error'}`);
  if (payload.result === undefined) throw new Error(`Geotab ${method} returned no result`);
  return payload.result;
}

async function authenticate(env: GeotabEnv): Promise<Auth> {
  const login = await protectedLogin(env);
  const result = await rpc<{ credentials: Credentials; path?: string }>('https://my.geotab.com/apiv1', 'Authenticate', {
    database: login.database,
    userName: login.userName,
    password: login.password,
  });
  return { endpoint: endpointFromPath(result.path), credentials: result.credentials };
}

async function call<T>(auth: Auth, method: string, params: JsonRecord) {
  return rpc<T>(auth.endpoint, method, { ...params, credentials: auth.credentials });
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

async function currentPositions(auth: Auth): Promise<Position[]> {
  const statuses = await call<JsonRecord[]>(auth, 'Get', { typeName: 'DeviceStatusInfo' });
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
  clare: number;
  cadillac: number;
  outside: number;
  clareZoneFound: boolean;
  cadillacZoneFound: boolean;
}) {
  await env.DB.prepare(`
    INSERT INTO geotab_yard_sync_state (
      id,status,message,positions,clare,cadillac,outside,clare_zone_found,cadillac_zone_found,updated_at
    ) VALUES (1,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      message=excluded.message,
      positions=excluded.positions,
      clare=excluded.clare,
      cadillac=excluded.cadillac,
      outside=excluded.outside,
      clare_zone_found=excluded.clare_zone_found,
      cadillac_zone_found=excluded.cadillac_zone_found,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    state.status,
    state.message,
    state.positions,
    state.clare,
    state.cadillac,
    state.outside,
    state.clareZoneFound ? 1 : 0,
    state.cadillacZoneFound ? 1 : 0,
  ).run();
}

export async function syncGeotabYardPresence(env: GeotabEnv) {
  try {
    const auth = await authenticate(env);
    const [positions, zones] = await Promise.all([
      currentPositions(auth),
      call<JsonRecord[]>(auth, 'Get', { typeName: 'Zone' }),
    ]);

    const clareZone = findYardZone(zones, 'Z');
    const cadillacZone = findYardZone(zones, 'New cadillac yard');
    const statements: D1PreparedStatement[] = [];
    let clare = 0;
    let cadillac = 0;
    let outside = 0;

    for (const position of positions) {
      let currentYard: YardKey = '';
      let zoneName = '';
      if (clareZone && pointInPolygon(position.longitude, position.latitude, clareZone.points)) {
        currentYard = 'clare';
        zoneName = clareZone.name;
        clare += 1;
      } else if (cadillacZone && pointInPolygon(position.longitude, position.latitude, cadillacZone.points)) {
        currentYard = 'cadillac';
        zoneName = cadillacZone.name;
        cadillac += 1;
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

    const missing = [
      !clareZone ? 'Z' : '',
      !cadillacZone ? 'New cadillac yard' : '',
    ].filter(Boolean);
    const status = missing.length ? 'warning' : 'ok';
    const message = missing.length
      ? `Geotab connected, but these yard zones were not found exactly: ${missing.join(', ')}.`
      : `Geotab yard check completed using zones ${clareZone!.name} and ${cadillacZone!.name}.`;

    await writeSyncState(env, {
      status,
      message,
      positions: positions.length,
      clare,
      cadillac,
      outside,
      clareZoneFound: Boolean(clareZone),
      cadillacZoneFound: Boolean(cadillacZone),
    });

    return {
      ok: status === 'ok',
      status,
      message,
      positions: positions.length,
      clare,
      cadillac,
      outside,
      clareZoneFound: Boolean(clareZone),
      cadillacZoneFound: Boolean(cadillacZone),
      clareZoneName: clareZone?.name ?? '',
      cadillacZoneName: cadillacZone?.name ?? '',
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await writeSyncState(env, {
        status: 'error',
        message,
        positions: 0,
        clare: 0,
        cadillac: 0,
        outside: 0,
        clareZoneFound: false,
        cadillacZoneFound: false,
      });
    } catch (stateError) {
      console.error(JSON.stringify({ event: 'geotab_yard_sync_state_failed', error: String(stateError) }));
    }
    throw error;
  }
}
