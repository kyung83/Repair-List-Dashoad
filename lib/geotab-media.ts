import { geotabProtectedConfig } from './geotab-protected-config';

const GEOTAB_SERVER = 'https://my.geotab.com';
const GEOTAB_AUTH_URL = `${GEOTAB_SERVER}/apiv1`;

type Credentials = { database: string; userName: string; sessionId: string };
type GeotabEnv = {
  GEOTAB_DATABASE?: string;
  GEOTAB_USERNAME?: string;
  GEOTAB_PASSWORD?: string;
  GEOTAB_CONFIG_PRIVATE_KEY?: string;
};
type ServiceConfig = { database: string; serviceUsername: string; servicePassword: string };
type GeotabPayload<T> = { result?: T; error?: { message?: string; name?: string } };

type Auth = { endpoint: string; credentials: Credentials };

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

async function decryptServiceConfig(env: GeotabEnv): Promise<ServiceConfig> {
  const privateKeyPem = env.GEOTAB_CONFIG_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('Geotab encrypted configuration key is missing');

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
    throw new Error('Geotab encrypted service-account configuration is incomplete');
  }
  return config as ServiceConfig;
}

async function resolveConfig(env: GeotabEnv): Promise<ServiceConfig> {
  if (env.GEOTAB_DATABASE && env.GEOTAB_USERNAME && env.GEOTAB_PASSWORD) {
    return {
      database: env.GEOTAB_DATABASE,
      serviceUsername: env.GEOTAB_USERNAME,
      servicePassword: env.GEOTAB_PASSWORD,
    };
  }
  return decryptServiceConfig(env);
}

function endpointFromPath(pathValue: unknown) {
  const path = typeof pathValue === 'string' ? pathValue.trim() : '';
  if (!path || path.toLowerCase() === 'thisserver') return GEOTAB_AUTH_URL;
  const host = path.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('Geotab returned an invalid API path');
  return `https://${host}/apiv1`;
}

async function authenticate(env: GeotabEnv): Promise<Auth> {
  const config = await resolveConfig(env);
  const response = await fetch(GEOTAB_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      method: 'Authenticate',
      params: {
        userName: config.serviceUsername,
        password: config.servicePassword,
        database: config.database,
      },
    }),
  });
  if (!response.ok) throw new Error(`Geotab authentication returned HTTP ${response.status}`);
  const payload = await response.json() as GeotabPayload<{ credentials: Credentials; path?: string }>;
  if (payload.error || !payload.result?.credentials) throw new Error('Geotab media authentication failed');
  return { endpoint: endpointFromPath(payload.result.path), credentials: payload.result.credentials };
}

export async function fetchGeotabImage(env: GeotabEnv, mediaId: string) {
  const auth = await authenticate(env);
  const response = await fetch(auth.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'image/*,application/octet-stream,application/json' },
    body: JSON.stringify({
      method: 'DownloadMediaFile',
      params: {
        credentials: auth.credentials,
        mediaFile: { id: mediaId },
      },
    }),
  });

  if (!response.ok) throw new Error(`Geotab media download returned HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new Error('Geotab media response was not an image');
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType,
  };
}
