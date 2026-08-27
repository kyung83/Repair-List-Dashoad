import {
  createGeotabClient,
  geotabArray,
  geotabGet,
  geotabObjectId,
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

export type BreakdownGeotabPreview = {
  driverAvailable: boolean;
  locationAvailable: boolean;
  driverName: string;
  city: string;
  state: string;
  observedAt: string;
  driverObservedAt: string;
  gpsObservedAt: string;
};

const MAX_GPS_AGE_MS = 30 * 60 * 1000;
const TRAILER_LIST_LIMIT = 50_000;
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

function trailerUnitKey(value: unknown) {
  const compact = geotabText(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const numeric = compact.match(/^(?:TRL|TRAILER)?0*(\d+)$/);
  if (numeric) return String(Number(numeric[1]));
  return compact;
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

async function exactTrailerId(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  db: D1Database,
  equipment: EquipmentLookup,
) {
  const stored = String(equipment.geotab_trailer_id || '').trim();
  if (stored) return stored;

  // Geotab's Trailer entity does not support name search. Read the bounded
  // Trailer list and exact-match locally instead of sending an ignored search
  // object that can return an arbitrary first page.
  const rows = await client.call<GeotabJsonRecord[]>('Get', {
    typeName: 'Trailer',
    resultsLimit: TRAILER_LIST_LIMIT,
  });
  const wanted = trailerUnitKey(equipment.unit);
  const exact = rows.filter((row) => trailerUnitKey(geotabGet(row, 'name', 'Name')) === wanted);
  const ids = [...new Set(exact.map(geotabObjectId).filter(Boolean))];
  if (ids.length !== 1) return '';

  const trailerId = ids[0];
  await db.prepare(`
    UPDATE equipment
    SET geotab_trailer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (geotab_trailer_id IS NULL OR trim(geotab_trailer_id) = '')
  `).bind(trailerId, equipment.id).run();
  return trailerId;
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
 * Lightweight driver-facing preview. Driver and location are intentionally
 * independent here: a stale GPS/address lookup must not hide a valid Geotab driver,
 * and a trailer with fresh cached GPS can still show location even if no tractor is attached.
 */
export async function resolveBreakdownGeotabPreview(
  env: Env,
  input: { equipmentId: number; unitType: BreakdownUnitType },
): Promise<BreakdownGeotabPreview | null> {
  try {
    const equipment = await resolveEquipment(env.DB, input.equipmentId, input.unitType);
    if (!equipment) return null;
    const client = await createGeotabClient(env);

    const cached = await selectedUnitCachedPosition(env.DB, equipment.id);

    let driverDeviceId = '';
    try {
      if (input.unitType === 'truck') {
        driverDeviceId = await currentDeviceAssignment(env.DB, equipment.id);
      } else {
        const trailerId = await exactTrailerId(client, env.DB, equipment);
        driverDeviceId = await privatelyResolveTrailerTractorDevice(client, trailerId);
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: 'breakdown_geotab_preview_driver_device_unavailable', unitType: input.unitType, error: String(error) }));
    }

    let status: GeotabJsonRecord | null = null;
    if (driverDeviceId) {
      try {
        status = await deviceStatus(client, driverDeviceId);
      } catch (error) {
        console.warn(JSON.stringify({ event: 'breakdown_geotab_preview_status_unavailable', unitType: input.unitType, error: String(error) }));
      }
    }

    let driver: DriverSnapshot | null = null;
    if (status && driverDeviceId) {
      try {
        driver = await driverFromStatus(client, status, driverDeviceId);
      } catch (error) {
        console.warn(JSON.stringify({ event: 'breakdown_geotab_preview_driver_unavailable', unitType: input.unitType, error: String(error) }));
      }
    }

    const statusPosition = freshPosition(status ? deviceStatusPosition(status) : null);
    const position = cached || statusPosition;
    let address: { city: string; state: string } | null = null;
    if (position) {
      try {
        address = await reverseGeocode(client, position);
      } catch (error) {
        console.warn(JSON.stringify({ event: 'breakdown_geotab_preview_address_unavailable', unitType: input.unitType, error: String(error) }));
      }
    }

    if (!driver && !address) return null;
    return {
      driverAvailable: Boolean(driver),
      locationAvailable: Boolean(address),
      driverName: driver?.name || '',
      city: address?.city || '',
      state: address?.state || '',
      observedAt: position?.observedAt || driver?.observedAt || '',
      driverObservedAt: driver?.observedAt || '',
      gpsObservedAt: position?.observedAt || '',
    };
  } catch (error) {
    console.warn(JSON.stringify({ event: 'breakdown_geotab_preview_unavailable', error: String(error) }));
    return null;
  }
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
      const trailerId = await exactTrailerId(client, env.DB, equipment);
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
