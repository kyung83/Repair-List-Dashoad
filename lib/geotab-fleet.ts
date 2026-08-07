import { geotabProtectedConfig } from './geotab-protected-config';
import { refreshMissingVinMetadata } from './vin-decoder';
import type { GeotabEnv } from './geotab';

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Login = { database: string; userName: string; password: string };
type Auth = { endpoint: string; credentials: Credentials };
type ProtectedConfig = { database: string; serviceUsername: string; servicePassword: string };
type Payload<T> = { result?: T; error?: { message?: string; name?: string } };

let loginPromise: Promise<Login> | undefined;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown) {
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
  const valueRecord = record(value);
  return text(get(valueRecord, 'id', 'Id')).trim();
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

async function currentOdometers(auth: Auth) {
  const milesByDevice = new Map<string, number>();
  try {
    const statuses = await call<JsonRecord[]>(auth, 'Get', {
      typeName: 'DeviceStatusInfo',
      search: { diagnostics: [{ id: 'DiagnosticOdometerId' }] },
    });
    for (const status of statuses) {
      const deviceId = objectId(get(status, 'device', 'Device')) || objectId(status);
      if (!deviceId) continue;
      for (const item of array(get(status, 'statusData', 'StatusData'))) {
        const diagnosticId = objectId(get(item, 'diagnostic', 'Diagnostic'));
        if (diagnosticId && diagnosticId !== 'DiagnosticOdometerId') continue;
        const meters = Number(get(item, 'data', 'Data'));
        if (Number.isFinite(meters) && meters >= 0) milesByDevice.set(deviceId, Math.round(meters / 1609.344));
      }
    }
  } catch (error) {
    // Odometer freshness must not prevent DVIR sync. A later cron run will retry.
    console.error(JSON.stringify({ event: 'geotab_odometer_sync_failed', error: String(error) }));
  }
  return milesByDevice;
}

export async function syncGeotabFleetMaster(env: GeotabEnv) {
  const auth = await authenticate(env);
  const [devices, odometers] = await Promise.all([
    call<JsonRecord[]>(auth, 'Get', { typeName: 'Device' }),
    currentOdometers(auth),
  ]);

  const statements: D1PreparedStatement[] = [];
  let vehicles = 0;
  let mileageUpdates = 0;

  for (const device of devices) {
    const id = objectId(device);
    const unit = text(get(device, 'name', 'Name')).trim();
    if (!id || !unit) continue;

    const vin = text(get(device, 'vehicleIdentificationNumber', 'VehicleIdentificationNumber')).trim().toUpperCase() || null;
    const plate = text(get(device, 'licensePlate', 'LicensePlate')).trim() || null;
    const plateState = text(get(device, 'licenseState', 'LicenseState')).trim() || null;
    const mileage = odometers.get(id) ?? null;
    if (mileage != null) mileageUpdates += 1;
    vehicles += 1;

    statements.push(env.DB.prepare(`
      INSERT INTO equipment (
        unit, category, equipment_type, geotab_device_id, vin, license_plate, license_state,
        current_mileage, mileage_updated_at, active, updated_at
      ) VALUES (?, 'fleet', 'truck', ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(unit) DO UPDATE SET
        equipment_type = 'truck',
        geotab_device_id = excluded.geotab_device_id,
        model_year = CASE WHEN COALESCE(equipment.vin, '') <> COALESCE(excluded.vin, '') THEN NULL ELSE equipment.model_year END,
        make = CASE WHEN COALESCE(equipment.vin, '') <> COALESCE(excluded.vin, '') THEN NULL ELSE equipment.make END,
        model = CASE WHEN COALESCE(equipment.vin, '') <> COALESCE(excluded.vin, '') THEN NULL ELSE equipment.model END,
        engine = CASE WHEN COALESCE(equipment.vin, '') <> COALESCE(excluded.vin, '') THEN NULL ELSE equipment.engine END,
        vin_decoded_at = CASE WHEN COALESCE(equipment.vin, '') <> COALESCE(excluded.vin, '') THEN NULL ELSE equipment.vin_decoded_at END,
        vin_decode_source = CASE WHEN COALESCE(equipment.vin, '') <> COALESCE(excluded.vin, '') THEN NULL ELSE equipment.vin_decode_source END,
        vin = excluded.vin,
        license_plate = excluded.license_plate,
        license_state = excluded.license_state,
        current_mileage = COALESCE(excluded.current_mileage, equipment.current_mileage),
        mileage_updated_at = CASE WHEN excluded.current_mileage IS NULL THEN equipment.mileage_updated_at ELSE CURRENT_TIMESTAMP END,
        active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(unit, id, vin, plate, plateState, mileage, mileage));
  }

  for (let index = 0; index < statements.length; index += 75) {
    await env.DB.batch(statements.slice(index, index + 75));
  }

  let vinDecode = { requested: 0, updated: 0 };
  try {
    vinDecode = await refreshMissingVinMetadata(env.DB);
  } catch (error) {
    console.error(JSON.stringify({ event: 'vin_decode_failed', error: String(error) }));
  }

  return { ok: true, vehicles, mileageUpdates, vinDecode };
}
