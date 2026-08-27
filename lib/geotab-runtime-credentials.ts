export type GeotabRuntimeSecretEnv = {
  GEOTAB_CONFIG_PRIVATE_KEY?: string;
  AUTH_BOOTSTRAP_TOKEN?: string;
};

export type GeotabRuntimeCredentials = {
  database: string;
  username: string;
  password: string;
};

export type GeotabRuntimeCredentialMetadata = {
  active: boolean;
  database: string;
  username: string;
  updatedAt: string;
  updatedByUserId: number | null;
};

export type EncryptedGeotabRuntimeSecret = {
  ciphertext: string;
  iv: string;
};

type CredentialRow = {
  database_name: string;
  username: string;
  password_ciphertext: string;
  password_iv: string;
  updated_at: string;
  updated_by_user_id: number | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_CONTEXT = 'norlow-geotab-runtime-credentials-v1';

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(env: GeotabRuntimeSecretEnv) {
  const secret = String(env.GEOTAB_CONFIG_PRIVATE_KEY || env.AUTH_BOOTSTRAP_TOKEN || '').trim();
  if (!secret) throw new Error('Credential encryption is unavailable. Configure the Geotab private key or dashboard bootstrap secret first.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${KEY_CONTEXT}\u0000${secret}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptGeotabRuntimeSecret(
  value: string,
  env: GeotabRuntimeSecretEnv,
): Promise<EncryptedGeotabRuntimeSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value));
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptGeotabRuntimeSecret(
  ciphertext: string,
  iv: string,
  env: GeotabRuntimeSecretEnv,
) {
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );
  return decoder.decode(plaintext);
}

async function row(db: D1Database) {
  return db.prepare(`
    SELECT database_name, username, password_ciphertext, password_iv, updated_at, updated_by_user_id
    FROM geotab_runtime_credentials
    WHERE id = 1
  `).first<CredentialRow>();
}

export async function getGeotabRuntimeCredentialMetadata(db: D1Database): Promise<GeotabRuntimeCredentialMetadata> {
  const current = await row(db);
  if (!current) return { active: false, database: '', username: '', updatedAt: '', updatedByUserId: null };
  return {
    active: true,
    database: String(current.database_name || ''),
    username: String(current.username || ''),
    updatedAt: String(current.updated_at || ''),
    updatedByUserId: current.updated_by_user_id == null ? null : Number(current.updated_by_user_id),
  };
}

export async function loadGeotabRuntimeCredentials(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
): Promise<GeotabRuntimeCredentials | null> {
  const current = await row(db);
  if (!current) return null;
  const password = await decryptGeotabRuntimeSecret(current.password_ciphertext, current.password_iv, env);
  if (!current.database_name || !current.username || !password) throw new Error('Saved Geotab credentials are incomplete.');
  return {
    database: String(current.database_name),
    username: String(current.username),
    password,
  };
}

export async function saveGeotabRuntimeCredentials(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
  credentials: GeotabRuntimeCredentials,
  updatedByUserId: number,
) {
  const database = credentials.database.trim();
  const username = credentials.username.trim();
  const password = credentials.password;
  if (!database || !username || !password) throw new Error('Database, username, and password are required.');
  const encrypted = await encryptGeotabRuntimeSecret(password, env);
  await db.prepare(`
    INSERT INTO geotab_runtime_credentials (
      id, credential_version, database_name, username, password_ciphertext, password_iv,
      updated_at, updated_by_user_id
    ) VALUES (1, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      credential_version = 1,
      database_name = excluded.database_name,
      username = excluded.username,
      password_ciphertext = excluded.password_ciphertext,
      password_iv = excluded.password_iv,
      updated_at = CURRENT_TIMESTAMP,
      updated_by_user_id = excluded.updated_by_user_id
  `).bind(database, username, encrypted.ciphertext, encrypted.iv, updatedByUserId).run();

  // A credential replacement must never keep using a session created by the previous account/password.
  await db.prepare('DELETE FROM geotab_runtime_sessions WHERE id = 1').run().catch(() => undefined);
}

export async function clearGeotabRuntimeCredentials(db: D1Database) {
  await db.prepare('DELETE FROM geotab_runtime_credentials WHERE id = 1').run();
  await db.prepare('DELETE FROM geotab_runtime_sessions WHERE id = 1').run().catch(() => undefined);
}
