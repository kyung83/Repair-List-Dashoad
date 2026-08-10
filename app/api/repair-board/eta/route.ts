import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const rows = await env.DB.prepare(`
      SELECT id, COALESCE(shop_eta, '') AS shop_eta
      FROM equipment
      WHERE active = 1
      ORDER BY id
    `).all<{ id: number; shop_eta: string }>();
    const etaByEquipment: Record<string, string> = {};
    for (const row of rows.results) etaByEquipment[String(row.id)] = row.shop_eta ?? '';
    return Response.json({ etaByEquipment }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_board_eta_get_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Unit ETAs could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required for this change.');
    const body = await request.json() as Record<string, unknown>;
    const equipmentId = Number(body.equipmentId ?? 0);
    if (!Number.isInteger(equipmentId) || equipmentId <= 0) throw new Error('Choose a valid unit.');
    const eta = String(body.eta ?? '').trim().slice(0, 120);
    const result = await env.DB.prepare(`
      UPDATE equipment
      SET shop_eta = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND active = 1
    `).bind(eta || null, equipmentId).run();
    if (Number(result.meta.changes ?? 0) === 0) throw new Error('Unit was not found or is inactive.');
    return Response.json({ ok: true, equipmentId, eta });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_board_eta_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Unit ETA could not be saved.' }, { status: 400 });
  }
}
