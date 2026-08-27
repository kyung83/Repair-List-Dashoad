import {
  decryptGeotabRuntimeSecret,
  encryptGeotabRuntimeSecret,
  type GeotabRuntimeSecretEnv,
} from '@/lib/geotab-runtime-credentials';

export type GmailRuntimeCredentialMetadata = {
  configured: boolean;
  connected: boolean;
  clientId: string;
  connectedEmail: string;
  connectedAt: string;
  updatedAt: string;
  updatedByUserId: number | null;
};

export type GmailRuntimeCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  connectedEmail: string;
};

type CredentialRow = {
  client_id: string;
  client_secret_ciphertext: string;
  client_secret_iv: string;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  connected_email: string | null;
  connected_at: string | null;
  updated_at: string;
  updated_by_user_id: number | null;
};

async function credentialRow(db: D1Database) {
  return db.prepare(`
    SELECT client_id, client_secret_ciphertext, client_secret_iv,
           refresh_token_ciphertext, refresh_token_iv, connected_email,
           connected_at, updated_at, updated_by_user_id
    FROM gmail_runtime_credentials
    WHERE id = 1
  `).first<CredentialRow>();
}

export async function getGmailRuntimeCredentialMetadata(db: D1Database): Promise<GmailRuntimeCredentialMetadata> {
  const row = await credentialRow(db);
  if (!row) {
    return {
      configured: false,
      connected: false,
      clientId: '',
      connectedEmail: '',
      connectedAt: '',
      updatedAt: '',
      updatedByUserId: null,
    };
  }
  const connected = Boolean(row.refresh_token_ciphertext && row.refresh_token_iv && row.connected_email);
  return {
    configured: Boolean(row.client_id && row.client_secret_ciphertext && row.client_secret_iv),
    connected,
    clientId: String(row.client_id || ''),
    connectedEmail: String(row.connected_email || ''),
    connectedAt: String(row.connected_at || ''),
    updatedAt: String(row.updated_at || ''),
    updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
  };
}

export async function saveGmailOAuthClient(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
  clientId: string,
  clientSecret: string,
  updatedByUserId: number,
) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) throw new Error('Google OAuth Client ID and Client Secret are required.');
  const encrypted = await encryptGeotabRuntimeSecret(secret, env);
  await db.prepare(`
    INSERT INTO gmail_runtime_credentials (
      id, client_id, client_secret_ciphertext, client_secret_iv,
      refresh_token_ciphertext, refresh_token_iv, connected_email, connected_at,
      updated_at, updated_by_user_id
    ) VALUES (1, ?, ?, ?, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      client_id = excluded.client_id,
      client_secret_ciphertext = excluded.client_secret_ciphertext,
      client_secret_iv = excluded.client_secret_iv,
      refresh_token_ciphertext = CASE
        WHEN gmail_runtime_credentials.client_id = excluded.client_id
          AND gmail_runtime_credentials.client_secret_ciphertext = excluded.client_secret_ciphertext
        THEN gmail_runtime_credentials.refresh_token_ciphertext ELSE NULL END,
      refresh_token_iv = CASE
        WHEN gmail_runtime_credentials.client_id = excluded.client_id
          AND gmail_runtime_credentials.client_secret_ciphertext = excluded.client_secret_ciphertext
        THEN gmail_runtime_credentials.refresh_token_iv ELSE NULL END,
      connected_email = CASE
        WHEN gmail_runtime_credentials.client_id = excluded.client_id
          AND gmail_runtime_credentials.client_secret_ciphertext = excluded.client_secret_ciphertext
        THEN gmail_runtime_credentials.connected_email ELSE NULL END,
      connected_at = CASE
        WHEN gmail_runtime_credentials.client_id = excluded.client_id
          AND gmail_runtime_credentials.client_secret_ciphertext = excluded.client_secret_ciphertext
        THEN gmail_runtime_credentials.connected_at ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP,
      updated_by_user_id = excluded.updated_by_user_id
  `).bind(id, encrypted.ciphertext, encrypted.iv, updatedByUserId).run();
}

export async function loadGmailOAuthClient(db: D1Database, env: GeotabRuntimeSecretEnv) {
  const row = await credentialRow(db);
  if (!row) return null;
  const clientSecret = await decryptGeotabRuntimeSecret(row.client_secret_ciphertext, row.client_secret_iv, env);
  if (!row.client_id || !clientSecret) throw new Error('Saved Google OAuth client configuration is incomplete.');
  return { clientId: String(row.client_id), clientSecret };
}

export async function loadGmailRuntimeCredentials(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
): Promise<GmailRuntimeCredentials | null> {
  const row = await credentialRow(db);
  if (!row || !row.refresh_token_ciphertext || !row.refresh_token_iv || !row.connected_email) return null;
  const [clientSecret, refreshToken] = await Promise.all([
    decryptGeotabRuntimeSecret(row.client_secret_ciphertext, row.client_secret_iv, env),
    decryptGeotabRuntimeSecret(row.refresh_token_ciphertext, row.refresh_token_iv, env),
  ]);
  if (!row.client_id || !clientSecret || !refreshToken) throw new Error('Saved Gmail authorization is incomplete.');
  return {
    clientId: String(row.client_id),
    clientSecret,
    refreshToken,
    connectedEmail: String(row.connected_email),
  };
}

export async function saveGmailConnection(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
  refreshToken: string,
  connectedEmail: string,
  updatedByUserId: number,
) {
  const token = refreshToken.trim();
  const email = connectedEmail.trim().toLowerCase();
  if (!token || !email) throw new Error('Google did not return a usable Gmail authorization.');
  const encrypted = await encryptGeotabRuntimeSecret(token, env);
  const result = await db.prepare(`
    UPDATE gmail_runtime_credentials
    SET refresh_token_ciphertext = ?, refresh_token_iv = ?, connected_email = ?,
        connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ?
    WHERE id = 1
  `).bind(encrypted.ciphertext, encrypted.iv, email, updatedByUserId).run();
  if (!result.meta.changes) throw new Error('Google OAuth client must be configured before Gmail can be connected.');
}

export async function clearGmailConnection(db: D1Database) {
  await db.prepare(`
    UPDATE gmail_runtime_credentials
    SET refresh_token_ciphertext = NULL, refresh_token_iv = NULL,
        connected_email = NULL, connected_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run();
}

export async function clearGmailOAuthClient(db: D1Database) {
  await db.prepare('DELETE FROM gmail_runtime_credentials WHERE id = 1').run();
  await db.prepare('DELETE FROM gmail_oauth_states').run().catch(() => undefined);
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createGmailOAuthState(db: D1Database, userId: number) {
  await db.prepare("DELETE FROM gmail_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP").run().catch(() => undefined);
  const state = randomState();
  await db.prepare(`
    INSERT INTO gmail_oauth_states (state, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+10 minutes'))
  `).bind(state, userId).run();
  return state;
}

export async function consumeGmailOAuthState(db: D1Database, state: string, userId: number) {
  const value = state.trim();
  if (!value) return false;
  const row = await db.prepare(`
    SELECT state FROM gmail_oauth_states
    WHERE state = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP
  `).bind(value, userId).first<{ state: string }>();
  await db.prepare('DELETE FROM gmail_oauth_states WHERE state = ?').bind(value).run().catch(() => undefined);
  return Boolean(row);
}
