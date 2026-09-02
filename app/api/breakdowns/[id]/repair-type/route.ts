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

    const body = await request.json<{ repairCategory?: unknown; notes?: unknown }>();
    const requestedCategory = String(body.repairCategory ?? '').trim();
    const notes = String(body.notes ?? '').trim().slice(0, 2000);
    if (!notes) throw new Error('Add a short diagnostic note.');

    // Office diagnostics intentionally use one primary category + notes. The
    // public driver form can still collect its detailed subcategory/position.
    const selection = await validateBreakdownCategorySelection(env.DB, requestedCategory, '', false);
    const repairCategory = selection.name;

    const breakdown = await env.DB.prepare(`
      SELECT id, repair_id, driver_name, repair_category, repair_subcategory, position_codes, description
      FROM roadside_breakdowns
      WHERE id = ?
    `).bind(breakdownId).first<{
      id:number;repair_id:number;driver_name:string;repair_category:string;repair_subcategory:string|null;
      position_codes:string|null;description:string;
    }>();
    if (!breakdown) return Response.json({ error: 'Breakdown not found.' }, { status: 404 });

    const categoryChanged = breakdown.repair_category !== repairCategory;
    const nextPositions = categoryChanged ? null : breakdown.position_codes;
    const changed = categoryChanged || Boolean(breakdown.repair_subcategory) || breakdown.description !== notes;

    if (changed) {
      const title = `Roadside breakdown - ${breakdown.driver_name}: ${repairCategory}`.slice(0, 500);
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE roadside_breakdowns
          SET repair_category = ?, repair_subcategory = NULL, position_codes = ?, description = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(repairCategory, nextPositions, notes, breakdownId),
        env.DB.prepare(`
          UPDATE repairs
          SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(title, notes, breakdown.repair_id),
      ]);
    }

    return Response.json({ ok: true, repairCategory, notes }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 400 });
  }
}
