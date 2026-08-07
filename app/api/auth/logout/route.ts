import { env } from 'cloudflare:workers';
import { clearSessionCookie, deleteSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    await deleteSession(env.DB, request);
  } catch (error) {
    console.error(JSON.stringify({ event: 'logout_session_delete_failed', error: String(error) }));
  }

  return Response.json(
    { ok: true },
    { headers: { 'set-cookie': clearSessionCookie(request.url), 'cache-control': 'no-store' } },
  );
}
