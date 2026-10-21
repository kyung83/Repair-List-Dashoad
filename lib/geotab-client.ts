import { assertDedicatedGeotabUsername, GEOTAB_SERVICE_ACCOUNT_REQUIRED } from './geotab-account-policy.js';
import {
  decryptGeotabRuntimeSecret,
  encryptGeotabRuntimeSecret,
  loadGeotabRuntimeCredentials,
} from './geotab-runtime-credentials';

export type GeotabClientEnv = {
  DB?: D1Database;
  GEOTAB_CONFIG_PRIVATE_KEY?: string;
  AUTH_BOOTSTRAP_TOKEN?: string;
};

export type GeotabCredentialInput = {
  database: string;
  username: string;
  password: string;
};

export type GeotabJsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Login = { database: string; userName: string; password: string };
type Auth = { endpoint: string; credentials: Credentials };
type Payload<T> = { result?: T; error?: { message?: string; name?: string } };
type SharedSessionRow = {
  database_name: string;
  username: string;
  endpoint: string;
  session_ciphertext: string;
  session_iv: string;
};

export function geotabRecord(value: unknown): GeotabJsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as GeotabJsonRecord : {};
}

export function geotabArray(value: unknown): GeotabJsonRecord[] {
  return Array.isArray(value) ? value.map(geotabRecord) : [];
}

export function geotabText(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function geotabGet(source: GeotabJsonRecord, ...names: string[]) {
  for (const name of names) if (name in source) return source[name];
  return undefined;
}

export function geotabObjectId(value: unknown) {
  return geotabText(geotabGet(geotabRecord(value), 'id', 'Id')).trim();
}

function cleanApiMessage(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[service-account]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[redacted]')
    .replace(/sessionId\s*[:=]\s*\S+/gi, 'sessionId=[redacted]')
    .slice(0, 500);
}

async function configuredLogin(env: GeotabClientEnv): Promise<Login> {
  // Never use Cloudflare GEOTAB_USERNAME/password or the legacy bundled RSA
  // credential, even when the D1 service-account record is missing.
  if (!env.DB) throw new Error(GEOTAB_SERVICE_ACCOUNT_REQUIRED);
  const runtime = await loadGeotabRuntimeCredentials(env.DB, env);
  if (!runtime) throw new Error(GEOTAB_SERVICE_ACCOUNT_REQUIRED);
  assertDedicatedGeotabUsername(runtime.username);
  return { database: runtime.database, userName: runtime.username, password: runtime.password };
}

function endpointFromPath(pathValue: unknown) {
  const path = geotabText(pathValue).trim();
  if (!path || path.toLowerCase() === 'thisserver') return 'https://my.geotab.com/apiv1';
  const host = path.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('Geotab returned an invalid API path');
  return `https://${host}/apiv1`;
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(5000, retryAfter * 1000);
  return Math.min(5000, 500 * (2 ** attempt) + Math.floor(Math.random() * 250));
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function rpc<T>(endpoint: string, method: string, params: GeotabJsonRecord): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ method, params }),
      });
      if (!response.ok) {
        const body = cleanApiMessage(await response.text());
        const error = new Error(`Geotab ${method} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          lastError = error;
          await wait(retryDelay(response, attempt));
          continue;
        }
        throw error;
      }
      const payload = await response.json() as Payload<T>;
      if (payload.error) {
        const detail = cleanApiMessage(payload.error.message || payload.error.name || 'unknown API error');
        throw new Error(`Geotab ${method} failed: ${detail}`);
      }
      if (payload.result === undefined) throw new Error(`Geotab ${method} returned no result`);
      return payload.result;
    } catch (error) {
      lastError = error;
      if (attempt >= 2) break;
      await wait(Math.min(5000, 500 * (2 ** attempt) + Math.floor(Math.random() * 250)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Geotab ${method} failed after retries.`);
}

async function authenticateLogin(login: Login): Promise<Auth> {
  const result = await rpc<{ credentials: Credentials; path?: string }>('https://my.geotab.com/apiv1', 'Authenticate', {
    database: login.database,
    userName: login.userName,
    password: login.password,
  });
  return { endpoint: endpointFromPath(result.path), credentials: result.credentials };
}

