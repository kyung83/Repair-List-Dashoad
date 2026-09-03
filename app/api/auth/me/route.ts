import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  const publicUser = user.dispatchAccess ? { ...user, role: 'dispatch' as const } : user;
  return Response.json({ user: publicUser }, { headers: { 'cache-control': 'no-store' } });
}
