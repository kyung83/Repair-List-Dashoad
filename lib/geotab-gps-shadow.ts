import { createGeotabClient, geotabArray, geotabGet, geotabObjectId, geotabRecord, geotabText, type GeotabClientEnv, type GeotabJsonRecord } from './geotab-client';
import { YARD_DEFINITIONS, normalizeYard, type YardKey, type YardSelection } from './yards';

type Env = GeotabClientEnv & { DB: D1Database };
type Point = { x: number; y: number };
type YardZone = { key: YardKey; id: string; name: string; points: Point[] };
type ExpectedRow = {
  equipment_id: number;
  unit: string;
  equipment_type: string;
  assignment_device_id: string;
  legacy_device_id: string;
  legacy_latitude: number | null;
  legacy_longitude: number | null;
  legacy_position_at: string | null;
  legacy_yard: string;
  legacy_yard_zone: string;
  legacy_yard_updated_at: string | null;
};
type StateRow = {
  equipment_id: number;
  geotab_device_id: string;
  latitude: number | null;
  longitude: number | null;
  gps_observed_at: string | null;
  gps_received_at: string | null;
  gps_source: string;
  communicating: number | null;
  communication_observed_at: string | null;
  yard: string;
  yard_zone_id: string | null;
  yard_zone_name: string | null;
  yard_confirmed_at: string | null;
};
type StatusSnapshot = {
  deviceId: string;
  latitude: number | null;
  longitude: number | null;
  observedAt: string | null;
  communicating: boolean | null;
};
type YardPinRow = {
  yard_key: string;
  expected_name: string;
  geotab_zone_id: string | null;
  geotab_zone_name: string | null;
  status: string;
};
type RunCounts = {
  expected: number;
  returned: number;
  fresh: number;
  fallback: number;
  noData: number;
  identityErrors: number;
  equivalent: number;
  improvement: number;
  regression: number;
  changed: number;
};

type EffectiveState = {
  deviceId: string;
  latitude: number | null;
  longitude: number | null;
  observedAt: string | null;
  receivedAt: string | null;
  source: string;
  communicating: boolean | null;
  communicationObservedAt: string | null;
  yard: YardSelection;
  yardZoneId: string | null;
  yardZoneName: string | null;
  yardConfirmedAt: string | null;
};

const PIPELINE = 'gps-shadow';
const LEASE_SECONDS = 120;
const CIRCUIT_BREAKER_MIN_EXPECTED = 20;
const CIRCUIT_BREAKER_MIN_RETURN_RATIO = 0.5;