async function loadSharedAuth(env: GeotabClientEnv, login: Login): Promise<Auth | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(`
      SELECT database_name, username, endpoint, session_ciphertext, session_iv
      FROM geotab_runtime_sessions
      WHERE id = 1
    `).first<SharedSessionRow>();
    if (!row) return null;
    if (String(row.database_name) !== login.database || String(row.username) !== login.userName) return null;
    const sessionId = await decryptGeotabRuntimeSecret(row.session_ciphertext, row.session_iv, env);
    if (!sessionId) return null;
    return {
      endpoint: String(row.endpoint),
      credentials: { database: login.database, userName: login.userName, sessionId },
    };
  } catch (error) {
    console.warn(JSON.stringify({ event: 'geotab_shared_session_load_failed', error: cleanApiMessage(String(error)) }));
    return null;
  }
}

async function saveSharedAuth(env: GeotabClientEnv, auth: Auth) {
  if (!env.DB) return;
  try {
    const encrypted = await encryptGeotabRuntimeSecret(auth.credentials.sessionId, env);
    await env.DB.prepare(`
      INSERT INTO geotab_runtime_sessions (
        id, database_name, username, endpoint, session_ciphertext, session_iv, authenticated_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        database_name = excluded.database_name,
        username = excluded.username,
        endpoint = excluded.endpoint,
        session_ciphertext = excluded.session_ciphertext,
        session_iv = excluded.session_iv,
        authenticated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      auth.credentials.database,
      auth.credentials.userName,
      auth.endpoint,
      encrypted.ciphertext,
      encrypted.iv,
    ).run();
  } catch (error) {
    console.warn(JSON.stringify({ event: 'geotab_shared_session_save_failed', error: cleanApiMessage(String(error)) }));
  }
}

async function clearSharedAuth(env: GeotabClientEnv) {
  if (!env.DB) return;
  try {
    await env.DB.prepare('DELETE FROM geotab_runtime_sessions WHERE id = 1').run();
  } catch {
    // The session cache is an optimization. A missing table during a rolling migration must not block Geotab.
  }
}

function looksLikeAuthenticationFailure(error: unknown) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes('invaliduser')
    || message.includes('invalid session')
    || message.includes('session has expired')
    || message.includes('sessionid')
    || message.includes('credentials')
    || message.includes('authentication');
}

async function freshAuth(env: GeotabClientEnv, login: Login) {
  const auth = await authenticateLogin(login);
  await saveSharedAuth(env, auth);
  return auth;
}

export async function testGeotabCredentials(input: GeotabCredentialInput) {
  const database = String(input.database || '').trim();
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  if (!database || !username || !password) throw new Error('Database, username, and password are required.');
  assertDedicatedGeotabUsername(username);
  await authenticateLogin({ database, userName: username, password });
  return { ok: true } as const;
}

async function downloadMediaFile(auth: Auth, mediaId: string) {
  // DownloadMediaFile returns raw image bytes, not the JSON envelope handled
  // by rpc(). Reuse the EXACT same saved service-account session as Get/Set.
  const response = await fetch(auth.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'image/*,application/octet-stream,application/json' },
    body: JSON.stringify({
      method: 'DownloadMediaFile',
      params: { credentials: auth.credentials, mediaFile: { id: mediaId } },
    }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Geotab authentication expired during DownloadMediaFile (HTTP ' + response.status + ').');
    }
    throw new Error('Geotab DownloadMediaFile returned HTTP ' + response.status);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) {
    if (contentType === 'application/json') {
      const result = await response.json().catch(() => null) as Payload<unknown> | null;
      const message = cleanApiMessage(result?.error?.message || result?.error?.name || 'not an image');
      throw new Error('Geotab DownloadMediaFile failed: ' + message);
    }
    throw new Error('Geotab media response was not an image.');
  }
  return { bytes: await response.arrayBuffer(), contentType };
}

export async function createGeotabClient(env: GeotabClientEnv) {
  const login = await configuredLogin(env);
  let auth = await loadSharedAuth(env, login);
  if (!auth) auth = await freshAuth(env, login);

  return {
    userName: login.userName,
    get endpointHost() { return new URL(auth.endpoint).hostname; },
    async call<T>(method: string, params: GeotabJsonRecord) {
      try {
        return await rpc<T>(auth.endpoint, method, { ...params, credentials: auth.credentials });
      } catch (error) {
        if (!looksLikeAuthenticationFailure(error)) throw error;
        await clearSharedAuth(env);
        auth = await freshAuth(env, login);
        return rpc<T>(auth.endpoint, method, { ...params, credentials: auth.credentials });
      }
    },
    async downloadMedia(mediaId: string) {
      try {
        return await downloadMediaFile(auth, mediaId);
      } catch (error) {
        if (!looksLikeAuthenticationFailure(error)) throw error;
        await clearSharedAuth(env);
        auth = await freshAuth(env, login);
        return downloadMediaFile(auth, mediaId);
      }
    },
  };
}
