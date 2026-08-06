import { markDvirRepairedLocal } from './dashboard-db';
import { geotabProtectedConfig } from './geotab-protected-config';

export type GeotabEnv = {
  DB: D1Database;
  GEOTAB_DATABASE?: string;
  GEOTAB_USERNAME?: string;
  GEOTAB_PASSWORD?: string;
  GEOTAB_CONFIG_PRIVATE_KEY?: string;
};

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Auth = { endpoint: string; credentials: Credentials };
type GeotabLogin = { database: string; userName: string; password: string };
type ProtectedGeotabConfig = {
  database: string;
  serviceUsername: string;
  servicePassword: string;
};

type GeotabPayload<T> = {
  result?: T;
  error?: { message?: string; name?: string };
};

let protectedLoginPromise: Promise<GeotabLogin> | undefined;

export function isGeotabConfigured(env: GeotabEnv) {
  const direct = Boolean(env.GEOTAB_DATABASE && env.GEOTAB_USERNAME && env.GEOTAB_PASSWORD);
  return direct || Boolean(env.GEOTAB_CONFIG_PRIVATE_KEY);
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

function dvirDefects(log: JsonRecord) {
  return array(get(log, 'dVIRDefects', 'dvirDefects', 'DVIRDefects'));
}

function setDvirDefects(log: JsonRecord, defects: JsonRecord[]) {
  if ('dVIRDefects' in log) log.dVIRDefects = defects;
  else if ('dvirDefects' in log) log.dvirDefects = defects;
  else if ('DVIRDefects' in log) log.DVIRDefects = defects;
  else log.dVIRDefects = defects;
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

async function decryptProtectedLogin(env: GeotabEnv): Promise<GeotabLogin> {
  const privateKeyPem = env.GEOTAB_CONFIG_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('Geotab encrypted configuration key is missing');

  if (!protectedLoginPromise) {
    protectedLoginPromise = (async () => {
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        decodePem(privateKeyPem),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt'],
      );
      const rawAesKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        decodeBase64(geotabProtectedConfig.wrappedKey),
      );
      const aesKey = await crypto.subtle.importKey(
        'raw',
        rawAesKey,
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64(geotabProtectedConfig.iv) },
        aesKey,
        decodeBase64(geotabProtectedConfig.ciphertext),
      );
      const config = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<ProtectedGeotabConfig>;
      if (!config.database || !config.serviceUsername || !config.servicePassword) {
        throw new Error('Geotab encrypted service-account configuration is incomplete');
      }
      return {
        database: config.database,
        userName: config.serviceUsername,
        password: config.servicePassword,
      };
    })();
  }

  return protectedLoginPromise;
}

function cleanApiMessage(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[service-account]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[redacted]')
    .replace(/sessionId\s*[:=]\s*\S+/gi, 'sessionId=[redacted]')
    .slice(0, 500);
}

