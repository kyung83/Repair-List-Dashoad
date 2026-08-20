import {
  createGeotabClient,
  geotabGet,
  geotabObjectId,
  geotabText,
  type GeotabClientEnv,
  type GeotabJsonRecord,
} from './geotab-client';

type Env = GeotabClientEnv & { DB: D1Database };
type AssignmentRow = {
  equipment_id: number;
  unit: string;
  equipment_type: string;
  geotab_device_id: string;
};
type StateRow = {
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

function numberValue(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function boolValue(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return null;
}

function parseDateMs(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function retryGeotabGpsForEquipment(env: Env, equipmentId: number) {
  const assignment = await env.DB.prepare(`
    SELECT e.id AS equipment_id, e.unit, COALESCE(e.equipment_type, '') AS equipment_type,
           d.geotab_device_id
    FROM equipment_geotab_devices d
    JOIN equipment e ON e.id = d.equipment_id
    WHERE d.current = 1
      AND e.id = ?
      AND e.active = 1
      AND e.archived_at IS NULL
      AND e.merged_into_equipment_id IS NULL
    LIMIT 1
  `).bind(equipmentId).first<AssignmentRow>();
  if (!assignment) throw new Error('This unit does not have a current Geotab assignment.');

  const existing = await env.DB.prepare(`
    SELECT latitude, longitude, gps_observed_at, gps_received_at, gps_source,
           communicating, communication_observed_at, yard, yard_zone_id,
           yard_zone_name, yard_confirmed_at
    FROM geotab_unit_state
    WHERE equipment_id = ?
    LIMIT 1
  `).bind(equipmentId).first<StateRow>();

  const client = await createGeotabClient(env);
  const rows = await client.call<GeotabJsonRecord[]>('Get', {
    typeName: 'DeviceStatusInfo',
    search: { deviceSearch: { id: assignment.geotab_device_id } },
  });
  const status = Array.isArray(rows)
    ? rows.find((item) => (geotabObjectId(geotabGet(item, 'device', 'Device')) || geotabObjectId(item)) === assignment.geotab_device_id)
    : undefined;

  if (!status) {
    return {
      ok: false,
      equipmentId,
      unit: assignment.unit,
      geotabDeviceId: assignment.geotab_device_id,
      returned: false,
      message: 'Geotab returned no DeviceStatusInfo row for this assigned device.',
    };
  }

  const latitude = numberValue(geotabGet(status, 'latitude', 'Latitude'));
  const longitude = numberValue(geotabGet(status, 'longitude', 'Longitude'));
  const observedAt = geotabText(geotabGet(status, 'dateTime', 'DateTime')).trim() || null;
  const communicating = boolValue(geotabGet(status, 'isDeviceCommunicating', 'IsDeviceCommunicating'));
  const validPosition = latitude != null && longitude != null
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    && observedAt != null;
  const incomingMs = parseDateMs(observedAt);
  const existingMs = parseDateMs(existing?.gps_observed_at);
  const newerPosition = validPosition && incomingMs != null && (existingMs == null || incomingMs > existingMs);
  const nowIso = new Date().toISOString();

  await env.DB.prepare(`
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
    equipmentId,
    assignment.geotab_device_id,
    newerPosition ? latitude : existing?.latitude ?? null,
    newerPosition ? longitude : existing?.longitude ?? null,
    newerPosition ? observedAt : existing?.gps_observed_at ?? null,
    newerPosition ? nowIso : existing?.gps_received_at ?? null,
    newerPosition ? 'DeviceStatusInfoManualRetry' : existing?.gps_source ?? 'NO_DATA',
    communicating == null ? existing?.communicating ?? null : communicating ? 1 : 0,
    communicating == null ? existing?.communication_observed_at ?? null : nowIso,
    existing?.yard ?? '',
    existing?.yard_zone_id ?? null,
    existing?.yard_zone_name ?? null,
    existing?.yard_confirmed_at ?? null,
  ).run();

  return {
    ok: true,
    equipmentId,
    unit: assignment.unit,
    geotabDeviceId: assignment.geotab_device_id,
    returned: true,
    communicating,
    observedAt,
    newerPosition,
    message: newerPosition
      ? 'Geotab returned a newer GPS position for this unit.'
      : 'Geotab responded, but did not return a newer GPS position.',
  };
}
