import { env } from 'cloudflare:workers';
import { pbkdf2Sync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { appUserCount, authenticateUser, createSession, sessionCookie, verifyPassword } from '@/lib/auth';

function base64UrlToBuffer(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function bufferToBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function webCryptoPbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return bufferToBase64Url(bits);
}

async function smokeDiagnostic(emailValue: unknown, passwordValue: unknown) {
  const email = String(emailValue ?? '').trim().toLowerCase();
  if (!email.startsWith('auth-smoke-') || !email.endsWith('@norlow.invalid')) return null;

  const row = await env.DB.prepare(`
    SELECT password_hash, password_salt, password_iterations, active
    FROM app_users
    WHERE email = ? COLLATE NOCASE
  `).bind(email).first<{
    password_hash: string;
    password_salt: string;
    password_iterations: number;
    active: number;
  }>();

  if (!row) {
    return { rowVisible: false, active: false, passwordValid: false };
  }

  const password = String(passwordValue ?? '');
  const salt = base64UrlToBuffer(row.password_salt);
  const iterations = Number(row.password_iterations);

  let nodeMatches: boolean | null = null;
  let nodeError = '';
  try {
    const nodeHash = bufferToBase64Url(
      pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256'),
    );
    nodeMatches = nodeHash === row.password_hash;
  } catch (error) {
    nodeError = error instanceof Error ? error.name : 'NodeCryptoError';
  }

  let webMatches: boolean | null = null;
  let webError = '';
  try {
    const webHash = await webCryptoPbkdf2(password, salt, iterations);
    webMatches = webHash === row.password_hash;
  } catch (error) {
    webError = error instanceof Error ? error.name : 'WebCryptoError';
  }

  return {
    rowVisible: true,
    active: Boolean(row.active),
    passwordValid: await verifyPassword(password, row.password_hash, row.password_salt, iterations),
    passwordLength: password.length,
    saltLength: salt.length,
    nodeMatches,
    nodeError,
    webMatches,
    webError,
  };
}

export async function POST(request: Request) {
  try {
    if (await appUserCount(env.DB) === 0) {
      return Response.json(
        { error: 'Administrator setup is required.', setupRequired: true },
        { status: 428 },
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const ip = request.headers.get('cf-connecting-ip') || '';
    const result = await authenticateUser(env.DB, body.email, body.password, ip);

    if (result.blocked) {
      return Response.json(
        { error: 'Too many failed sign-in attempts. Try again in about 15 minutes.' },
        { status: 429, headers: { 'retry-after': '900' } },
      );
    }

    if (!result.user) {
      const diagnostic = await smokeDiagnostic(body.email, body.password);
      return Response.json(
        diagnostic
          ? { error: 'Email or password is incorrect.', diagnostic }
          : { error: 'Email or password is incorrect.' },
        { status: 401 },
      );
    }

    const token = await createSession(env.DB, result.user.id);
    return Response.json(
      { ok: true, user: result.user },
      { headers: { 'set-cookie': sessionCookie(token, request.url), 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'login_failed', error: String(error) }));
    return Response.json({ error: 'Sign in could not be completed.' }, { status: 500 });
  }
}
