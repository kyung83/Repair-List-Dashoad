import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { createYardCheckApiKey, listYardCheckApiKeys, revokeYardCheckApiKey } from '@/lib/yard-check-api';

async function manager(request:Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required.');
  return user;
}

function statusFor(message:string) {
  if (message === 'Authentication required.') return 401;
  if (message === 'Manager or administrator access is required.') return 403;
  return 400;
}

export async function GET(request:Request) {
  try {
    await manager(request);
    return Response.json({ keys:await listYardCheckApiKeys(env.DB) }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Yard Check API settings could not be loaded.';
    return Response.json({ error:message }, { status:statusFor(message), headers:{ 'cache-control':'no-store' } });
  }
}

export async function POST(request:Request) {
  try {
    const user = await manager(request);
    const body = await request.json() as { action?:string; label?:string; id?:number };
    const action = String(body.action ?? '').trim();

    if (action === 'createKey') {
      const created = await createYardCheckApiKey(env.DB, body.label ?? '', user.id);
      return Response.json({ ok:true, created }, { headers:{ 'cache-control':'no-store' } });
    }
    if (action === 'revokeKey') {
      const result = await revokeYardCheckApiKey(env.DB, body.id);
      return Response.json(result, { headers:{ 'cache-control':'no-store' } });
    }
    throw new Error('Choose a valid Yard Check API action.');
  } catch (error) {
    console.error(JSON.stringify({ event:'yard_check_api_admin_failed', error:String(error) }));
    const message = error instanceof Error ? error.message : 'Yard Check API settings could not be saved.';
    return Response.json({ error:message }, { status:statusFor(message), headers:{ 'cache-control':'no-store' } });
  }
}
