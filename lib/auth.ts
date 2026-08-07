import { scryptSync } from 'node:crypto';
import { Buffer } from 'node:buffer';

export type AppRole = 'viewer' | 'mechanic' | 'manager' | 'admin';
export type PasswordAlgorithm = 'pbkdf2-sha256' | 'scrypt-v1';

export type AppUser = {
  id: number;
  email: string;
  displayName: string;
  role: AppRole;
  active: boolean;
};

const SESSION_COOKIE = '__Host-norlow_session';
const SESSION_HOURS = 12;
const LEGACY_PASSWORD_ITERATIONS = 210000;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_LOGIN_FAILURES = 5;
const encoder = new TextEncoder();

type WorkerSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
};

function bytesToBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function secureEqual(left: Uint8Array, right: Uint8Array) {
  const subtle = globalThis.crypto.subtle as WorkerSubtleCrypto;
  const lengthsMatch = left.byteLength === right.byteLength;
  return lengthsMatch
    ? subtle.timingSafeEqual(left, right)
    : !subtle.timingSafeEqual(left, left);
}

async function sha256(value: string) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function deriveLegacyPbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  ));
}

function deriveScrypt(password: string, salt: Uint8Array) {
  return new Uint8Array(scryptSync(
    Buffer.from(password, 'utf8'),
    Buffer.from(salt),
    32,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
  ));
}

function normalizePasswordAlgorithm(value: unknown): PasswordAlgorithm {
  return value === 'scrypt-v1' ? 'scrypt-v1' : 'pbkdf2-sha256';
}

export function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

export function isAppRole(value: unknown): value is AppRole {
  return value === 'viewer' || value === 'mechanic' || value === 'manager' || value === 'admin';
}

export async function hashPassword(password: string) {
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = deriveScrypt(password, salt);
  return {
    hash: bytesToBase64Url(hash),
    salt: bytesToBase64Url(salt),
    iterations: 0,
    algorithm: 'scrypt-v1' as const,
  };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
  iterations: number,
  algorithmValue: unknown = 'pbkdf2-sha256',
) {
  try {
    const algorithm = normalizePasswordAlgorithm(algorithmValue);
    const saltBytes = base64UrlToBytes(salt);
    const actual = algorithm === 'scrypt-v1'
      ? deriveScrypt(password, saltBytes)
      : await deriveLegacyPbkdf2(password, saltBytes, iterations || LEGACY_PASSWORD_ITERATIONS);
    return secureEqual(actual, base64UrlToBytes(hash));
  } catch {
    return false;
  }
}

export async function secureTokenEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  return secureEqual(leftHash, rightHash);
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export function sessionTokenFromRequest(request: Request) {
  return cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
}

export function sessionCookie(token: string, requestUrl: string) {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 60 * 60}${secure}`;
}

export function clearSessionCookie(requestUrl: string) {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function createSession(db: D1Database, userId: number) {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(raw);
  const tokenHash = bytesToBase64Url(await sha256(token));
  await db.prepare(`
    INSERT INTO app_sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `).bind(tokenHash, userId, `+${SESSION_HOURS} hours`).run();
  return token;
}

export async function deleteSession(db: D1Database, request: Request) {
  const token = sessionTokenFromRequest(request);
  if (!token) return;
  const tokenHash = bytesToBase64Url(await sha256(token));
  await db.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function getSessionUser(db: D1Database, request: Request): Promise<AppUser | null> {
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  const tokenHash = bytesToBase64Url(await sha256(token));
  const row = await db.prepare(`
    SELECT u.id, u.email, u.display_name, u.role, u.active
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.active = 1
  `).bind(tokenHash).first<{
    id: number;
    email: string;
    display_name: string;
    role: AppRole;
    active: number;
  }>();
  if (!row || !isAppRole(row.role)) return null;
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
  };
}

export async function appUserCount(db: D1Database) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM app_users').first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function loginAttemptKey(email: string, ip: string) {
  return bytesToBase64Url(await sha256(`${email}\u0000${ip}`));
}

async function loginBlocked(db: D1Database, attemptKey: string) {
  const row = await db.prepare(`
    SELECT failures
    FROM app_login_attempts
    WHERE attempt_key = ?
      AND window_started_at >= datetime('now', ?)
  `).bind(attemptKey, `-${LOGIN_WINDOW_MINUTES} minutes`).first<{ failures: number }>();
  return Number(row?.failures ?? 0) >= MAX_LOGIN_FAILURES;
}

async function recordLoginFailure(db: D1Database, attemptKey: string) {
  await db.prepare(`
    INSERT INTO app_login_attempts (attempt_key, failures, window_started_at, updated_at)
    VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(attempt_key) DO UPDATE SET
      failures = CASE
        WHEN app_login_attempts.window_started_at < datetime('now', ?) THEN 1
        ELSE app_login_attempts.failures + 1
      END,
      window_started_at = CASE
        WHEN app_login_attempts.window_started_at < datetime('now', ?) THEN CURRENT_TIMESTAMP
        ELSE app_login_attempts.window_started_at
      END,
      updated_at = CURRENT_TIMESTAMP
  `).bind(attemptKey, `-${LOGIN_WINDOW_MINUTES} minutes`, `-${LOGIN_WINDOW_MINUTES} minutes`).run();
}

export async function authenticateUser(
  db: D1Database,
  emailValue: unknown,
  passwordValue: unknown,
  ipAddress = '',
): Promise<{ user: AppUser | null; blocked: boolean }> {
  const email = normalizeEmail(emailValue);
  const password = String(passwordValue ?? '');
  const attemptKey = await loginAttemptKey(email || '[blank]', ipAddress || '[unknown]');
  if (await loginBlocked(db, attemptKey)) return { user: null, blocked: true };

  const row = email ? await db.prepare(`
    SELECT id, email, display_name, role, password_hash, password_salt, password_iterations,
           password_algorithm, active
    FROM app_users
    WHERE email = ? COLLATE NOCASE
  `).bind(email).first<{
    id: number;
    email: string;
    display_name: string;
    role: AppRole;
    password_hash: string;
    password_salt: string;
    password_iterations: number;
    password_algorithm: string;
    active: number;
  }>() : null;

  let valid = false;
  if (row?.active && isAppRole(row.role)) {
    valid = await verifyPassword(
      password,
      row.password_hash,
      row.password_salt,
      Number(row.password_iterations),
      row.password_algorithm,
    );
  } else {
    deriveScrypt(password || 'invalid-password', new Uint8Array(16));
  }

  if (!row || !row.active || !isAppRole(row.role) || !valid) {
    await recordLoginFailure(db, attemptKey);
    return { user: null, blocked: false };
  }

  await db.batch([
    db.prepare('DELETE FROM app_login_attempts WHERE attempt_key = ?').bind(attemptKey),
    db.prepare('UPDATE app_users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id),
  ]);

  return {
    user: {
      id: Number(row.id),
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      active: true,
    },
    blocked: false,
  };
}

export function canWritePath(role: AppRole, pathname: string) {
  if (role === 'admin') return true;
  if (pathname.startsWith('/api/admin') || pathname.startsWith('/api/internal')) return false;
  if (pathname === '/api/inventory') return role === 'manager';
  if (pathname === '/api/work-orders' || pathname === '/api/repairs') {
    return role === 'mechanic' || role === 'manager';
  }
  return role === 'manager';
}
