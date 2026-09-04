import { isRepairCompleted } from './status';

function repairIds(value: unknown) {
  if (!Array.isArray(value)) return [] as number[];
  return [...new Set(value.map((raw) => {
    const match = String(raw ?? '').match(/^(?:repair-)?(\d+)$/);
    return match ? Number(match[1]) : 0;
  }).filter((id) => Number.isInteger(id) && id > 0))];
}

export async function ensureReviewedWorkOrderCanBeInvoiced(db: D1Database, body: Record<string, unknown>) {
  const ids = repairIds(body.repairIds);
  if (!ids.length) return;
  if (ids.length > 100) throw new Error('Too many repairs were included in one work order invoice.');
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT id, COALESCE(status,'') AS status, reviewed_at
    FROM repairs
    WHERE id IN (${placeholders})
  `).bind(...ids).all<{ id:number; status:string; reviewed_at:string|null }>();

  if (rows.results.length !== ids.length) throw new Error('One or more repairs in this work order could not be found.');
  if (rows.results.some((row) => !isRepairCompleted(row.status))) {
    throw new Error('Only completed work orders can be invoiced.');
  }
  if (rows.results.some((row) => !row.reviewed_at)) {
    throw new Error('Manager review is required before this work order can be invoiced. Open Completed Work and approve it first.');
  }
}
