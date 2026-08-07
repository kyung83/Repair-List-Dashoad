import { env } from 'cloudflare:workers';
import { appUserCount, authenticateUser, createSession, sessionCookie, verifyPassword } from '@/lib/auth';

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

  return {
    rowVisible: Boolean(row),
    active: Boolean(row?.active),
    passwordValid: row ? await verifyPassword(
      String(passwordValue ?? ''),
      row.password_hash,
      row.password_salt,
      Number(row.password_iterations),
    ) : false,
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
