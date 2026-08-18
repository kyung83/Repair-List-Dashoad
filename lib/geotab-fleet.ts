import { geotabProtectedConfig } from './geotab-protected-config';
import { buildTrailerGroupIds, entityBelongsToTrailerGroup } from './geotab-group-classification';
import { refreshMissingVinMetadata } from './vin-decoder';
import type { GeotabEnv } from './geotab';

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Login = { database: string; userName: string; password: string };
type Auth = { endpoint: string; credentials: Credentials };
type ProtectedConfig = { database: string; serviceUsername: string; servicePassword: string };
type Payload<T> = { result?: T; error?: { message?: string; name?: string } };
type EquipmentIdentityRow = {
  id: number;
  unit: string;
  geotab_device_id: string | null;
  vin: string | null;
  active: number;
  archived_at: string | null;
  current_mileage: number | null;
  mileage_updated_at: string | null;
};
type AssignmentRow = {
  equipment_id: number;
  geotab_device_id: string;
};
type IdentityResolution = {
  equipment: EquipmentIdentityRow;
  method: 'assignment' | 'device_id' | 'vin' | 'unit';
};
type IdentityQuarantine = {
  reason: string;
  candidateIds: number[];
};
type MileageDecision = {
  accepted: boolean;
  reason?: 'decrease' | 'implausible_increase';
};

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