function parseDateMs(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
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

function freshness(observedAt: string | null, equipmentType: string, now = Date.now()) {
  const observed = parseDateMs(observedAt);
  if (observed == null) return 'NO_DATA';
  const ageMinutes = Math.max(0, (now - observed) / 60000);
  const trailer = equipmentType.toLowerCase() === 'trailer';
  if (trailer) {
    if (ageMinutes <= 60) return 'LIVE';
    if (ageMinutes <= 360) return 'RECENT';
    return 'STALE';
  }
  if (ageMinutes <= 15) return 'LIVE';
  if (ageMinutes <= 60) return 'RECENT';
  return 'STALE';
}

function diffCategory(oldValue: string, newValue: string) {
  const oldYard = normalizeYard(oldValue);
  const newYard = normalizeYard(newValue);
  if (oldYard === newYard) return 'equivalent' as const;
  if (!oldYard && newYard) return 'improvement' as const;
  if (oldYard && !newYard) return 'regression' as const;
  return 'changed' as const;
}

async function acquireLease(db: D1Database, ownerId: string) {
  await db.prepare(`
    INSERT INTO geotab_sync_leases (pipeline, owner_id, locked_until, heartbeat_at, acquired_at)
    VALUES (?, ?, datetime('now', ?), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(pipeline) DO UPDATE SET
      owner_id = excluded.owner_id,
      locked_until = excluded.locked_until,
      heartbeat_at = CURRENT_TIMESTAMP,
      acquired_at = CURRENT_TIMESTAMP
    WHERE geotab_sync_leases.locked_until <= CURRENT_TIMESTAMP
       OR geotab_sync_leases.owner_id = excluded.owner_id
  `).bind(PIPELINE, ownerId, `+${LEASE_SECONDS} seconds`).run();
  const row = await db.prepare('SELECT owner_id FROM geotab_sync_leases WHERE pipeline = ?')
    .bind(PIPELINE).first<{ owner_id: string }>();
  return row?.owner_id === ownerId;
}

async function heartbeat(db: D1Database, ownerId: string) {
  const result = await db.prepare(`
    UPDATE geotab_sync_leases
    SET locked_until = datetime('now', ?), heartbeat_at = CURRENT_TIMESTAMP
    WHERE pipeline = ? AND owner_id = ?
  `).bind(`+${LEASE_SECONDS} seconds`, PIPELINE, ownerId).run();
  if (!result.meta.changes) throw new Error('GPS reliability lease was lost before the run completed.');
}

async function releaseLease(db: D1Database, ownerId: string) {
  await db.prepare('DELETE FROM geotab_sync_leases WHERE pipeline = ? AND owner_id = ?')
    .bind(PIPELINE, ownerId).run();
}

async function startRun(db: D1Database, runId: string) {
  await db.prepare(`
    INSERT INTO geotab_sync_runs (run_id, pipeline, mode, result_status, api_status)
    VALUES (?, ?, 'shadow', 'running', 'unknown')
  `).bind(runId, PIPELINE).run();
}

async function finishRun(db: D1Database, runId: string, status: string, apiStatus: string, counts: RunCounts, message: string) {
  await db.prepare(`
    UPDATE geotab_sync_runs
    SET finished_at = CURRENT_TIMESTAMP,
        result_status = ?, api_status = ?, expected_count = ?, returned_count = ?,
        fresh_count = ?, fallback_count = ?, no_data_count = ?, identity_error_count = ?,
        equivalent_count = ?, improvement_count = ?, regression_count = ?, changed_count = ?,
        message = ?
    WHERE run_id = ?
  `).bind(
    status, apiStatus, counts.expected, counts.returned,
    counts.fresh, counts.fallback, counts.noData, counts.identityErrors,
    counts.equivalent, counts.improvement, counts.regression, counts.changed,
    message.slice(0, 1000), runId,
  ).run();
}

async function loadExpected(db: D1Database) {
  const result = await db.prepare(`
    SELECT
      e.id AS equipment_id,
      e.unit,
      COALESCE(e.equipment_type, '') AS equipment_type,
      d.geotab_device_id AS assignment_device_id,
      COALESCE(e.geotab_device_id, '') AS legacy_device_id,
      e.geotab_latitude AS legacy_latitude,
      e.geotab_longitude AS legacy_longitude,
      e.geotab_position_at AS legacy_position_at,
      COALESCE(e.current_yard, '') AS legacy_yard,
      COALESCE(e.current_yard_zone, '') AS legacy_yard_zone,
      e.yard_updated_at AS legacy_yard_updated_at
    FROM equipment_geotab_devices d
    JOIN equipment e ON e.id = d.equipment_id
    WHERE d.current = 1
      AND e.active = 1
      AND e.archived_at IS NULL
      AND e.merged_into_equipment_id IS NULL
    ORDER BY e.id
  `).all<ExpectedRow>();
  return result.results;
}

async function identityErrorCount(db: D1Database) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM equipment e
    WHERE e.active = 1
      AND e.archived_at IS NULL
      AND e.merged_into_equipment_id IS NULL
      AND e.geotab_device_id IS NOT NULL
      AND TRIM(e.geotab_device_id) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM equipment_geotab_devices d
        WHERE d.equipment_id = e.id AND d.current = 1
      )
  `).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function loadStates(db: D1Database, equipmentIds: number[]) {
  if (!equipmentIds.length) return new Map<number, StateRow>();
  const result = await db.prepare(`
    SELECT s.equipment_id, s.geotab_device_id, s.latitude, s.longitude,
           s.gps_observed_at, s.gps_received_at, s.gps_source, s.communicating,
           s.communication_observed_at, s.yard, s.yard_zone_id,
           s.yard_zone_name, s.yard_confirmed_at
    FROM geotab_unit_state s
    JOIN equipment_geotab_devices d
      ON d.equipment_id = s.equipment_id
     AND d.current = 1
    JOIN equipment e ON e.id = s.equipment_id
    WHERE e.active = 1
      AND e.archived_at IS NULL
      AND e.merged_into_equipment_id IS NULL
  `).all<StateRow>();
  const expectedIds = new Set(equipmentIds.map(Number));
  return new Map(
    result.results
      .filter((row) => expectedIds.has(Number(row.equipment_id)))
      .map((row) => [Number(row.equipment_id), row]),
  );
}

function legacySeed(row: ExpectedRow): EffectiveState {
  const identityMatches = !row.legacy_device_id || row.legacy_device_id === row.assignment_device_id;
  return {
    deviceId: row.assignment_device_id,
    latitude: identityMatches ? row.legacy_latitude : null,
    longitude: identityMatches ? row.legacy_longitude : null,
    observedAt: identityMatches ? row.legacy_position_at : null,
    receivedAt: identityMatches ? row.legacy_yard_updated_at : null,
    source: identityMatches && row.legacy_position_at ? 'LEGACY_SEED' : 'NO_DATA',
    communicating: null,
    communicationObservedAt: null,
    yard: identityMatches ? normalizeYard(row.legacy_yard) : '',
    yardZoneId: null,
    yardZoneName: identityMatches ? (row.legacy_yard_zone || null) : null,
    yardConfirmedAt: identityMatches ? row.legacy_yard_updated_at : null,
  };
}

function fromState(row: StateRow): EffectiveState {
  return {
    deviceId: row.geotab_device_id,
    latitude: row.latitude,
    longitude: row.longitude,
    observedAt: row.gps_observed_at,
    receivedAt: row.gps_received_at,
    source: row.gps_source,
    communicating: row.communicating == null ? null : Boolean(row.communicating),
    communicationObservedAt: row.communication_observed_at,
    yard: normalizeYard(row.yard),
    yardZoneId: row.yard_zone_id,
    yardZoneName: row.yard_zone_name,
    yardConfirmedAt: row.yard_confirmed_at,
  };
}

function statusSnapshots(rows: GeotabJsonRecord[]) {
  const result = new Map<string, StatusSnapshot>();
  for (const status of rows) {
    const deviceId = geotabObjectId(geotabGet(status, 'device', 'Device')) || geotabObjectId(status);
    if (!deviceId) continue;
    const latitude = numberValue(geotabGet(status, 'latitude', 'Latitude'));
    const longitude = numberValue(geotabGet(status, 'longitude', 'Longitude'));
    const validPosition = latitude != null && longitude != null
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
    const dateTime = geotabText(geotabGet(status, 'dateTime', 'DateTime')).trim() || null;
    const communicating = boolValue(geotabGet(status, 'isDeviceCommunicating', 'IsDeviceCommunicating'));
    result.set(deviceId, {
      deviceId,
      latitude: validPosition ? latitude : null,
      longitude: validPosition ? longitude : null,
      observedAt: validPosition ? dateTime : null,
      communicating,
    });
  }
  return result;
}

async function resolveZones(db: D1Database, client: Awaited<ReturnType<typeof createGeotabClient>>) {
  const [zoneRows, pinRows] = await Promise.all([
    client.call<GeotabJsonRecord[]>('Get', { typeName: 'Zone' }),
    db.prepare(`
      SELECT yard_key, expected_name, geotab_zone_id, geotab_zone_name, status
      FROM geotab_yard_zones
      ORDER BY yard_key
    `).all<YardPinRow>(),
  ]);
  const activeZones = zoneRows.filter((zone) => currentZone(zone));
  const byId = new Map(activeZones.map((zone) => [geotabObjectId(zone), zone]).filter(([id]) => Boolean(id)));
  const pins = new Map(pinRows.results.map((row) => [row.yard_key, row]));
  const resolved: YardZone[] = [];
  const updates: D1PreparedStatement[] = [];

  for (const definition of YARD_DEFINITIONS) {
    const pin = pins.get(definition.key);
    let zone: GeotabJsonRecord | undefined;
    if (pin?.geotab_zone_id) {
      zone = byId.get(pin.geotab_zone_id);
    } else {
      const expected = (pin?.expected_name || definition.zoneName).trim().toLowerCase();
      zone = activeZones.find((candidate) => geotabText(geotabGet(candidate, 'name', 'Name')).trim().toLowerCase() === expected);
    }
    const id = zone ? geotabObjectId(zone) : '';
    const name = zone ? geotabText(geotabGet(zone, 'name', 'Name')).trim() : '';
    const points = zone ? zonePoints(zone) : [];
    if (zone && id && points.length >= 3) {
      resolved.push({ key: definition.key, id, name: name || definition.zoneName, points });
      updates.push(db.prepare(`
        UPDATE geotab_yard_zones
        SET geotab_zone_id = COALESCE(geotab_zone_id, ?),
            geotab_zone_name = ?,
            pinned_at = COALESCE(pinned_at, CURRENT_TIMESTAMP),
            last_seen_at = CURRENT_TIMESTAMP,
            status = 'resolved'
        WHERE yard_key = ?
      `).bind(id, name || definition.zoneName, definition.key));
    } else {
      updates.push(db.prepare(`
        UPDATE geotab_yard_zones
        SET status = ?, last_seen_at = last_seen_at
        WHERE yard_key = ?
      `).bind(pin?.geotab_zone_id ? 'missing_pinned_id' : 'unresolved', definition.key));
    }
  }
  if (updates.length) await db.batch(updates);
  return { zones: resolved, allResolved: resolved.length === YARD_DEFINITIONS.length };
}

function stateChanged(a: EffectiveState | null, b: EffectiveState) {
  if (!a) return true;
  return a.deviceId !== b.deviceId
    || a.latitude !== b.latitude
    || a.longitude !== b.longitude
    || a.observedAt !== b.observedAt
    || a.receivedAt !== b.receivedAt
    || a.source !== b.source
    || a.communicating !== b.communicating
    || a.communicationObservedAt !== b.communicationObservedAt
    || a.yard !== b.yard
    || a.yardZoneId !== b.yardZoneId
    || a.yardZoneName !== b.yardZoneName
    || a.yardConfirmedAt !== b.yardConfirmedAt;
}

function stateStatement(db: D1Database, equipmentId: number, state: EffectiveState) {
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
    equipmentId, state.deviceId, state.latitude, state.longitude, state.observedAt, state.receivedAt,
    state.source, state.communicating == null ? null : state.communicating ? 1 : 0,
    state.communicationObservedAt, state.yard, state.yardZoneId, state.yardZoneName, state.yardConfirmedAt,
  );
}

export async function syncGeotabGpsShadow(env: Env) {
  const ownerId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const acquired = await acquireLease(env.DB, ownerId);
  if (!acquired) return { ok: true, skipped: true, reason: 'lease-held' };

  const counts: RunCounts = {
    expected: 0, returned: 0, fresh: 0, fallback: 0, noData: 0, identityErrors: 0,
    equivalent: 0, improvement: 0, regression: 0, changed: 0,
  };
  await startRun(env.DB, runId);

  try {
    const expected = await loadExpected(env.DB);
    counts.expected = expected.length;
    counts.identityErrors = await identityErrorCount(env.DB);
    const states = await loadStates(env.DB, expected.map((row) => row.equipment_id));
    await heartbeat(env.DB, ownerId);

    const client = await createGeotabClient(env);
    const canary = await client.call<GeotabJsonRecord[]>('Get', { typeName: 'Device', resultsLimit: 1 });
    if (!Array.isArray(canary) || canary.length === 0) throw new Error('Geotab API canary returned no Device rows.');

    const [rawStatuses, zoneState] = await Promise.all([
      client.call<GeotabJsonRecord[]>('Get', { typeName: 'DeviceStatusInfo' }),
      resolveZones(env.DB, client),
    ]);
    const statuses = statusSnapshots(rawStatuses);
    const expectedDeviceIds = new Set(expected.map((row) => row.assignment_device_id));
    counts.returned = [...statuses.keys()].filter((id) => expectedDeviceIds.has(id)).length;

    const ratio = counts.expected > 0 ? counts.returned / counts.expected : 1;
    if (counts.expected >= CIRCUIT_BREAKER_MIN_EXPECTED && ratio < CIRCUIT_BREAKER_MIN_RETURN_RATIO) {
      const message = `Circuit breaker preserved last-known-good state: ${counts.returned}/${counts.expected} expected devices were returned.`;
      await finishRun(env.DB, runId, 'degraded', 'telemetry-degraded', counts, message);
      return { ok: false, degraded: true, runId, ...counts, message };
    }

    await heartbeat(env.DB, ownerId);
    const writes: D1PreparedStatement[] = [];
    const nowIso = new Date().toISOString();

    for (const row of expected) {
      const storedRow = states.get(row.equipment_id) ?? null;
      const stored = storedRow && storedRow.geotab_device_id === row.assignment_device_id ? fromState(storedRow) : null;
      let effective = stored ?? legacySeed(row);
      const snapshot = statuses.get(row.assignment_device_id);

      if (snapshot) {
        if (snapshot.communicating !== null && snapshot.communicating !== effective.communicating) {
          effective = { ...effective, communicating: snapshot.communicating, communicationObservedAt: nowIso };
        }
        const incomingMs = parseDateMs(snapshot.observedAt);
        const existingMs = parseDateMs(effective.observedAt);
        const newerPosition = snapshot.latitude != null && snapshot.longitude != null && incomingMs != null
          && (existingMs == null || incomingMs > existingMs);
        if (newerPosition) {
          const matched = matchYard(snapshot.longitude!, snapshot.latitude!, zoneState.zones);
          let yard = effective.yard;
          let zoneId = effective.yardZoneId;
          let zoneName = effective.yardZoneName;
          let confirmedAt = effective.yardConfirmedAt;
          if (matched) {
            yard = matched.yard;
            zoneId = matched.zoneId;
            zoneName = matched.zoneName;
            confirmedAt = snapshot.observedAt;
          } else if (zoneState.allResolved) {
            yard = '';
            zoneId = null;
            zoneName = null;
            confirmedAt = snapshot.observedAt;
          }
          effective = {
            ...effective,
            latitude: snapshot.latitude,
            longitude: snapshot.longitude,
            observedAt: snapshot.observedAt,
            receivedAt: nowIso,
            source: 'DeviceStatusInfo',
            yard,
            yardZoneId: zoneId,
            yardZoneName: zoneName,
            yardConfirmedAt: confirmedAt,
          };
        }
      }

      if (stateChanged(stored, effective)) writes.push(stateStatement(env.DB, row.equipment_id, effective));

      const stateFreshness = freshness(effective.observedAt, row.equipment_type);
      if (stateFreshness === 'LIVE' || stateFreshness === 'RECENT') counts.fresh += 1;
      else if (effective.observedAt || effective.yard) counts.fallback += 1;
      else counts.noData += 1;

      const diff = diffCategory(row.legacy_yard, effective.yard);
      counts[diff] += 1;
    }

    for (let index = 0; index < writes.length; index += 75) {
      await heartbeat(env.DB, ownerId);
      await env.DB.batch(writes.slice(index, index + 75));
    }

    const warnings = [
      !zoneState.allResolved ? `${YARD_DEFINITIONS.length - zoneState.zones.length} yard zone pin(s) unresolved` : '',
      counts.identityErrors ? `${counts.identityErrors} active equipment identity issue(s)` : '',
      counts.noData ? `${counts.noData} mapped unit(s) have no GPS history yet` : '',
    ].filter(Boolean);
    const resultStatus = warnings.length ? 'warning' : 'success';
    const message = `GPS shadow compared ${counts.expected} mapped active units; ${counts.returned} returned this cycle; ${writes.length} state row(s) changed.${warnings.length ? ` ${warnings.join('; ')}.` : ''}`;
    await finishRun(env.DB, runId, resultStatus, 'healthy', counts, message);
    return { ok: true, runId, resultStatus, writes: writes.length, zonesResolved: zoneState.zones.length, ...counts, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(env.DB, runId, 'failure', 'api-error', counts, message).catch(() => undefined);
    console.error(JSON.stringify({ event: 'geotab_gps_shadow_failed', runId, error: message }));
    return { ok: false, runId, error: message, ...counts };
  } finally {
    await releaseLease(env.DB, ownerId).catch(() => undefined);
  }
}

export async function getGeotabGpsHealth(db: D1Database) {
  const [expectedResult, lastRun, zoneResult, identityErrors] = await Promise.all([
    db.prepare(`
      SELECT
        e.id AS equipment_id,
        e.unit,
        COALESCE(e.equipment_type, '') AS equipment_type,
        d.geotab_device_id AS assignment_device_id,
        COALESCE(e.current_yard, '') AS legacy_yard,
        s.geotab_device_id AS state_device_id,
        s.gps_observed_at,
        s.gps_source,
        s.communicating,
        s.yard,
        s.yard_zone_name
      FROM equipment_geotab_devices d
      JOIN equipment e ON e.id = d.equipment_id
      LEFT JOIN geotab_unit_state s ON s.equipment_id = e.id
      WHERE d.current = 1
        AND e.active = 1
        AND e.archived_at IS NULL
        AND e.merged_into_equipment_id IS NULL
      ORDER BY e.unit COLLATE NOCASE
    `).all<{
      equipment_id:number; unit:string; equipment_type:string; assignment_device_id:string; legacy_yard:string;
      state_device_id:string|null; gps_observed_at:string|null; gps_source:string|null; communicating:number|null;
      yard:string|null; yard_zone_name:string|null;
    }>(),
    db.prepare(`
      SELECT run_id, started_at, finished_at, result_status, api_status, expected_count, returned_count,
             fresh_count, fallback_count, no_data_count, identity_error_count,
             equivalent_count, improvement_count, regression_count, changed_count, message
      FROM geotab_sync_runs
      WHERE pipeline = ?
      ORDER BY started_at DESC
      LIMIT 1
    `).bind(PIPELINE).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT yard_key, expected_name, geotab_zone_id, geotab_zone_name, status, last_seen_at
      FROM geotab_yard_zones
      ORDER BY yard_key
    `).all<Record<string, unknown>>(),
    identityErrorCount(db),
  ]);

  const units = expectedResult.results.map((row) => {
    const mappedCorrectly = row.state_device_id === row.assignment_device_id;
    const status = mappedCorrectly ? freshness(row.gps_observed_at, row.equipment_type) : 'NO_DATA';
    const yard = mappedCorrectly ? normalizeYard(row.yard) : '';
    const diff = diffCategory(row.legacy_yard, yard);
    return {
      equipmentId: Number(row.equipment_id),
      unit: row.unit,
      equipmentType: row.equipment_type,
      geotabDeviceId: row.assignment_device_id,
      status,
      gpsObservedAt: row.gps_observed_at,
      gpsSource: row.gps_source || 'NO_DATA',
      communicating: row.communicating == null ? null : Boolean(row.communicating),
      yard,
      yardZoneName: row.yard_zone_name || '',
      legacyYard: normalizeYard(row.legacy_yard),
      diffCategory: diff,
      structured: mappedCorrectly && Boolean(row.state_device_id),
    };
  });

  const summary = {
    expected: units.length,
    structured: units.filter((row) => row.structured).length,
    live: units.filter((row) => row.status === 'LIVE').length,
    recent: units.filter((row) => row.status === 'RECENT').length,
    stale: units.filter((row) => row.status === 'STALE').length,
    noData: units.filter((row) => row.status === 'NO_DATA').length,
    offline: units.filter((row) => row.communicating === false).length,
    identityErrors,
    equivalent: units.filter((row) => row.diffCategory === 'equivalent').length,
    improvement: units.filter((row) => row.diffCategory === 'improvement').length,
    regression: units.filter((row) => row.diffCategory === 'regression').length,
    changed: units.filter((row) => row.diffCategory === 'changed').length,
  };
  const lastRunAt = lastRun ? String(lastRun.finished_at || lastRun.started_at || '') : '';
  const lastRunAge = parseDateMs(lastRunAt);
  const runRecent = lastRunAge != null && Date.now() - lastRunAge <= 30 * 60 * 1000;
  const runHealthy = Boolean(lastRun && runRecent && ['success', 'warning'].includes(String(lastRun.result_status)) && String(lastRun.api_status) === 'healthy');
  const status = runHealthy && summary.structured === summary.expected && summary.identityErrors === 0 && summary.regression === 0
    ? (summary.stale || summary.noData || summary.offline ? 'attention' : 'healthy')
    : 'attention';

  const attention = units
    .filter((row) => row.status === 'STALE' || row.status === 'NO_DATA' || row.communicating === false || row.diffCategory === 'regression' || !row.structured)
    .slice(0, 100);

  return {
    status,
    mode: 'shadow',
    summary,
    lastRun: lastRun ?? null,
    zones: zoneResult.results,
    attention,
    updatedAt: new Date().toISOString(),
  };
}
