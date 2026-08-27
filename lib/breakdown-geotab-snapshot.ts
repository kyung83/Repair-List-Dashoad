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

export type BreakdownUnitType = 'truck' | 'trailer';

type Env = GeotabClientEnv & { DB: D1Database };
type EquipmentLookup = {
  id: number;
  unit: string;
  equipment_type: string;
  geotab_trailer_id: string | null;
};
type CachedGps = {
  geotab_device_id: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_observed_at: string | null;
  gps_source: string | null;
};
type DeviceAssignment = { geotab_device_id: string };

type Position = {
  latitude: number;
  longitude: number;
  observedAt: string;
  source: string;
  deviceId: string;
};

type DriverSnapshot = {
  name: string;
  geotabUserId: string;
  observedAt: string;
  deviceId: string;
};

export type BreakdownGeotabSnapshot = {
  driverName: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  gpsObservedAt: string;
  gpsSource: string;
  geotabDriverId: string;
  driverObservedAt: string;
  geotabDeviceId: string;
  capturedAt: string;
};

const MAX_GPS_AGE_MS = 30 * 60 * 1000;
const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

function finiteCoordinate(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function dateMs(value: unknown) {
  const raw = geotabText(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function freshPosition(position: Position | null, now = Date.now()) {
  if (!position) return null;
  const observed = dateMs(position.observedAt);
  if (observed == null || observed > now + 5 * 60_000 || now - observed > MAX_GPS_AGE_MS) return null;
  return position;
}

function deviceStatusPosition(status: GeotabJsonRecord): Position | null {
  const latitude = finiteCoordinate(geotabGet(status, 'latitude', 'Latitude'), -90, 90);
  const longitude = finiteCoordinate(geotabGet(status, 'longitude', 'Longitude'), -180, 180);
  const observedAt = geotabText(geotabGet(status, 'dateTime', 'DateTime')).trim();
  const deviceId = geotabObjectId(geotabGet(status, 'device', 'Device'));
  if (latitude == null || longitude == null || !observedAt || !deviceId) return null;
  return { latitude, longitude, observedAt, source: 'DeviceStatusInfo', deviceId };
}

function displayDriverName(user: GeotabJsonRecord) {
  const first = geotabText(geotabGet(user, 'firstName', 'FirstName')).trim();
  const last = geotabText(geotabGet(user, 'lastName', 'LastName')).trim();
  const full = `${first} ${last}`.trim();
  return full || geotabText(geotabGet(user, 'name', 'Name')).trim();
}

function stateFromAddress(address: GeotabJsonRecord) {
  const explicit = geotabText(geotabGet(address, 'state', 'State', 'province', 'Province')).trim().toUpperCase();
  if (STATE_CODES.has(explicit)) return explicit;
  const formatted = geotabText(geotabGet(address, 'formattedAddress', 'FormattedAddress')).toUpperCase();
  for (const state of STATE_CODES) {
    if (new RegExp(`(?:^|[^A-Z])${state}(?:[^A-Z]|$)`).test(formatted)) return state;
  }
  return '';
}

async function resolveEquipment(db: D1Database, equipmentId: number, unitType: BreakdownUnitType) {
  const row = await db.prepare(`
    SELECT id, unit, equipment_type, geotab_trailer_id
    FROM equipment
    WHERE id = ? AND active = 1 AND archived_at IS NULL
  `).bind(equipmentId).first<EquipmentLookup>();
  if (!row || row.equipment_type !== unitType) return null;
  return row;
}

async function selectedUnitCachedPosition(db: D1Database, equipmentId: number) {
  const row = await db.prepare(`
    SELECT geotab_device_id, latitude, longitude, gps_observed_at, gps_source
    FROM geotab_unit_state
    WHERE equipment_id = ?
  `).bind(equipmentId).first<CachedGps>();
  if (!row) return null;
  const latitude = finiteCoordinate(row.latitude, -90, 90);
  const longitude = finiteCoordinate(row.longitude, -180, 180);
  if (latitude == null || longitude == null || !row.gps_observed_at || !row.geotab_device_id) return null;
  return freshPosition({
    latitude,
    longitude,
    observedAt: row.gps_observed_at,
    source: row.gps_source || 'geotab_unit_state',
    deviceId: row.geotab_device_id,
  });
}

async function currentDeviceAssignment(db: D1Database, equipmentId: number) {
  const rows = await db.prepare(`
    SELECT geotab_device_id
    FROM equipment_geotab_devices
    WHERE equipment_id = ? AND current = 1
    ORDER BY id DESC
    LIMIT 2
  `).bind(equipmentId).all<DeviceAssignment>();
  return rows.results.length === 1 ? String(rows.results[0].geotab_device_id || '').trim() : '';
}

async function exactTrailerId(client: Awaited<ReturnType<typeof createGeotabClient>>, equipment: EquipmentLookup) {
  if (equipment.geotab_trailer_id) return equipment.geotab_trailer_id.trim();
  const rows = await client.call<GeotabJsonRecord[]>('Get', {
    typeName: 'Trailer',
    search: { name: equipment.unit },
    resultsLimit: 20,
  });
  const exact = rows.filter((row) => geotabText(geotabGet(row, 'name', 'Name')).trim().toLowerCase() === equipment.unit.trim().toLowerCase());
  const ids = [...new Set(exact.map(geotabObjectId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : '';
}

async function privatelyResolveTrailerTractorDevice(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  trailerId: string,
) {
  if (!trailerId) return '';
  const nowIso = new Date().toISOString();
  const rows = await client.call<GeotabJsonRecord[]>('Get', {
    typeName: 'TrailerAttachment',
    search: { trailerSearch: { id: trailerId }, activeFrom: nowIso },
    resultsLimit: 20,
  });
  const now = Date.now();
  const activeDeviceIds = rows
    .filter((row) => {
      const activeFrom = dateMs(geotabGet(row, 'activeFrom', 'ActiveFrom'));
      const activeTo = dateMs(geotabGet(row, 'activeTo', 'ActiveTo'));
      return (activeFrom == null || activeFrom <= now) && (activeTo == null || activeTo > now);
    })
    .map((row) => geotabObjectId(geotabGet(row, 'device', 'Device')))
    .filter(Boolean);
  const unique = [...new Set(activeDeviceIds)];
  return unique.length === 1 ? unique[0] : '';
}

async function deviceStatus(client: Awaited<ReturnType<typeof createGeotabClient>>, deviceId: string) {
  if (!deviceId) return null;
  const rows = await client.call<GeotabJsonRecord[]>('Get', {
    typeName: 'DeviceStatusInfo',
    search: { deviceSearch: { id: deviceId } },
    resultsLimit: 2,
  });
  if (rows.length !== 1) return null;
  return rows[0];
}

async function driverFromStatus(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  status: GeotabJsonRecord | null,
  deviceId: string,
): Promise<DriverSnapshot | null> {
  if (!status) return null;
  const geotabUserId = geotabObjectId(geotabGet(status, 'driver', 'Driver'));
  const observedAt = geotabText(geotabGet(status, 'dateTime', 'DateTime')).trim();
  if (!geotabUserId || !observedAt) return null;
  const rows = await client.call<GeotabJsonRecord[]>('Get', {
    typeName: 'User',
    search: { id: geotabUserId },
    resultsLimit: 2,
  });
  if (rows.length !== 1) return null;
  const name = displayDriverName(rows[0]);
  return name ? { name, geotabUserId, observedAt, deviceId } : null;
}

async function reverseGeocode(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  position: Position,
) {
  const rows = geotabArray(await client.call<unknown>('GetAddresses', {
    coordinates: [{ x: position.longitude, y: position.latitude }],
    movingAddresses: false,
  }));
  if (rows.length !== 1) return null;
  const city = geotabText(geotabGet(rows[0], 'city', 'City', 'otherCity', 'OtherCity')).trim();
  const state = stateFromAddress(rows[0]);
  return city && state ? { city, state } : null;
}

/**
 * Resolves a trustworthy point-in-time Geotab snapshot for a roadside breakdown.
 * For trailer breakdowns the tractor association is looked up transiently through
 * TrailerAttachment and is never written as an affected unit or equipment FK.
 */
export async function resolveBreakdownGeotabSnapshot(
  env: Env,
  input: { equipmentId: number; unitType: BreakdownUnitType },
): Promise<BreakdownGeotabSnapshot | null> {
  try {
    const equipment = await resolveEquipment(env.DB, input.equipmentId, input.unitType);
    if (!equipment) return null;
    const client = await createGeotabClient(env);

    let driverDeviceId = '';
    if (input.unitType === 'truck') {
      driverDeviceId = await currentDeviceAssignment(env.DB, equipment.id);
    } else {
      const trailerId = await exactTrailerId(client, equipment);
      driverDeviceId = await privatelyResolveTrailerTractorDevice(client, trailerId);
    }
    if (!driverDeviceId) return null;

    const status = await deviceStatus(client, driverDeviceId);
    const driver = await driverFromStatus(client, status, driverDeviceId);
    if (!driver) return null;

    const cached = await selectedUnitCachedPosition(env.DB, equipment.id);
    const statusPosition = freshPosition(status ? deviceStatusPosition(status) : null);
    const position = cached || statusPosition;
    if (!position) return null;

    const address = await reverseGeocode(client, position);
    if (!address) return null;

    return {
      driverName: driver.name,
      city: address.city,
      state: address.state,
      latitude: position.latitude,
      longitude: position.longitude,
      gpsObservedAt: position.observedAt,
      gpsSource: position.source,
      geotabDriverId: driver.geotabUserId,
      driverObservedAt: driver.observedAt,
      geotabDeviceId: driver.deviceId,
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(JSON.stringify({ event: 'breakdown_geotab_snapshot_unavailable', error: String(error) }));
    return null;
  }
}
