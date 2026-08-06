import { markDvirRepairedLocal } from './dashboard-db';

export type GeotabEnv = {
  DB: D1Database;
  GEOTAB_DATABASE?: string;
  GEOTAB_USERNAME?: string;
  GEOTAB_PASSWORD?: string;
};

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Auth = { endpoint: string; credentials: Credentials };

export function isGeotabConfigured(env: GeotabEnv) {
  return Boolean(env.GEOTAB_DATABASE && env.GEOTAB_USERNAME && env.GEOTAB_PASSWORD);
}

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
  for (const name of names) {
    if (name in source) return source[name];
  }
  return undefined;
}

function objectId(value: unknown) {
  return text(get(record(value), 'id', 'Id'));
}

function objectName(value: unknown) {
  return text(get(record(value), 'name', 'Name'));
}

async function rpc<T>(endpoint: string, method: string, params: JsonRecord): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) throw new Error(`Geotab ${method} returned HTTP ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || `Geotab ${method} failed`);
  if (payload.result === undefined) throw new Error(`Geotab ${method} returned no result`);
  return payload.result;
}

async function authenticate(env: GeotabEnv): Promise<Auth> {
  if (!isGeotabConfigured(env)) throw new Error('Geotab is not configured');
  const result = await rpc<{ credentials: Credentials; path?: string }>(
    'https://my.geotab.com/apiv1',
    'Authenticate',
    {
      database: env.GEOTAB_DATABASE,
      userName: env.GEOTAB_USERNAME,
      password: env.GEOTAB_PASSWORD,
    },
  );
  const host = text(result.path || 'my.geotab.com')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  return { endpoint: `https://${host}/apiv1`, credentials: result.credentials };
}

async function call<T>(auth: Auth, method: string, params: JsonRecord): Promise<T> {
  return rpc<T>(auth.endpoint, method, { ...params, credentials: auth.credentials });
}

async function safeGetAll(auth: Auth, typeName: string) {
  try {
    return await call<JsonRecord[]>(auth, 'Get', { typeName });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_lookup_failed', typeName, error: String(error) }));
    return [];
  }
}

function lookupById(rows: JsonRecord[]) {
  const result = new Map<string, string>();
  for (const row of rows) {
    const id = objectId(row);
    const name = objectName(row);
    if (id) result.set(id, name || id);
  }
  return result;
}

function remarks(defect: JsonRecord) {
  return array(get(defect, 'defectRemarks', 'DefectRemarks'))
    .map((remark) => text(get(remark, 'remark', 'Remark')))
    .filter(Boolean);
}

async function runInChunks(db: D1Database, statements: D1PreparedStatement[], chunkSize = 75) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
}

