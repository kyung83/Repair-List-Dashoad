import { env } from 'cloudflare:workers';
import {
  appUserCount,
  createSession,
  hashPassword,
  normalizeEmail,
  secureTokenEqual,
  sessionCookie,
} from '@/lib/auth';

type AuthEnv = typeof env & { AUTH_BOOTSTRAP_TOKEN?: string };

export async function GET() {
  const runtime = env as AuthEnv;
  const count = await appUserCount(runtime.DB);
  return Response.json({
    setupRequired: count === 0,
    bootstrapConfigured: Boolean(runtime.AUTH_BOOTSTRAP_TOKEN),
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const runtime = env as AuthEnv;
    if (await appUserCount(runtime.DB) > 0) {
      return Response.json({ error: 'Administrator setup has already been completed.' }, { status: 409 });
    }

    if (!runtime.AUTH_BOOTSTRAP_TOKEN) {
      return Response.json(
        { error: 'AUTH_BOOTSTRAP_TOKEN is not configured in Cloudflare Worker secrets.' },
        { status: 503 },
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const suppliedToken = String(body.setupToken ?? '');
    if (!suppliedToken || !(await secureTokenEqual(suppliedToken, runtime.AUTH_BOOTSTRAP_TOKEN))) {
      return Response.json({ error: 'Setup token is incorrect.' }, { status: 403 });
    }

    const email = normalizeEmail(body.email);
    const displayName = String(body.displayName ?? '').trim();
    const password = String(body.password ?? '');
    if (!email || !email.includes('@')) throw new Error('A valid email address is required.');
    if (!displayName) throw new Error('Display name is required.');

    const passwordData = await hashPassword(password);
    const result = await runtime.DB.prepare(`
      INSERT INTO app_users (
        email, display_name, role, password_hash, password_salt, password_iterations, active
      ) VALUES (?, ?, 'admin', ?, ?, ?, 1)
    `).bind(
      email,
      displayName,
      passwordData.hash,
      passwordData.salt,
      passwordData.iterations,
    ).run();

    const userId = Number(result.meta.last_row_id);
    const token = await createSession(runtime.DB, userId);
    return Response.json(
      { ok: true, user: { id: userId, email, displayName, role: 'admin', active: true } },
      { headers: { 'set-cookie': sessionCookie(token, request.url), 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Administrator setup failed.' },
      { status: 400 },
    );
  }
}
