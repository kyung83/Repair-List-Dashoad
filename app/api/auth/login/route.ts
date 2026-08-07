import { env } from 'cloudflare:workers';
import { appUserCount, authenticateUser, createSession, sessionCookie } from '@/lib/auth';

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
      return Response.json({ error: 'Email or password is incorrect.' }, { status: 401 });
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