export async function syncGeotabDvir(env: GeotabEnv) {
  if (!isGeotabConfigured(env)) return { ok: true, skipped: true, reason: 'not-configured' };
  const auth = await authenticate(env);
  const state = await env.DB.prepare("SELECT version_token FROM sync_state WHERE feed_name = 'geotab_dvir'")
    .first<{ version_token: string | null }>();

  try {
    const feedParams: JsonRecord = { typeName: 'DVIRLog', resultsLimit: 5000 };
    if (state?.version_token) {
      feedParams.fromVersion = state.version_token;
    } else {
      feedParams.search = { fromDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString() };
    }

    const feed = await call<{ data?: JsonRecord[]; toVersion?: string | number }>(auth, 'GetFeed', feedParams);
    const logs = array(feed.data);
    const [devices, trailers, users, defects] = await Promise.all([
      safeGetAll(auth, 'Device'),
      safeGetAll(auth, 'Trailer'),
      safeGetAll(auth, 'User'),
      safeGetAll(auth, 'Defect'),
    ]);
    const deviceNames = lookupById(devices);
    const trailerNames = lookupById(trailers);
    const userNames = lookupById(users);
    const defectNames = lookupById(defects);

    const equipmentStatements: D1PreparedStatement[] = [];
    for (const device of devices) {
      const id = objectId(device);
      const unit = objectName(device);
      if (!id || !unit) continue;
      equipmentStatements.push(env.DB.prepare(`
        INSERT INTO equipment (unit, category, equipment_type, geotab_device_id, updated_at)
        VALUES (?, 'fleet', 'truck', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(unit) DO UPDATE SET equipment_type = 'truck', geotab_device_id = excluded.geotab_device_id,
          active = 1, updated_at = CURRENT_TIMESTAMP
      `).bind(unit, id));
    }
    for (const trailer of trailers) {
      const id = objectId(trailer);
      const unit = objectName(trailer);
      if (!id || !unit) continue;
      equipmentStatements.push(env.DB.prepare(`
        INSERT INTO equipment (unit, category, equipment_type, geotab_trailer_id, updated_at)
        VALUES (?, 'fleet', 'trailer', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(unit) DO UPDATE SET equipment_type = 'trailer', geotab_trailer_id = excluded.geotab_trailer_id,
          active = 1, updated_at = CURRENT_TIMESTAMP
      `).bind(unit, id));
    }
    await runInChunks(env.DB, equipmentStatements);

    const statements: D1PreparedStatement[] = [];
    for (const log of logs) {
      const logId = text(get(log, 'id', 'Id'));
      if (!logId) continue;
      const deviceId = objectId(get(log, 'device', 'Device'));
      const trailerId = objectId(get(log, 'trailer', 'Trailer'));
      const unit = objectName(get(log, 'device', 'Device')) || objectName(get(log, 'trailer', 'Trailer')) ||
        deviceNames.get(deviceId) || trailerNames.get(trailerId) || deviceId || trailerId || 'Unknown';
      const driverId = objectId(get(log, 'driver', 'Driver'));
      const driver = objectName(get(log, 'driver', 'Driver')) || userNames.get(driverId) || '';
      const driverRemark = text(get(log, 'driverRemark', 'DriverRemark'));
      const rawJson = JSON.stringify(log);
      statements.push(env.DB.prepare('DELETE FROM dvir_defects WHERE geotab_log_id = ?').bind(logId));

      for (const dvirDefect of array(get(log, 'dvirDefects', 'DVIRDefects'))) {
        const defectId = text(get(dvirDefect, 'id', 'Id'));
        if (!defectId) continue;
        const definitionId = objectId(get(dvirDefect, 'defect', 'Defect'));
        const partName = objectName(get(dvirDefect, 'part', 'Part'));
        const definitionName = objectName(get(dvirDefect, 'defect', 'Defect')) || defectNames.get(definitionId) || '';
        const defectName = [partName, definitionName].filter(Boolean).join(' — ') || 'DVIR defect';
        const commentText = [driverRemark, ...remarks(dvirDefect)].filter(Boolean).join(' | ');
        const repairStatus = text(get(dvirDefect, 'repairStatus', 'RepairStatus'));
        const repaired = repairStatus && repairStatus.toLowerCase() !== 'notrepaired' ? 1 : 0;
        const repairDate = text(get(dvirDefect, 'repairDateTime', 'RepairDateTime')) || null;
        statements.push(env.DB.prepare(`
          INSERT INTO dvir_defects (
            geotab_log_id, geotab_defect_id, asset_unit, driver, defect, comments,
            photos_url, repaired, repair_date, raw_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(geotab_defect_id) DO UPDATE SET
            geotab_log_id = excluded.geotab_log_id, asset_unit = excluded.asset_unit,
            driver = excluded.driver, defect = excluded.defect, comments = excluded.comments,
            repaired = excluded.repaired, repair_date = excluded.repair_date,
            raw_json = excluded.raw_json, updated_at = CURRENT_TIMESTAMP
        `).bind(logId, defectId, unit, driver, defectName, commentText, repaired, repairDate, rawJson));
      }
    }
    await runInChunks(env.DB, statements);

    const toVersion = feed.toVersion == null ? state?.version_token ?? null : String(feed.toVersion);
    await env.DB.prepare(`
      INSERT INTO sync_state (feed_name, version_token, last_success_at, last_error)
      VALUES ('geotab_dvir', ?, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(feed_name) DO UPDATE SET version_token = excluded.version_token,
        last_success_at = CURRENT_TIMESTAMP, last_error = NULL
    `).bind(toVersion).run();

    return { ok: true, skipped: false, logs: logs.length, toVersion };
  } catch (error) {
    await env.DB.prepare(`
      INSERT INTO sync_state (feed_name, last_error)
      VALUES ('geotab_dvir', ?)
      ON CONFLICT(feed_name) DO UPDATE SET last_error = excluded.last_error
    `).bind(String(error).slice(0, 1000)).run();
    throw error;
  }
}

export async function markGeotabDefectRepaired(env: GeotabEnv, logId: string, defectId: string) {
  if (!isGeotabConfigured(env)) throw new Error('Geotab is not configured');
  const auth = await authenticate(env);
  const logs = await call<JsonRecord[]>(auth, 'Get', { typeName: 'DVIRLog', search: { id: logId } });
  const log = record(logs[0]);
  if (!objectId(log)) throw new Error('Geotab DVIR log not found');

  const users = await safeGetAll(auth, 'User');
  const user = users.find((candidate) => {
    const name = objectName(candidate).toLowerCase();
    return name === text(env.GEOTAB_USERNAME).toLowerCase();
  }) || users[0];
  const userId = objectId(user);
  if (!userId) throw new Error('Geotab repair user could not be resolved');

  const defectList = array(get(log, 'dvirDefects', 'DVIRDefects'));
  const target = defectList.find((candidate) => objectId(candidate) === defectId);
  if (!target) throw new Error('Geotab DVIR defect not found');
  target.repairStatus = 'Repaired';
  target.repairDateTime = new Date().toISOString();
  target.repairUser = { id: userId };
  log.dvirDefects = defectList;
  delete log.version;
  delete log.Version;

  await call(auth, 'Set', { typeName: 'DVIRLog', entity: log });
  await markDvirRepairedLocal(env.DB, defectId);
  return { ok: true, logId, defectId };
}
