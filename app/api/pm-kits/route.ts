import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getPmKitData, savePmKit, setPmKitActive } from '@/lib/pm-kits';

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required for PM kits.');
  return user;
}

export async function GET(request: Request) {
  try {
    const user = await requireManager(request);
    const data = await getPmKitData(env.DB);
    return Response.json({
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
      canManage: true,
      ...data,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'pm_kits_get_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'PM kits could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requireManager(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? 'saveKit');
    if (action === 'saveKit') return Response.json(await savePmKit(env.DB, body));
    if (action === 'setActive') return Response.json(await setPmKitActive(env.DB, body));
    return Response.json({ error: 'Unknown PM kit action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'pm_kits_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'PM kit change failed.' }, { status: 400 });
  }
}
