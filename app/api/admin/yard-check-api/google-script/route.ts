import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { buildYardCheckGoogleScript } from '@/lib/yard-check-google-script';

export async function GET(request:Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return new Response('Authentication required.', { status:401 });
  if (user.role !== 'manager' && user.role !== 'admin') {
    return new Response('Manager or administrator access is required.', { status:403 });
  }
  const url = new URL(request.url);
  return new Response(buildYardCheckGoogleScript(url.origin), {
    headers:{
      'content-type':'text/plain; charset=utf-8',
      'cache-control':'no-store',
      'content-disposition':'inline; filename="northern-yard-check.gs"',
    },
  });
}
