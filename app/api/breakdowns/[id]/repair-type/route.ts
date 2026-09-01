import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { validateBreakdownCategorySelection } from '@/lib/breakdown-categories';

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

    const body = await request.json<{ repairCategory?: unknown; repairSubcategory?: unknown }>();
    const requestedCategory = String(body.repairCategory ?? '').trim();
    const requestedSubcategory = String(body.repairSubcategory ?? '').trim();
    const selection = await validateBreakdownCategorySelection(env.DB, requestedCategory, requestedSubcategory, false);
    const repairCategory = selection.name;
    const repairSubcategory = selection.subcategory;

    const breakdown = await env.DB.prepare(`
      SELECT id, repair_id, driver_name, repair_category, repair_subcategory
      FROM roadside_breakdowns
      WHERE id = ?
    `).bind(breakdownId).first<{ id: number; repair_id: number; driver_name: string; repair_category: string; repair_subcategory: string | null }>();
    if (!breakdown) return Response.json({ error: 'Breakdown not found.' }, { status: 404 });

    if (breakdown.repair_category !== repairCategory || String(breakdown.repair_subcategory || '') !== repairSubcategory) {
      const title = `Roadside breakdown - ${breakdown.driver_name}: ${repairCategory}`.slice(0, 500);
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE roadside_breakdowns
          SET repair_category = ?, repair_subcategory = ?, position_codes = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(repairCategory, repairSubcategory || null, breakdownId),
        env.DB.prepare(`
          UPDATE repairs
          SET title = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(title, breakdown.repair_id),
      ]);
    }

    return Response.json({ ok: true, repairCategory, repairSubcategory }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 400 });
  }
}
