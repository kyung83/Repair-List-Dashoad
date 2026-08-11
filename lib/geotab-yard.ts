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

const CLARE_ZONE = 'z';
const CADILLAC_ZONE = 'new cadillac yard';
const ADDRESS_BATCH_SIZE = 80;
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

function objectName(value: unknown) {
  return text(get(record(value), 'name', 'Name')).trim();
}

function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
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

function yardFromAddress(address: JsonRecord) {
  let currentYard: YardKey = '';
  let zoneName = '';
  for (const zone of array(get(address, 'zones', 'Zones'))) {
    const name = objectName(zone);
    const normalized = name.toLowerCase();
    if (normalized === CLARE_ZONE) {
      currentYard = 'clare';
      zoneName = name || 'Z';
      break;
    }
    if (normalized === CADILLAC_ZONE) {
      currentYard = 'cadillac';
      zoneName = name || 'New cadillac yard';
      break;
    }
  }
  return { currentYard, zoneName };
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

export async function syncGeotabYardPresence(env: GeotabEnv) {
  const auth = await authenticate(env);
  const positions = await currentPositions(auth);
  const statements: D1PreparedStatement[] = [];
  let clare = 0;
  let cadillac = 0;
  let outside = 0;

  for (let offset = 0; offset < positions.length; offset += ADDRESS_BATCH_SIZE) {
    const batch = positions.slice(offset, offset + ADDRESS_BATCH_SIZE);
    const addresses = await call<JsonRecord[]>(auth, 'GetAddresses', {
      coordinates: batch.map((position) => ({ x: position.longitude, y: position.latitude })),
      movingAddresses: false,
    });

    for (let index = 0; index < batch.length; index += 1) {
      const position = batch[index];
      const address = addresses[index] ?? {};
      const { currentYard, zoneName } = yardFromAddress(address);
      if (currentYard === 'clare') clare += 1;
      else if (currentYard === 'cadillac') cadillac += 1;
      else outside += 1;

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
  }

  await env.DB.prepare(`
    UPDATE equipment
    SET current_yard = '', current_yard_zone = '', yard_updated_at = CURRENT_TIMESTAMP
    WHERE active = 1 AND geotab_device_id IS NOT NULL AND TRIM(geotab_device_id) <> ''
  `).run();

  for (let index = 0; index < statements.length; index += 75) {
    await env.DB.batch(statements.slice(index, index + 75));
  }

  return {
    ok: true,
    positions: positions.length,
    clare,
    cadillac,
    outside,
    updatedAt: new Date().toISOString(),
  };
}
