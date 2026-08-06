import { markDvirRepairedLocal } from './dashboard-db';

export type GeotabEnv = {
  DB: D1Database;
  GEOTAB_CONFIG_PRIVATE_KEY?: string;
};

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Auth = { endpoint: string; credentials: Credentials };
type GeotabLogin = { database: string; userName: string; password: string };
type StoredCredentialRow = {
  database_name: string;
  username: string;
  password_ciphertext: string;
  password_iv: string;
};

const CREDENTIAL_NAME = 'geotab_service';
const CREDENTIAL_AAD = new TextEncoder().encode('norlow-geotab-service-credential-v1');

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

function encodeBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function credentialKey(env: GeotabEnv) {
  if (!env.GEOTAB_CONFIG_PRIVATE_KEY) {
    throw new Error('Cloudflare credential encryption is not configured');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`norlow-geotab-v1:${env.GEOTAB_CONFIG_PRIVATE_KEY}`),
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPassword(env: GeotabEnv, password: string) {
  const key = await credentialKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: CREDENTIAL_AAD },
    key,
    new TextEncoder().encode(password),
  );
  return { ciphertext: encodeBase64(ciphertext), iv: encodeBase64(iv) };
}

async function decryptPassword(env: GeotabEnv, ciphertext: string, iv: string) {
  const key = await credentialKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(iv), additionalData: CREDENTIAL_AAD },
    key,
    decodeBase64(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
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

async function authenticateLogin(login: GeotabLogin): Promise<Auth> {
  const result = await rpc<{ credentials: Credentials; path?: string }>(
    'https://my.geotab.com/apiv1',
    'Authenticate',
    {
      database: login.database,
      userName: login.userName,
      password: login.password,
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

async function verifyServiceAccess(auth: Auth) {
  const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await Promise.all([
    call(auth, 'Get', { typeName: 'Device', resultsLimit: 1 }),
    call(auth, 'Get', { typeName: 'Trailer', resultsLimit: 1 }),
    call(auth, 'Get', { typeName: 'User', resultsLimit: 1 }),
    call(auth, 'Get', { typeName: 'Defect', resultsLimit: 1 }),
    call(auth, 'GetFeed', { typeName: 'DVIRLog', resultsLimit: 1, search: { fromDate } }),
  ]);
}

async function writeCredentialState(db: D1Database, error?: unknown) {
  await db.prepare(`
    INSERT INTO sync_state (feed_name, last_success_at, last_error)
    VALUES ('geotab_service_account', ?, ?)
    ON CONFLICT(feed_name) DO UPDATE SET
      last_success_at = excluded.last_success_at,
      last_error = excluded.last_error
  `).bind(error ? null : new Date().toISOString(), error ? String(error).slice(0, 1000) : null).run();
}

export async function hasGeotabCredential(env: GeotabEnv) {
  if (!env.GEOTAB_CONFIG_PRIVATE_KEY) return false;
  const row = await env.DB.prepare(
    'SELECT 1 AS configured FROM integration_credentials WHERE name = ? LIMIT 1',
  ).bind(CREDENTIAL_NAME).first<{ configured: number }>();
  return Boolean(row?.configured);
}

async function loadLogin(env: GeotabEnv): Promise<GeotabLogin> {
  const row = await env.DB.prepare(`
    SELECT database_name, username, password_ciphertext, password_iv
    FROM integration_credentials
    WHERE name = ?
  `).bind(CREDENTIAL_NAME).first<StoredCredentialRow>();
  if (!row) throw new Error('Geotab service credential is not configured');
  return {
    database: row.database_name,
    userName: row.username,
    password: await decryptPassword(env, row.password_ciphertext, row.password_iv),
  };
}

async function authenticate(env: GeotabEnv) {
  return authenticateLogin(await loadLogin(env));
}

export async function configureGeotabService(
  env: GeotabEnv,
  database: string,
  username: string,
  password: string,
) {
  const login = {
    database: database.trim(),
    userName: username.trim(),
    password,
  };
  if (!login.database || !login.userName || !login.password) {
    throw new Error('Database, username, and password are required');
  }

  try {
    const auth = await authenticateLogin(login);
    await verifyServiceAccess(auth);
    const encrypted = await encryptPassword(env, password);
    await env.DB.prepare(`
      INSERT INTO integration_credentials (
        name, database_name, username, password_ciphertext, password_iv, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        database_name = excluded.database_name,
        username = excluded.username,
        password_ciphertext = excluded.password_ciphertext,
        password_iv = excluded.password_iv,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      CREDENTIAL_NAME,
      login.database,
      login.userName,
      encrypted.ciphertext,
      encrypted.iv,
    ).run();
    await writeCredentialState(env.DB);
    return { ok: true, database: login.database, username: login.userName };
  } catch (error) {
    await writeCredentialState(env.DB, error);
    throw error;
  }
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
  if (!(await hasGeotabCredential(env))) {
    return { ok: true, skipped: true, reason: 'not-configured' };
  }

  const auth = await authenticate(env);
  const state = await env.DB.prepare(
    "SELECT version_token FROM sync_state WHERE feed_name = 'geotab_dvir'",
  ).first<{ version_token: string | null }>();

  try {
    const feedParams: JsonRecord = { typeName: 'DVIRLog', resultsLimit: 5000 };
    if (state?.version_token) {
      feedParams.fromVersion = state.version_token;
    } else {
      feedParams.search = {
        fromDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    const feed = await call<{ data?: JsonRecord[]; toVersion?: string | number }>(
      auth,
      'GetFeed',
      feedParams,
    );
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
        ON CONFLICT(unit) DO UPDATE SET
          equipment_type = 'truck',
          geotab_device_id = excluded.geotab_device_id,
          active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(unit, id));
    }
    for (const trailer of trailers) {
      const id = objectId(trailer);
      const unit = objectName(trailer);
      if (!id || !unit) continue;
      equipmentStatements.push(env.DB.prepare(`
        INSERT INTO equipment (unit, category, equipment_type, geotab_trailer_id, updated_at)
        VALUES (?, 'fleet', 'trailer', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(unit) DO UPDATE SET
          equipment_type = 'trailer',
          geotab_trailer_id = excluded.geotab_trailer_id,
          active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(unit, id));
    }
    await runInChunks(env.DB, equipmentStatements);

    const statements: D1PreparedStatement[] = [];
    for (const log of logs) {
      const logId = text(get(log, 'id', 'Id'));
      if (!logId) continue;
      const deviceId = objectId(get(log, 'device', 'Device'));
      const trailerId = objectId(get(log, 'trailer', 'Trailer'));
      const unit = objectName(get(log, 'device', 'Device')) ||
        objectName(get(log, 'trailer', 'Trailer')) ||
        deviceNames.get(deviceId) || trailerNames.get(trailerId) ||
        deviceId || trailerId || 'Unknown';
      const driverId = objectId(get(log, 'driver', 'Driver'));
      const driver = objectName(get(log, 'driver', 'Driver')) || userNames.get(driverId) || '';
      const driverRemark = text(get(log, 'driverRemark', 'DriverRemark'));
      const rawJson = JSON.stringify(log);
      statements.push(env.DB.prepare(
        'DELETE FROM dvir_defects WHERE geotab_log_id = ?',
      ).bind(logId));

      for (const dvirDefect of array(get(log, 'dvirDefects', 'DVIRDefects'))) {
        const defectId = text(get(dvirDefect, 'id', 'Id'));
        if (!defectId) continue;
        const definitionId = objectId(get(dvirDefect, 'defect', 'Defect'));
        const partName = objectName(get(dvirDefect, 'part', 'Part'));
        const definitionName = objectName(get(dvirDefect, 'defect', 'Defect')) ||
          defectNames.get(definitionId) || '';
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
            geotab_log_id = excluded.geotab_log_id,
            asset_unit = excluded.asset_unit,
            driver = excluded.driver,
            defect = excluded.defect,
            comments = excluded.comments,
            repaired = excluded.repaired,
            repair_date = excluded.repair_date,
            raw_json = excluded.raw_json,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          logId,
          defectId,
          unit,
          driver,
          defectName,
          commentText,
          repaired,
          repairDate,
          rawJson,
        ));
      }
    }
    await runInChunks(env.DB, statements);

    const toVersion = feed.toVersion == null
      ? state?.version_token ?? null
      : String(feed.toVersion);
    await env.DB.prepare(`
      INSERT INTO sync_state (feed_name, version_token, last_success_at, last_error)
      VALUES ('geotab_dvir', ?, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(feed_name) DO UPDATE SET
        version_token = excluded.version_token,
        last_success_at = CURRENT_TIMESTAMP,
        last_error = NULL
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

export async function markGeotabDefectRepaired(
  env: GeotabEnv,
  logId: string,
  defectId: string,
) {
  const auth = await authenticate(env);
  const logs = await call<JsonRecord[]>(auth, 'Get', {
    typeName: 'DVIRLog',
    search: { id: logId },
  });
  const log = record(logs[0]);
  if (!objectId(log)) throw new Error('Geotab DVIR log not found');

  let repairUserId = auth.credentials.userName;
  try {
    const users = await call<JsonRecord[]>(auth, 'Get', {
      typeName: 'User',
      search: { name: auth.credentials.userName },
    });
    repairUserId = objectId(users[0]) || repairUserId;
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_repair_user_lookup_failed', error: String(error) }));
  }

  const defectList = array(get(log, 'dvirDefects', 'DVIRDefects'));
  const target = defectList.find((candidate) => objectId(candidate) === defectId);
  if (!target) throw new Error('Geotab DVIR defect not found');
  target.repairStatus = 'Repaired';
  target.repairDateTime = new Date().toISOString();
  target.repairUser = { id: repairUserId };
  log.dvirDefects = defectList;
  delete log.version;
  delete log.Version;

  await call(auth, 'Set', { typeName: 'DVIRLog', entity: log });
  await markDvirRepairedLocal(env.DB, defectId);
  return { ok: true, logId, defectId };
}
