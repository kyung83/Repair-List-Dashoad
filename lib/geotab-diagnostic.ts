import { geotabProtectedConfig } from './geotab-protected-config';

type JsonRecord = Record<string, unknown>;
type Credentials = { database: string; userName: string; sessionId: string };
type Auth = { endpoint: string; endpointHost: string; credentials: Credentials };
type DiagnosticEnv = { GEOTAB_CONFIG_PRIVATE_KEY?: string };
type ServiceConfig = { database: string; serviceUsername: string; servicePassword: string };
type CheckResult = { ok: boolean; error?: string };
type GeotabPayload<T> = { result?: T; error?: { message?: string; name?: string } };

export type GeotabDiagnosticResult = {
  ok: boolean;
  authenticated: boolean;
  stage: 'configuration' | 'authentication' | 'permissions' | 'ready';
  endpointHost?: string;
  checks: Record<string, CheckResult>;
  error?: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
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
  if (!base64) throw new Error('Encrypted configuration key is missing or invalid');
  return decodeBase64(base64);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[service-account]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[redacted]')
    .replace(/sessionId\s*[:=]\s*\S+/gi, 'sessionId=[redacted]')
    .slice(0, 500);
}

async function decryptServiceConfig(env: DiagnosticEnv): Promise<ServiceConfig> {
  const privateKeyPem = env.GEOTAB_CONFIG_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('Cloudflare private-key binding is missing');
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
  const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(geotabProtectedConfig.iv) },
    aesKey,
    decodeBase64(geotabProtectedConfig.ciphertext),
  );
  const config = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<ServiceConfig>;
  if (!config.database || !config.serviceUsername || !config.servicePassword) {
    throw new Error('Encrypted service-account configuration is incomplete');
  }
  return config as ServiceConfig;
}

async function rpc<T>(endpoint: string, method: string, params: JsonRecord): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) {
    const body = safeError(await response.text());
    throw new Error(`Geotab ${method} returned HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  const payload = await response.json() as GeotabPayload<T>;
  if (payload.error) throw new Error(`Geotab ${method} failed: ${safeError(payload.error.message || payload.error.name || 'unknown')}`);
  if (payload.result === undefined) throw new Error(`Geotab ${method} returned no result`);
  return payload.result;
}

function endpointFromPath(pathValue: unknown) {
  const path = text(pathValue).trim();
  if (!path || path.toLowerCase() === 'thisserver') {
    return { endpoint: 'https://my.geotab.com/apiv1', endpointHost: 'my.geotab.com' };
  }
  const host = path.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('Geotab returned an invalid API path');
  return { endpoint: `https://${host}/apiv1`, endpointHost: host };
}

async function authenticate(config: ServiceConfig): Promise<Auth> {
  const result = await rpc<{ credentials: Credentials; path?: string }>(
    'https://my.geotab.com/apiv1',
    'Authenticate',
    { database: config.database, userName: config.serviceUsername, password: config.servicePassword },
  );
  return { ...endpointFromPath(result.path), credentials: result.credentials };
}

async function call<T>(auth: Auth, method: string, params: JsonRecord): Promise<T> {
  return rpc<T>(auth.endpoint, method, { ...params, credentials: auth.credentials });
}

export async function diagnoseGeotabConnection(env: DiagnosticEnv): Promise<GeotabDiagnosticResult> {
  let config: ServiceConfig;
  try {
    config = await decryptServiceConfig(env);
  } catch (error) {
    return { ok: false, authenticated: false, stage: 'configuration', checks: {}, error: safeError(error) };
  }

  let auth: Auth;
  try {
    auth = await authenticate(config);
  } catch (error) {
    return { ok: false, authenticated: false, stage: 'authentication', checks: {}, error: safeError(error) };
  }

  const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const toDate = new Date().toISOString();
  const probes: Array<[string, () => Promise<unknown>]> = [
    ['devices', () => call(auth, 'Get', { typeName: 'Device', resultsLimit: 1 })],
    ['trailers', () => call(auth, 'Get', { typeName: 'Trailer', resultsLimit: 1 })],
    ['users', () => call(auth, 'Get', { typeName: 'User', resultsLimit: 1 })],
    ['defects', () => call(auth, 'Get', { typeName: 'Defect', resultsLimit: 1 })],
    ['dvirLogs', () => call(auth, 'Get', { typeName: 'DVIRLog', resultsLimit: 1, search: { fromDate, toDate } })],
  ];

  const checks: Record<string, CheckResult> = {};
  for (const [name, probe] of probes) {
    try {
      await probe();
      checks[name] = { ok: true };
    } catch (error) {
      checks[name] = { ok: false, error: safeError(error) };
    }
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return {
    ok,
    authenticated: true,
    stage: ok ? 'ready' : 'permissions',
    endpointHost: auth.endpointHost,
    checks,
    ...(ok ? {} : { error: 'The service account authenticated, but one or more API calls failed.' }),
  };
}
