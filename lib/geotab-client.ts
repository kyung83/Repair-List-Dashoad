import { geotabProtectedConfig } from './geotab-protected-config';

export type GeotabClientEnv = {
  GEOTAB_DATABASE?: string;
  GEOTAB_USERNAME?: string;
  GEOTAB_PASSWORD?: string;
  GEOTAB_CONFIG_PRIVATE_KEY?: string;
};

export type GeotabJsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Login = { database: string; userName: string; password: string };
type Auth = { endpoint: string; credentials: Credentials };
type ProtectedConfig = { database: string; serviceUsername: string; servicePassword: string };
type Payload<T> = { result?: T; error?: { message?: string; name?: string } };

let protectedLoginPromise: Promise<Login> | undefined;

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

async function protectedLogin(env: GeotabClientEnv): Promise<Login> {
  if (env.GEOTAB_DATABASE && env.GEOTAB_USERNAME && env.GEOTAB_PASSWORD) {
    return { database: env.GEOTAB_DATABASE, userName: env.GEOTAB_USERNAME, password: env.GEOTAB_PASSWORD };
  }
  if (!env.GEOTAB_CONFIG_PRIVATE_KEY) throw new Error('Geotab configuration is missing');

  if (!protectedLoginPromise) {
    protectedLoginPromise = (async () => {
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        decodePem(env.GEOTAB_CONFIG_PRIVATE_KEY!),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt'],
      );
      const rawAesKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        decodeBase64(geotabProtectedConfig.wrappedKey),
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
  return protectedLoginPromise;
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

async function authenticate(env: GeotabClientEnv): Promise<Auth> {
  const login = await protectedLogin(env);
  const result = await rpc<{ credentials: Credentials; path?: string }>('https://my.geotab.com/apiv1', 'Authenticate', {
    database: login.database,
    userName: login.userName,
    password: login.password,
  });
  return { endpoint: endpointFromPath(result.path), credentials: result.credentials };
}

export async function createGeotabClient(env: GeotabClientEnv) {
  const auth = await authenticate(env);
  return {
    async call<T>(method: string, params: GeotabJsonRecord) {
      return rpc<T>(auth.endpoint, method, { ...params, credentials: auth.credentials });
    },
  };
}
