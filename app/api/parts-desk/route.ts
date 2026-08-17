import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  getPartsDeskData,
  orderPartForWarehouse,
  receivePartForWarehouse,
} from '@/lib/parts-lifecycle';

async function requirePartsDeskUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Parts Desk requires manager or admin access.');
  return user;
}

export async function GET(request: Request) {
  try {
    await requirePartsDeskUser(request);
    return Response.json(await getPartsDeskData(env.DB), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Parts Desk could not be loaded.' }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePartsDeskUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const partId = Number(body.partId ?? 0);
    const warehouseCode = String(body.warehouseCode ?? '');
    const quantity = Number(body.quantity ?? 0);
    if (action === 'order') {
      return Response.json(await orderPartForWarehouse(env.DB, { partId, warehouseCode, quantity, userId: user.id }));
    }
    if (action === 'receive') {
      return Response.json(await receivePartForWarehouse(env.DB, { partId, warehouseCode, quantity, userId: user.id }));
    }
    return Response.json({ error: 'Unknown Parts Desk action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'parts_desk_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Parts Desk action failed.' }, { status: 400 });
  }
}
