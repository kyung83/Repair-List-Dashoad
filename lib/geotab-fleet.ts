import { geotabProtectedConfig } from './geotab-protected-config';
import { recoverAssignedOdometers } from './geotab-odometer-recovery';
import { refreshMissingVinMetadata } from './vin-decoder';
import type { GeotabEnv } from './geotab';

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Login = { database: string; userName: string; password: string };
type Auth = { endpoint: string; credentials: Credentials };
type ProtectedConfig = { database: string; serviceUsername: string; servicePassword: string };
type Payload<T> = { result?: T; error?: { message?: string; name?: string } };
type AssignmentRow = {
  equipment_id: number;
  geotab_device_id: string;
  mileage_offset: number;
  unit: string;
  equipment_type: string;
  current_mileage: number | null;
  mileage_updated_at: string | null;
  vin: string | null;
  active: number;
  archived_at: string | null;
};
type MileageDecision = {
  accepted: boolean;
  reason?: 'decrease' | 'implausible_increase';
};

let loginPromise: Promise<Login> | undefined;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
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

function dateValue(value: unknown) {
  const raw = text(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentlyActiveDevice(device: JsonRecord, now = Date.now()) {
  const id = objectId(device);
  if (!id || id.toLowerCase() === 'nodeviceid') return false;
  const activeFrom = dateValue(get(device, 'activeFrom', 'ActiveFrom'));
  const activeTo = dateValue(get(device, 'activeTo', 'ActiveTo'));
  return (activeFrom == null || activeFrom <= now) && (activeTo == null || activeTo > now);
}

function validVin(value: unknown) {
  const vin = text(value).trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;
  if (/^([A-Z0-9])\1{16}$/.test(vin)) return null;
  return vin;
}

function mileageDecision(equipment: AssignmentRow, incomingMileage: number, now = Date.now()): MileageDecision {
  const currentMileage = equipment.current_mileage;
  if (currentMileage == null) return { accepted: true };
  if (incomingMileage < currentMileage) return { accepted: false, reason: 'decrease' };

  const previousUpdatedAt = dateValue(equipment.mileage_updated_at);
  if (previousUpdatedAt == null) return { accepted: true };

  const elapsedHours = Math.max(1, (now - previousUpdatedAt) / 3_600_000);
  const maximumPlausibleIncrease = Math.max(500, Math.ceil(elapsedHours * 120));
  if (incomingMileage - currentMileage > maximumPlausibleIncrease) {
    return { accepted: false, reason: 'implausible_increase' };
  }
  return { accepted: true };
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
      if (!config.database || !config.serviceUsername || !config.servicePassword) {
        throw new Error('Geotab protected configuration is incomplete');
      }
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

async function runBatches(db: D1Database, statements: D1PreparedStatement[], size = 60) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

export async function syncGeotabFleetMaster(env: GeotabEnv) {
  const auth = await authenticate(env);
  const assignmentResult = await env.DB.prepare(`
    SELECT a.equipment_id, a.geotab_device_id, a.mileage_offset,
           e.unit, e.equipment_type, e.current_mileage, e.mileage_updated_at,
           e.vin, e.active, e.archived_at
    FROM equipment_geotab_devices a
    JOIN equipment e ON e.id = a.equipment_id
    WHERE a.current = 1
      AND e.active = 1
      AND e.archived_at IS NULL
  `).all<AssignmentRow>();
  const assignments = assignmentResult.results;
  const mileageDeviceIds = assignments
    .filter((assignment) => assignment.equipment_type !== 'trailer')
    .map((assignment) => assignment.geotab_device_id);

  const [devices, odometerResult] = await Promise.all([
    call<JsonRecord[]>(auth, 'Get', { typeName: 'Device' }),
    recoverAssignedOdometers(env, mileageDeviceIds),
  ]);

  if (!devices.length) throw new Error('Geotab returned no devices; refusing to update tracked mileage.');

  const activeDevices = devices.filter((device) => isCurrentlyActiveDevice(device));
  const activeById = new Map(activeDevices.map((device) => [objectId(device), device]));
  const visibleAssignments = assignments.filter((assignment) => activeById.has(assignment.geotab_device_id));

  if (assignments.length > 0 && visibleAssignments.length === 0) {
    throw new Error('Geotab returned none of the explicitly assigned devices; refusing to trust this fleet response.');
  }

  const statements: D1PreparedStatement[] = [];
  let mileageReceived = 0;
  let mileageUpdates = 0;
  let mileageAnomalies = 0;
  let missingAssignedDevices = 0;
  let trackedVehicles = 0;
  let trackedTrailers = 0;

  for (const assignment of assignments) {
    const device = activeById.get(assignment.geotab_device_id);
    if (!device) {
      missingAssignedDevices += 1;
      continue;
    }

    if (assignment.equipment_type === 'trailer') trackedTrailers += 1;
    else trackedVehicles += 1;

    const deviceId = assignment.geotab_device_id;
    const geotabName = text(get(device, 'name', 'Name')).trim() || assignment.unit;
    const serialNumber = text(get(device, 'serialNumber', 'SerialNumber')).trim() || null;
    const vin = validVin(get(device, 'vehicleIdentificationNumber', 'VehicleIdentificationNumber'));
    const plate = text(get(device, 'licensePlate', 'LicensePlate')).trim() || null;
    const plateState = text(get(device, 'licenseState', 'LicenseState')).trim() || null;
    const rawMileage = assignment.equipment_type === 'trailer'
      ? null
      : odometerResult.milesByDevice.get(deviceId) ?? null;
    const adjustedMileage = rawMileage == null ? null : rawMileage + Number(assignment.mileage_offset ?? 0);
    if (rawMileage != null) mileageReceived += 1;

    statements.push(env.DB.prepare(`
      UPDATE equipment_geotab_devices
      SET serial_number = COALESCE(?, serial_number),
          geotab_name = ?,
          vin_seen = COALESCE(?, vin_seen),
          last_seen_at = CURRENT_TIMESTAMP
      WHERE current = 1
        AND equipment_id = ?
        AND geotab_device_id = ?
    `).bind(serialNumber, geotabName, vin, assignment.equipment_id, deviceId));

    let trustedMileage: number | null = null;
    if (adjustedMileage != null && rawMileage != null) {
      const decision = mileageDecision(assignment, adjustedMileage);
      if (decision.accepted) {
        trustedMileage = adjustedMileage;
        mileageUpdates += 1;
      } else if (decision.reason) {
        mileageAnomalies += 1;
        statements.push(env.DB.prepare(`
          INSERT INTO geotab_mileage_anomalies (
            equipment_id, geotab_device_id, serial_number, previous_mileage,
            incoming_mileage, raw_mileage, adjusted_mileage, previous_updated_at,
            reason, status, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1
            FROM geotab_mileage_anomalies existing
            WHERE existing.equipment_id = ?
              AND existing.geotab_device_id = ?
              AND COALESCE(existing.raw_mileage, existing.incoming_mileage) = ?
              AND existing.status IN ('pending', 'dismissed')
          )
        `).bind(
          assignment.equipment_id,
          deviceId,
          serialNumber,
          assignment.current_mileage,
          adjustedMileage,
          rawMileage,
          adjustedMileage,
          assignment.mileage_updated_at,
          decision.reason,
          assignment.equipment_id,
          deviceId,
          rawMileage,
        ));
      }
    }

    statements.push(env.DB.prepare(`
      UPDATE equipment
      SET geotab_device_id = ?,
          model_year = CASE WHEN ? IS NOT NULL AND COALESCE(vin, '') <> ? THEN NULL ELSE model_year END,
          make = CASE WHEN ? IS NOT NULL AND COALESCE(vin, '') <> ? THEN NULL ELSE make END,
          model = CASE WHEN ? IS NOT NULL AND COALESCE(vin, '') <> ? THEN NULL ELSE model END,
          engine = CASE WHEN ? IS NOT NULL AND COALESCE(vin, '') <> ? THEN NULL ELSE engine END,
          vin_decoded_at = CASE WHEN ? IS NOT NULL AND COALESCE(vin, '') <> ? THEN NULL ELSE vin_decoded_at END,
          vin_decode_source = CASE WHEN ? IS NOT NULL AND COALESCE(vin, '') <> ? THEN NULL ELSE vin_decode_source END,
          vin = COALESCE(?, vin),
          license_plate = COALESCE(?, license_plate),
          license_state = COALESCE(?, license_state),
          current_mileage = COALESCE(?, current_mileage),
          mileage_updated_at = CASE WHEN ? IS NULL THEN mileage_updated_at ELSE CURRENT_TIMESTAMP END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND active = 1
        AND archived_at IS NULL
    `).bind(
      deviceId,
      vin, vin,
      vin, vin,
      vin, vin,
      vin, vin,
      vin, vin,
      vin, vin,
      vin,
      plate,
      plateState,
      trustedMileage,
      trustedMileage,
      assignment.equipment_id,
    ));

    statements.push(env.DB.prepare(`
      UPDATE geotab_reconciliation_queue
      SET status = 'resolved',
          last_seen_at = CURRENT_TIMESTAMP,
          resolved_equipment_id = ?,
          resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
      WHERE geotab_device_id = ?
        AND status = 'open'
    `).bind(assignment.equipment_id, deviceId));
  }

  await runBatches(env.DB, statements);

  if (!odometerResult.available || mileageAnomalies > 0 || missingAssignedDevices > 0 || odometerResult.stillMissing > 0) {
    console.warn(JSON.stringify({
      event: 'geotab_fleet_sync_attention',
      odometerAvailable: odometerResult.available,
      assignedDevices: assignments.length,
      visibleAssignedDevices: visibleAssignments.length,
      missingAssignedDevices,
      mileageRequested: odometerResult.requested,
      mileageFirstPassReceived: odometerResult.firstPassReceived,
      mileageRetried: odometerResult.retried,
      mileageBroadFallbackRecovered: odometerResult.broadFallbackRecovered,
      mileageStillMissing: odometerResult.stillMissing,
      mileageAnomalies,
    }));
  }

  let vinDecode = { requested: 0, updated: 0 };
  try {
    vinDecode = await refreshMissingVinMetadata(env.DB);
  } catch (error) {
    console.error(JSON.stringify({ event: 'vin_decode_failed', error: String(error) }));
  }

  return {
    ok: true,
    receivedDevices: devices.length,
    assignedDevices: assignments.length,
    visibleAssignedDevices: visibleAssignments.length,
    missingAssignedDevices,
    activeVehicles: trackedVehicles,
    activeTrailerDevices: trackedTrailers,
    trailerGroupCount: 0,
    groupCatalogAvailable: false,
    historicalDevicesIgnored: Math.max(0, devices.length - activeDevices.length),
    identityMatches: { assignment: visibleAssignments.length, device_id: 0, vin: 0, unit: 0 },
    identityQuarantined: 0,
    odometerAvailable: odometerResult.available,
    odometerRequested: odometerResult.requested,
    odometerFirstPassReceived: odometerResult.firstPassReceived,
    odometerRetried: odometerResult.retried,
    odometerTargetedRecovered: odometerResult.targetedRecovered,
    odometerBroadFallbackRecovered: odometerResult.broadFallbackRecovered,
    odometerStillMissing: odometerResult.stillMissing,
    mileageReceived,
    mileageUpdates,
    mileageAnomalies,
    vinDecode,
  };
}
