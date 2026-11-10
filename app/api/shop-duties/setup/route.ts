import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { assignCurrentShopDuty, getShopDutySetupData, updateShopDutyTemplate } from '@/lib/shop-duties';

async function requireManager(request:Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required.');
  return user;
}

export async function GET(request:Request) {
  try {
    await requireManager(request);
    return Response.json({ ok:true, ...(await getShopDutySetupData(env.DB)) }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : 'Shop Duty setup could not be loaded.' }, { status:400 });
  }
}

export async function POST(request:Request) {
  try {
    const user = await requireManager(request);
    const body = await request.json() as Record<string,unknown>;
    const action = String(body.action ?? 'updateTemplate');
    if (action === 'updateTemplate') {
      return Response.json(await updateShopDutyTemplate(env.DB, user.id, body));
    }
    if (action === 'assignCurrent') {
      return Response.json(await assignCurrentShopDuty(env.DB, user.id, body));
    }
    return Response.json({ error:'Unknown Shop Duty setup action.' }, { status:400 });
  } catch (error) {
    console.error(JSON.stringify({ event:'shop_duty_setup_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Shop Duty setup could not be saved.' }, { status:400 });
  }
}