function dateValue(value: unknown) {
  const raw = text(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentlyActiveDevice(device: JsonRecord, now = Date.now()) {
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

function normalizedUnit(value: unknown) {
  return text(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function distinctIds(values: number[]) {
  return [...new Set(values)];
}

function mileageDecision(
  equipment: EquipmentIdentityRow,
  incomingMileage: number,
  now = Date.now(),
): MileageDecision {
  const currentMileage = equipment.current_mileage;
  if (currentMileage == null) return { accepted: true };
  if (incomingMileage < currentMileage) return { accepted: false, reason: 'decrease' };

  const previousUpdatedAt = dateValue(equipment.mileage_updated_at);
  if (previousUpdatedAt == null) return { accepted: true };

  const elapsedHours = Math.max(1, (now - previousUpdatedAt) / 3_600_000);
  // 120 mph continuously is intentionally generous. This guard is for obvious
  // device-swap/baseline errors, not normal driving-pattern enforcement.
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
    // Odometer freshness must not prevent the fleet/DVIR sync. A later cron run will retry.
    console.error(JSON.stringify({ event: 'geotab_odometer_sync_failed', error: String(error) }));
  }
  return milesByDevice;
}

async function currentGroups(auth: Auth) {
  try {
    return await call<JsonRecord[]>(auth, 'Get', { typeName: 'Group' });
  } catch (error) {
    // A group lookup failure should not take the fleet offline or erase a prior
    // trailer classification. Preserve the stored asset class until a later run.
    console.error(JSON.stringify({ event: 'geotab_group_sync_failed', error: String(error) }));
    return null;
  }
}

function identityVinConflict(
  equipment: EquipmentIdentityRow,
  incomingVin: string | null,
  byVin: Map<string, EquipmentIdentityRow[]>,
  reason: string,
): IdentityQuarantine | null {
  const storedVin = validVin(equipment.vin);
  if (!incomingVin || !storedVin || incomingVin === storedVin) return null;
  const incomingVinCandidates = byVin.get(incomingVin) ?? [];
  return {
    reason,
    candidateIds: distinctIds([equipment.id, ...incomingVinCandidates.map((candidate) => candidate.id)]),
  };
}

function resolveIdentity(
  deviceId: string,
  incomingVin: string | null,
  unit: string,
  equipmentById: Map<number, EquipmentIdentityRow>,
  assignedByDevice: Map<string, number>,
  byDevice: Map<string, EquipmentIdentityRow[]>,
  byVin: Map<string, EquipmentIdentityRow[]>,
  byUnit: Map<string, EquipmentIdentityRow[]>,
  returnedDeviceIds: Set<string>,
  activeDeviceIds: Set<string>,
): IdentityResolution | IdentityQuarantine {
  const assignedEquipmentId = assignedByDevice.get(deviceId);
  if (assignedEquipmentId != null) {
    const equipment = equipmentById.get(assignedEquipmentId);
    if (!equipment) return { reason: 'assignment_missing_equipment', candidateIds: [assignedEquipmentId] };
    const vinConflict = identityVinConflict(equipment, incomingVin, byVin, 'assigned_device_vin_conflict');
    return vinConflict ?? { equipment, method: 'assignment' };
  }

  const deviceCandidates = byDevice.get(deviceId) ?? [];
  if (deviceCandidates.length === 1) {
    const candidate = deviceCandidates[0];
    const vinConflict = identityVinConflict(candidate, incomingVin, byVin, 'device_id_vin_conflict');
    return vinConflict ?? { equipment: candidate, method: 'device_id' };
  }
  if (deviceCandidates.length > 1) {
    const activeUnarchived = deviceCandidates.filter((candidate) => candidate.active === 1 && !candidate.archived_at);
    if (activeUnarchived.length === 1) {
      const candidate = activeUnarchived[0];
      const vinConflict = identityVinConflict(candidate, incomingVin, byVin, 'device_id_vin_conflict');
      return vinConflict ?? { equipment: candidate, method: 'device_id' };
    }
    return { reason: 'duplicate_device_id', candidateIds: deviceCandidates.map((candidate) => candidate.id) };
  }

  if (incomingVin) {
    const vinCandidates = byVin.get(incomingVin) ?? [];
    if (vinCandidates.length === 1) {
      const candidate = vinCandidates[0];
      if (candidate.archived_at) return { reason: 'vin_match_is_archived', candidateIds: [candidate.id] };
      const priorDeviceId = candidate.geotab_device_id?.trim() || null;
      if (priorDeviceId && priorDeviceId !== deviceId) {
        if (activeDeviceIds.has(priorDeviceId)) {
          return { reason: 'vin_match_has_other_active_device', candidateIds: [candidate.id] };
        }
        if (!returnedDeviceIds.has(priorDeviceId)) {
          return { reason: 'vin_match_prior_device_not_visible', candidateIds: [candidate.id] };
        }
      }
      return { equipment: candidate, method: 'vin' };
    }
    if (vinCandidates.length > 1) {
      return { reason: 'duplicate_vin', candidateIds: vinCandidates.map((candidate) => candidate.id) };
    }
  }

  const unitKey = normalizedUnit(unit);
  const unitCandidates = unitKey ? (byUnit.get(unitKey) ?? []) : [];
  if (unitCandidates.length === 1) {
    const candidate = unitCandidates[0];
    if (candidate.archived_at) return { reason: 'unit_match_is_archived', candidateIds: [candidate.id] };
    const vinConflict = identityVinConflict(candidate, incomingVin, byVin, 'unit_match_vin_conflict');
    if (vinConflict) return vinConflict;
    const priorDeviceId = candidate.geotab_device_id?.trim() || null;
    if (priorDeviceId && priorDeviceId !== deviceId) {
      return { reason: 'unit_match_has_other_device', candidateIds: [candidate.id] };
    }
    return { equipment: candidate, method: 'unit' };
  }
  if (unitCandidates.length > 1) {
    return { reason: 'duplicate_normalized_unit', candidateIds: unitCandidates.map((candidate) => candidate.id) };
  }

  return { reason: 'unmatched_device', candidateIds: [] };
}

export async function syncGeotabFleetMaster(env: GeotabEnv) {
  const auth = await authenticate(env);
  const [devices, odometers, groups, equipmentResult, assignmentResult] = await Promise.all([
    call<JsonRecord[]>(auth, 'Get', { typeName: 'Device' }),
    currentOdometers(auth),
    currentGroups(auth),
    env.DB.prepare(`
      SELECT id, unit, geotab_device_id, vin, active, archived_at, current_mileage, mileage_updated_at
      FROM equipment
    `).all<EquipmentIdentityRow>(),
    env.DB.prepare(`
      SELECT equipment_id, geotab_device_id
      FROM equipment_geotab_devices
      WHERE current = 1
    `).all<AssignmentRow>(),
  ]);

  if (!devices.length) throw new Error('Geotab returned no devices; refusing to update fleet metadata.');
  const activeDevices = devices.filter((device) => {
    const id = objectId(device);
    return id && id.toLowerCase() !== 'nodeviceid' && isCurrentlyActiveDevice(device);
  });
  if (!activeDevices.length) throw new Error('Geotab returned no currently active devices; refusing to treat this response as authoritative.');

  const equipmentById = new Map<number, EquipmentIdentityRow>();
  const byDevice = new Map<string, EquipmentIdentityRow[]>();
  const byVin = new Map<string, EquipmentIdentityRow[]>();
  const byUnit = new Map<string, EquipmentIdentityRow[]>();
  for (const equipment of equipmentResult.results) {
    equipmentById.set(equipment.id, equipment);
    const deviceId = equipment.geotab_device_id?.trim();
    if (deviceId) pushMap(byDevice, deviceId, equipment);
    const vin = validVin(equipment.vin);
    if (vin) pushMap(byVin, vin, equipment);
    const unitKey = normalizedUnit(equipment.unit);
    if (unitKey) pushMap(byUnit, unitKey, equipment);
  }

  const assignedByDevice = new Map<string, number>();
  const assignedDeviceByEquipment = new Map<number, string>();
  const claimedEquipmentIds = new Set<number>();
  for (const assignment of assignmentResult.results) {
    assignedByDevice.set(assignment.geotab_device_id, assignment.equipment_id);
    assignedDeviceByEquipment.set(assignment.equipment_id, assignment.geotab_device_id);
    claimedEquipmentIds.add(assignment.equipment_id);
  }

  const returnedDeviceIds = new Set(
    devices.map((device) => objectId(device)).filter((id): id is string => Boolean(id) && id.toLowerCase() !== 'nodeviceid'),
  );
  const activeDeviceIds = new Set(
    activeDevices.map((device) => objectId(device)).filter((id): id is string => Boolean(id)),
  );
  const explicitlyInactiveDeviceIds = new Set(
    [...returnedDeviceIds].filter((id) => !activeDeviceIds.has(id)),
  );
  const trailerGroupIds = groups ? buildTrailerGroupIds(groups) : new Set<string>();

  // IMPORTANT: absence from the Device response is not an archive or device-swap
  // signal. Positive, high-confidence identity matches may add fresh metadata;
  // missing or ambiguous information cannot create, archive, relink, or rename
  // equipment. A device swap requires the old device to be positively returned
  // by Geotab and explicitly inactive, never merely absent.
  const batches: D1PreparedStatement[][] = [];
  let batch: D1PreparedStatement[] = [];
  const addStatementGroup = (group: D1PreparedStatement[]) => {
    if (batch.length && batch.length + group.length > 60) {
      batches.push(batch);
      batch = [];
    }
    batch.push(...group);
  };

  let vehicles = 0;
  let trailerDevices = 0;
  let mileageReceived = 0;
  let mileageUpdates = 0;
  let mileageAnomalies = 0;
  let identityQuarantined = 0;
  const identityMatches = { assignment: 0, device_id: 0, vin: 0, unit: 0 };

  for (const device of activeDevices) {
    const id = objectId(device);
    const unit = text(get(device, 'name', 'Name')).trim();
    if (!id || !unit) continue;

    const groupAssetClass = groups
      ? (entityBelongsToTrailerGroup(device, trailerGroupIds) ? 'trailer' : 'vehicle')
      : null;
    if (groupAssetClass === 'trailer') trailerDevices += 1;
    else vehicles += 1;

    const vin = validVin(get(device, 'vehicleIdentificationNumber', 'VehicleIdentificationNumber'));
    const serialNumber = text(get(device, 'serialNumber', 'SerialNumber')).trim() || null;
    const plate = text(get(device, 'licensePlate', 'LicensePlate')).trim() || null;
    const plateState = text(get(device, 'licenseState', 'LicenseState')).trim() || null;
    const mileage = odometers.get(id) ?? null;
    if (mileage != null) mileageReceived += 1;

    const resolution = resolveIdentity(
      id,
      vin,
      unit,
      equipmentById,
      assignedByDevice,
      byDevice,
      byVin,
      byUnit,
      returnedDeviceIds,
      activeDeviceIds,
    );

    if (!('equipment' in resolution)) {
      identityQuarantined += 1;
      addStatementGroup([
        env.DB.prepare(`
          INSERT INTO geotab_reconciliation_queue (
            geotab_device_id, serial_number, geotab_name, vin, reason,
            candidate_equipment_ids, status, first_seen_at, last_seen_at,
            resolved_equipment_id, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL)
          ON CONFLICT(geotab_device_id) DO UPDATE SET
            serial_number = excluded.serial_number,
            geotab_name = excluded.geotab_name,
            vin = excluded.vin,
            reason = excluded.reason,
            candidate_equipment_ids = excluded.candidate_equipment_ids,
            status = 'open',
            last_seen_at = CURRENT_TIMESTAMP,
            resolved_equipment_id = NULL,
            resolved_at = NULL
        `).bind(id, serialNumber, unit, vin, resolution.reason, JSON.stringify(resolution.candidateIds)),
      ]);
      continue;
    }

    const equipment = resolution.equipment;
    const alreadyAssignedEquipmentId = assignedByDevice.get(id);
    const currentlyAssignedDeviceId = assignedDeviceByEquipment.get(equipment.id);
    const safeVinSwap = resolution.method === 'vin'
      && Boolean(currentlyAssignedDeviceId)
      && currentlyAssignedDeviceId !== id
      && explicitlyInactiveDeviceIds.has(currentlyAssignedDeviceId!);

    if (resolution.method !== 'assignment' && claimedEquipmentIds.has(equipment.id) && !safeVinSwap) {
      identityQuarantined += 1;
      addStatementGroup([
        env.DB.prepare(`
          INSERT INTO geotab_reconciliation_queue (
            geotab_device_id, serial_number, geotab_name, vin, reason,
            candidate_equipment_ids, status, first_seen_at, last_seen_at,
            resolved_equipment_id, resolved_at
          ) VALUES (?, ?, ?, ?, 'equipment_already_claimed', ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL)
          ON CONFLICT(geotab_device_id) DO UPDATE SET
            serial_number = excluded.serial_number,
            geotab_name = excluded.geotab_name,
            vin = excluded.vin,
            reason = excluded.reason,
            candidate_equipment_ids = excluded.candidate_equipment_ids,
            status = 'open',
            last_seen_at = CURRENT_TIMESTAMP,
            resolved_equipment_id = NULL,
            resolved_at = NULL
        `).bind(id, serialNumber, unit, vin, JSON.stringify([equipment.id])),
      ]);
      continue;
    }

    identityMatches[resolution.method] += 1;
    claimedEquipmentIds.add(equipment.id);
    assignedByDevice.set(id, equipment.id);
    assignedDeviceByEquipment.set(equipment.id, id);

    const statementGroup: D1PreparedStatement[] = [];
    if (alreadyAssignedEquipmentId === equipment.id) {
      statementGroup.push(env.DB.prepare(`
        UPDATE equipment_geotab_devices
        SET serial_number = COALESCE(?, serial_number),
            geotab_name = ?,
            vin_seen = COALESCE(?, vin_seen),
            last_seen_at = CURRENT_TIMESTAMP
        WHERE current = 1
          AND geotab_device_id = ?
          AND equipment_id = ?
      `).bind(serialNumber, unit, vin, id, equipment.id));
    } else {
      statementGroup.push(
        env.DB.prepare(`
          UPDATE equipment_geotab_devices
          SET current = 0,
              ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
              last_seen_at = CURRENT_TIMESTAMP
          WHERE current = 1
            AND equipment_id = ?
            AND geotab_device_id <> ?
        `).bind(equipment.id, id),
        env.DB.prepare(`
          UPDATE equipment_geotab_devices
          SET current = 0,
              ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
              last_seen_at = CURRENT_TIMESTAMP
          WHERE current = 1
            AND geotab_device_id = ?
            AND equipment_id <> ?
        `).bind(id, equipment.id),
        env.DB.prepare(`
          INSERT OR IGNORE INTO equipment_geotab_devices (
            equipment_id, geotab_device_id, serial_number, geotab_name, vin_seen,
            assigned_at, last_seen_at, current, linked_by
          ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, ?)
        `).bind(equipment.id, id, serialNumber, unit, vin, resolution.method),
      );
    }

    let trustedMileage: number | null = null;
    if (mileage != null) {
      const decision = mileageDecision(equipment, mileage);
      if (decision.accepted) {
        trustedMileage = mileage;
        mileageUpdates += 1;
      } else if (decision.reason) {
        mileageAnomalies += 1;
        statementGroup.push(env.DB.prepare(`
          INSERT OR IGNORE INTO geotab_mileage_anomalies (
            equipment_id, geotab_device_id, serial_number, previous_mileage,
            incoming_mileage, previous_updated_at, reason, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
        `).bind(
          equipment.id,
          id,
          serialNumber,
          equipment.current_mileage,
          mileage,
          equipment.mileage_updated_at,
          decision.reason,
        ));
      }
    }

    statementGroup.push(env.DB.prepare(`
      UPDATE equipment
      SET geotab_asset_class = COALESCE(?, geotab_asset_class),
          equipment_type = CASE
            WHEN geotab_trailer_id IS NOT NULL AND TRIM(geotab_trailer_id) <> '' THEN 'trailer'
            WHEN COALESCE(?, geotab_asset_class) = 'trailer' THEN 'trailer'
            WHEN COALESCE(?, geotab_asset_class) = 'vehicle' THEN 'truck'
            ELSE equipment_type
          END,
          geotab_device_id = ?,
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
          active = CASE WHEN archived_at IS NULL THEN 1 ELSE active END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      groupAssetClass,
      groupAssetClass,
      groupAssetClass,
      id,
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
      equipment.id,
    ));

    statementGroup.push(env.DB.prepare(`
      UPDATE geotab_reconciliation_queue
      SET status = 'resolved',
          last_seen_at = CURRENT_TIMESTAMP,
          resolved_equipment_id = ?,
          resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
      WHERE geotab_device_id = ?
        AND status = 'open'
    `).bind(equipment.id, id));

    addStatementGroup(statementGroup);
  }

  if (batch.length) batches.push(batch);
  for (const statements of batches) {
    await env.DB.batch(statements);
  }

  if (identityQuarantined > 0 || mileageAnomalies > 0) {
    console.warn(JSON.stringify({
      event: 'geotab_fleet_sync_attention',
      identityQuarantined,
      mileageAnomalies,
      identityMatches,
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
    activeVehicles: vehicles,
    activeTrailerDevices: trailerDevices,
    trailerGroupCount: trailerGroupIds.size,
    groupCatalogAvailable: Boolean(groups),
    historicalDevicesIgnored: Math.max(0, devices.length - activeDevices.length),
    identityMatches,
    identityQuarantined,
    mileageReceived,
    mileageUpdates,
    mileageAnomalies,
    vinDecode,
  };
}
