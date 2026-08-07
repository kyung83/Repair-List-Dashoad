import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  return Response.json({ user }, { headers: { 'cache-control': 'no-store' } });
}
