import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type BreakdownDeleteRow = {
  id: number;
  repair_id: number;
  unit: string;
  source: string;
};

function breakdownIdFromRequest(request: Request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const raw = parts[parts.length - 1] ?? '';
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    if (user.role !== 'manager' && user.role !== 'admin') {
      return Response.json({ error: 'Only managers and admins can permanently delete breakdown records.' }, { status: 403 });
    }

    const breakdownId = breakdownIdFromRequest(request);
    if (!breakdownId) return Response.json({ error: 'A valid breakdown ID is required.' }, { status: 400 });

    const breakdown = await env.DB.prepare(`
      SELECT b.id,b.repair_id,COALESCE(e.unit,'') AS unit,COALESCE(r.source,'') AS source
      FROM roadside_breakdowns b
      JOIN repairs r ON r.id=b.repair_id
      JOIN equipment e ON e.id=b.equipment_id
      WHERE b.id=?
    `).bind(breakdownId).first<BreakdownDeleteRow>();

    if (!breakdown) return Response.json({ error: 'Breakdown record was not found.' }, { status: 404 });
    if (breakdown.source !== 'roadside-breakdown') {
      return Response.json({ error: 'This linked repair is not a roadside breakdown and cannot be purged here.' }, { status: 409 });
    }

    const inventory = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM inventory_operations
      WHERE repair_id=? AND status='applied'
    `).bind(breakdown.repair_id).first<{ count: number }>();

    if (Number(inventory?.count ?? 0) > 0) {
      return Response.json({
        error: 'This breakdown has applied inventory activity. Undo the parts/inventory operation before deleting the test record so physical stock stays correct.',
      }, { status: 409 });
    }

    await env.DB.batch([
      // Delete the breakdown first so breakdown-only children such as receipts,
      // notification logs, email threads and tire detail rows cascade away.
      env.DB.prepare('DELETE FROM roadside_breakdowns WHERE id=? AND repair_id=?').bind(breakdown.id, breakdown.repair_id),
      // The linked roadside repair feeds the regular repair/cost reports too, so
      // remove it as part of the same purge instead of leaving test history behind.
      env.DB.prepare("DELETE FROM repairs WHERE id=? AND source='roadside-breakdown'").bind(breakdown.repair_id),
    ]);

    const remaining = await env.DB.prepare('SELECT id FROM roadside_breakdowns WHERE id=?').bind(breakdown.id).first<{ id: number }>();
    const repairRemaining = await env.DB.prepare('SELECT id FROM repairs WHERE id=?').bind(breakdown.repair_id).first<{ id: number }>();
    if (remaining || repairRemaining) throw new Error('The breakdown test record could not be fully deleted.');

    console.info(JSON.stringify({
      event: 'breakdown_report_record_deleted',
      breakdownId: breakdown.id,
      repairId: breakdown.repair_id,
      unit: breakdown.unit,
      deletedByUserId: user.id,
      deletedByRole: user.role,
    }));

    return Response.json({ deleted: true, breakdownId: breakdown.id, repairId: breakdown.repair_id, unit: breakdown.unit });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_report_delete_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown record could not be deleted.' }, { status: 500 });
  }
}
