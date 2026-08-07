import { pbkdf2Sync } from 'node:crypto';

export type AppRole = 'viewer' | 'mechanic' | 'manager' | 'admin';

export type AppUser = {
  id: number;
  email: string;
  displayName: string;
  role: AppRole;
  active: boolean;
};

const SESSION_COOKIE = '__Host-norlow_session';
const SESSION_HOURS = 12;
const PASSWORD_ITERATIONS = 210000;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_LOGIN_FAILURES = 5;
const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function secureEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return new Uint8Array(derived.buffer, derived.byteOffset, derived.byteLength);
}

export function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

export function isAppRole(value: unknown): value is AppRole {
  return value === 'viewer' || value === 'mechanic' || value === 'manager' || value === 'admin';
}

export async function hashPassword(password: string) {
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    hash: bytesToBase64Url(hash),
    salt: bytesToBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations: number) {
  try {
    const actual = await derivePassword(password, base64UrlToBytes(salt), iterations);
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
  const raw = crypto.getRandomValues(new Uint8Array(32));
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
    SELECT id, email, display_name, role, password_hash, password_salt, password_iterations, active
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
    active: number;
  }>() : null;

  let valid = false;
  if (row?.active && isAppRole(row.role)) {
    valid = await verifyPassword(password, row.password_hash, row.password_salt, Number(row.password_iterations));
  } else {
    await derivePassword(password || 'invalid-password', new Uint8Array(16), PASSWORD_ITERATIONS);
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