async function rpc<T>(endpoint: string, method: string, params: JsonRecord): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ method, params }),
  });

  if (!response.ok) {
    const body = cleanApiMessage(await response.text());
    throw new Error(`Geotab ${method} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }

  const payload = await response.json() as GeotabPayload<T>;
  if (payload.error) {
    const detail = cleanApiMessage(payload.error.message || payload.error.name || 'unknown API error');
    throw new Error(`Geotab ${method} failed: ${detail}`);
  }
  if (payload.result === undefined) throw new Error(`Geotab ${method} returned no result`);
  return payload.result;
}

function endpointFromPath(pathValue: unknown) {
  const path = text(pathValue).trim();
  if (!path || path.toLowerCase() === 'thisserver') return 'https://my.geotab.com/apiv1';
  const host = path
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('Geotab returned an invalid API path');
  return `https://${host}/apiv1`;
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
  return { endpoint: endpointFromPath(result.path), credentials: result.credentials };
}

async function call<T>(auth: Auth, method: string, params: JsonRecord): Promise<T> {
  return rpc<T>(auth.endpoint, method, { ...params, credentials: auth.credentials });
}

async function resolveGeotabLogin(env: GeotabEnv): Promise<GeotabLogin> {
  if (env.GEOTAB_DATABASE && env.GEOTAB_USERNAME && env.GEOTAB_PASSWORD) {
    return {
      database: env.GEOTAB_DATABASE,
      userName: env.GEOTAB_USERNAME,
      password: env.GEOTAB_PASSWORD,
    };
  }
  return decryptProtectedLogin(env);
}

async function authenticate(env: GeotabEnv): Promise<Auth> {
  if (!isGeotabConfigured(env)) throw new Error('Geotab is not configured');
  return authenticateLogin(await resolveGeotabLogin(env));
}

async function safeGetAll(auth: Auth, typeName: string, search?: JsonRecord) {
  try {
    return await call<JsonRecord[]>(auth, 'Get', {
      typeName,
      resultsLimit: 50000,
      ...(search ? { search } : {}),
    });
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
    .map((remark) => text(get(remark, 'remark', 'Remark')).trim())
    .filter(Boolean);
}

function mediaIds(defect: JsonRecord) {
  const ids = new Set<string>();
  for (const remark of array(get(defect, 'defectRemarks', 'DefectRemarks'))) {
    for (const media of array(get(remark, 'mediaFiles', 'MediaFiles'))) {
      const id = objectId(media);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function isRepaired(defect: JsonRecord) {
  const status = text(get(defect, 'repairStatus', 'RepairStatus')).toLowerCase();
  return status === 'repaired' || Boolean(
    get(defect, 'repairDateTime', 'RepairDateTime') || get(defect, 'repairUser', 'RepairUser'),
  );
}

function isSafeAndReviewed(log: JsonRecord) {
  const safe = get(log, 'isSafeToOperate', 'IsSafeToOperate') === true || get(log, 'isSafe', 'IsSafe') === true;
  const reviewed = Boolean(
    get(log, 'certifyDate', 'CertifyDate') ||
    get(log, 'certifiedBy', 'CertifiedBy') ||
    get(log, 'certifiedByUser', 'CertifiedByUser') ||
    get(log, 'reviewDate', 'ReviewDate') ||
    get(log, 'reviewedBy', 'ReviewedBy'),
  );
  return safe && reviewed;
}

function locationText(log: JsonRecord) {
  const location = get(log, 'location', 'Location');
  if (typeof location === 'string') return location;
  const value = record(location);
  return text(
    get(value, 'formattedAddress', 'FormattedAddress', 'city', 'City', 'address', 'Address'),
  );
}

function resolveDefectName(defect: JsonRecord, translations: Map<string, string>) {
  const partObject = get(defect, 'defectListPart', 'DefectListPart', 'part', 'Part', 'defectPart', 'DefectPart');
  const definitionObject = get(defect, 'defect', 'Defect', 'defectList', 'DefectList');
  const partId = objectId(partObject);
  const definitionId = objectId(definitionObject);
  const partName = translations.get(partId) || objectName(partObject);
  const definitionName = translations.get(definitionId) || objectName(definitionObject);
  if (partName && definitionName && partName !== definitionName) return `${partName} - ${definitionName}`;
  return definitionName || partName || 'DVIR defect';
}

async function runInChunks(db: D1Database, statements: D1PreparedStatement[], chunkSize = 75) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
}

export async function syncGeotabDvir(env: GeotabEnv) {
  if (!isGeotabConfigured(env)) return { ok: true, skipped: true, reason: 'not-configured' };
  const auth = await authenticate(env);

  try {
    const state = await env.DB.prepare(
      "SELECT last_success_at FROM sync_state WHERE feed_name = 'geotab_dvir'",
    ).first<{ last_success_at: string | null }>();
    const previous = state?.last_success_at ? Date.parse(state.last_success_at) : Number.NaN;
    const fromMs = Number.isFinite(previous)
      ? Math.max(previous - 24 * 60 * 60 * 1000, Date.now() - 120 * 24 * 60 * 60 * 1000)
      : Date.now() - 120 * 24 * 60 * 60 * 1000;
    const toDate = new Date().toISOString();
    const fromDate = new Date(fromMs).toISOString();

    const logs = await call<JsonRecord[]>(auth, 'Get', {
      typeName: 'DVIRLog',
      search: { fromDate, toDate },
      resultsLimit: 50000,
    });

    const [devices, trailers, users, defects, defectLists, defectParts, defectListParts] = await Promise.all([
      safeGetAll(auth, 'Device'),
      safeGetAll(auth, 'Trailer'),
      safeGetAll(auth, 'User'),
      safeGetAll(auth, 'Defect', { includeAllTrees: true }),
      safeGetAll(auth, 'DefectList', { includeAllTrees: true }),
      safeGetAll(auth, 'DefectPart'),
      safeGetAll(auth, 'DefectListPart'),
    ]);

    const deviceNames = lookupById(devices);
    const trailerNames = lookupById(trailers);
    const userNames = lookupById(users);
    const translations = lookupById([...defects, ...defectLists, ...defectParts, ...defectListParts]);

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
    let defectCount = 0;
    for (const log of logs) {
      const logId = objectId(log);
      if (!logId) continue;
      const trailerId = objectId(get(log, 'trailer', 'Trailer'));
      const deviceId = objectId(get(log, 'device', 'Device'));
      const unit = objectName(get(log, 'trailer', 'Trailer')) || trailerNames.get(trailerId) ||
        objectName(get(log, 'device', 'Device')) || deviceNames.get(deviceId) ||
        trailerId || deviceId || 'Unknown Asset';
      const driverId = objectId(get(log, 'driver', 'Driver'));
      const driver = objectName(get(log, 'driver', 'Driver')) || userNames.get(driverId) || 'Unknown Driver';
      const driverRemark = text(get(log, 'driverRemark', 'DriverRemark')).trim();
      const location = locationText(log);
      const safeReviewed = isSafeAndReviewed(log);
      const rawJson = JSON.stringify(log);

      for (const defect of dvirDefects(log)) {
        const defectId = objectId(defect);
        if (!defectId) continue;
        const repaired = isRepaired(defect);
        const defectName = resolveDefectName(defect, translations);
        if (!defectName || defectName.toLowerCase() === 'none') continue;
        const commentText = [driverRemark, ...remarks(defect)].filter(Boolean).join(' | ');
        const photos = mediaIds(defect);
        const repairDate = text(get(defect, 'repairDateTime', 'RepairDateTime')) || null;
        defectCount += 1;

        statements.push(env.DB.prepare(`
          INSERT INTO dvir_defects (
            geotab_log_id, geotab_defect_id, asset_unit, driver, defect, comments,
            photos_url, repaired, repair_date, raw_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(geotab_defect_id) DO UPDATE SET
            geotab_log_id = excluded.geotab_log_id, asset_unit = excluded.asset_unit,
            driver = excluded.driver, defect = excluded.defect, comments = excluded.comments,
            photos_url = excluded.photos_url, repaired = excluded.repaired,
            repair_date = excluded.repair_date, raw_json = excluded.raw_json,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          logId,
          defectId,
          unit,
          driver,
          defectName,
          [commentText, location ? `Location: ${location}` : '', safeReviewed ? 'Inspection reviewed and safe' : ''].filter(Boolean).join(' | '),
          photos.length ? `geotab-media:${photos.join(',')}` : '',
          repaired ? 1 : 0,
          repairDate,
          rawJson,
        ));
      }
    }
    await runInChunks(env.DB, statements);

    await env.DB.prepare(`
      INSERT INTO sync_state (feed_name, version_token, last_success_at, last_error)
      VALUES ('geotab_dvir', NULL, ?, NULL)
      ON CONFLICT(feed_name) DO UPDATE SET version_token = NULL,
        last_success_at = excluded.last_success_at, last_error = NULL
    `).bind(toDate).run();

    return { ok: true, skipped: false, logs: logs.length, defects: defectCount, fromDate, toDate };
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
  if (!logId || !defectId) throw new Error('Geotab log ID and defect ID are required');
  const auth = await authenticate(env);
  const logs = await call<JsonRecord[]>(auth, 'Get', {
    typeName: 'DVIRLog',
    search: { id: logId },
    resultsLimit: 1,
  });
  const log = record(logs[0]);
  if (!objectId(log)) throw new Error('Geotab DVIR log not found');

  const users = await call<JsonRecord[]>(auth, 'Get', {
    typeName: 'User',
    search: { name: auth.credentials.userName },
    resultsLimit: 10,
  });
  const repairUser = users.find(
    (candidate) => objectName(candidate).toLowerCase() === auth.credentials.userName.toLowerCase(),
  );
  const repairUserId = objectId(repairUser);
  if (!repairUserId) throw new Error('Geotab repair user could not be resolved');

  const defects = dvirDefects(log);
  const target = defects.find((candidate) => objectId(candidate) === defectId);
  if (!target) throw new Error('Geotab DVIR defect not found');
  target.repairStatus = 'Repaired';
  target.repairDateTime = new Date().toISOString();
  target.repairUser = { id: repairUserId };
  setDvirDefects(log, defects);

  await call(auth, 'Set', { typeName: 'DVIRLog', entity: log });
  await markDvirRepairedLocal(env.DB, defectId);
  return { ok: true, logId, defectId };
}
