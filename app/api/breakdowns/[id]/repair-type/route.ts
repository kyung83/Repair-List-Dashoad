import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

const REPAIR_CATEGORIES = new Set([
  'AIR/CHAMBERS/GLADHANDS',
  'TIRES',
  'ELECTRICAL/Lights',
  'MECHANICAL',
  'Tow',
  'Other',
]);

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required.');
  return user;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager(request);
    const { id } = await params;
    const breakdownId = Number(id);
    if (!Number.isInteger(breakdownId) || breakdownId <= 0) throw new Error('Invalid breakdown number.');

    const body = await request.json<{ repairCategory?: unknown }>();
    const repairCategory = String(body.repairCategory ?? '').trim();
    if (!REPAIR_CATEGORIES.has(repairCategory)) throw new Error('Choose a valid repair type.');

    const breakdown = await env.DB.prepare(`
      SELECT id, repair_id, driver_name, repair_category
      FROM roadside_breakdowns
      WHERE id = ?
    `).bind(breakdownId).first<{ id: number; repair_id: number; driver_name: string; repair_category: string }>();
    if (!breakdown) return Response.json({ error: 'Breakdown not found.' }, { status: 404 });

    if (breakdown.repair_category !== repairCategory) {
      const title = `Roadside breakdown - ${breakdown.driver_name}: ${repairCategory}`.slice(0, 500);
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE roadside_breakdowns
          SET repair_category = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(repairCategory, breakdownId),
        env.DB.prepare(`
          UPDATE repairs
          SET title = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(title, breakdown.repair_id),
      ]);
    }

    return Response.json({ ok: true, repairCategory }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 400 });
  }
}
