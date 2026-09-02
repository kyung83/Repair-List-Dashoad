import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required.');
  return user;
}

function clean(value: unknown, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

function parsedBreakdownId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid breakdown number.');
  return id;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager(request);
    const { id } = await params;
    const breakdownId = parsedBreakdownId(id);
    const row = await env.DB.prepare(`
      SELECT b.repair_needed, r.description AS diagnostic_notes
      FROM roadside_breakdowns b
      JOIN repairs r ON r.id = b.repair_id
      WHERE b.id = ?
    `).bind(breakdownId).first<{ repair_needed: string | null; diagnostic_notes: string | null }>();
    if (!row) return Response.json({ error: 'Breakdown not found.' }, { status: 404 });

    // Existing repair.description starts as the driver's description. It becomes
    // office diagnostic notes only after repair_needed has been set by the office.
    return Response.json({
      ok: true,
      repairCategory: clean(row.repair_needed, 120),
      notes: row.repair_needed ? clean(row.diagnostic_notes, 2000) : '',
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager(request);
    const { id } = await params;
    const breakdownId = parsedBreakdownId(id);

    const body = await request.json<{ repairCategory?: unknown; notes?: unknown }>();
    const repairCategory = clean(body.repairCategory, 120);
    const notes = clean(body.notes, 2000);
    if (!repairCategory) throw new Error('Choose our repair category.');
    if (!notes) throw new Error('Add our diagnostic notes.');

    const breakdown = await env.DB.prepare(`
      SELECT b.id, b.repair_id, b.driver_name, b.repair_needed, r.description AS diagnostic_notes
      FROM roadside_breakdowns b
      JOIN repairs r ON r.id = b.repair_id
      WHERE b.id = ?
    `).bind(breakdownId).first<{
      id: number;
      repair_id: number;
      driver_name: string;
      repair_needed: string | null;
      diagnostic_notes: string | null;
    }>();
    if (!breakdown) return Response.json({ error: 'Breakdown not found.' }, { status: 404 });

    const currentNotes = breakdown.repair_needed ? clean(breakdown.diagnostic_notes, 2000) : '';
    const changed = clean(breakdown.repair_needed, 120) !== repairCategory || currentNotes !== notes;

    if (changed) {
      const title = `Roadside breakdown - ${breakdown.driver_name}: ${repairCategory}`.slice(0, 500);
      await env.DB.batch([
        // repair_category / description remain the driver's original report.
        env.DB.prepare(`
          UPDATE roadside_breakdowns
          SET repair_needed = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(repairCategory, breakdownId),
        // The linked repair carries the office diagnosis used by repair history/costing.
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
