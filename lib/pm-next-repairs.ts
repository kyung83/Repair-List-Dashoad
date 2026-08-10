type NextPmRepairRow = {
  id: number;
  equipment_id: number;
  description: string;
  status: 'pending' | 'attached';
  queued_from_repair_id: number | null;
  target_repair_id: number | null;
  tagged_at: string;
  defer_count: number;
  tagged_by: string | null;
};

export type NextPmRepairItem = {
  id: number;
  description: string;
  taggedAt: string;
  taggedBy: string;
  deferCount: number;
};

export async function getOpenNextPmRepairs(db: D1Database) {
  const result = await db.prepare(`
    SELECT n.id, n.equipment_id, n.description, n.status,
           n.queued_from_repair_id, n.target_repair_id, n.tagged_at, n.defer_count,
           t.name AS tagged_by
    FROM pm_next_repairs n
    LEFT JOIN technicians t ON t.id = n.tagged_by_technician_id
    WHERE n.status IN ('pending', 'attached')
    ORDER BY n.tagged_at, n.id
  `).all<NextPmRepairRow>();

  const attachedByRepair = new Map<number, NextPmRepairItem[]>();
  const queuedByRepair = new Map<number, NextPmRepairItem[]>();
  for (const row of result.results) {
    const item: NextPmRepairItem = {
      id: row.id,
      description: row.description,
      taggedAt: row.tagged_at,
      taggedBy: row.tagged_by ?? 'Technician',
      deferCount: Number(row.defer_count ?? 0),
    };
    if (row.status === 'attached' && row.target_repair_id) {
      const list = attachedByRepair.get(row.target_repair_id) ?? [];
      list.push(item);
      attachedByRepair.set(row.target_repair_id, list);
    } else if (row.status === 'pending' && row.queued_from_repair_id) {
      const list = queuedByRepair.get(row.queued_from_repair_id) ?? [];
      list.push(item);
      queuedByRepair.set(row.queued_from_repair_id, list);
    }
  }
  return { attachedByRepair, queuedByRepair };
}

function followupId(value: unknown) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Next PM repair was not found.');
  return id;
}

export async function tagNextPmRepair(
  db: D1Database,
  input: {
    repairId: number;
    equipmentId: number;
    description: unknown;
    userId: number;
    technicianId: number;
  },
) {
  const description = String(input.description ?? '').trim().slice(0, 500);
  if (!description) throw new Error('Enter the repair or condition to check on the next PM.');
  const result = await db.prepare(`
    INSERT INTO pm_next_repairs (
      equipment_id, description, status, origin_repair_id, queued_from_repair_id,
      tagged_by_user_id, tagged_by_technician_id, tagged_at, updated_at
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    input.equipmentId,
    description,
    input.repairId,
    input.repairId,
    input.userId,
    input.technicianId,
  ).run();
  return { id: Number(result.meta.last_row_id), description };
}

export async function completeNextPmRepair(
  db: D1Database,
  input: { repairId: number; equipmentId: number; itemId: unknown; userId: number },
) {
  const id = followupId(input.itemId);
  const row = await db.prepare(`
    SELECT id, description
    FROM pm_next_repairs
    WHERE id = ? AND equipment_id = ? AND target_repair_id = ? AND status = 'attached'
  `).bind(id, input.equipmentId, input.repairId).first<{ id: number; description: string }>();
  if (!row) throw new Error('That next-PM repair is no longer attached to this PM.');
  await db.prepare(`
    UPDATE pm_next_repairs
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP, completed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND target_repair_id = ? AND status = 'attached'
  `).bind(input.userId, id, input.repairId).run();
  return row;
}

export async function deferNextPmRepair(
  db: D1Database,
  input: { repairId: number; equipmentId: number; itemId: unknown },
) {
  const id = followupId(input.itemId);
  const row = await db.prepare(`
    SELECT id, description
    FROM pm_next_repairs
    WHERE id = ? AND equipment_id = ? AND target_repair_id = ? AND status = 'attached'
  `).bind(id, input.equipmentId, input.repairId).first<{ id: number; description: string }>();
  if (!row) throw new Error('That next-PM repair is no longer attached to this PM.');
  await db.prepare(`
    UPDATE pm_next_repairs
    SET status = 'pending', target_repair_id = NULL, attached_at = NULL,
        queued_from_repair_id = ?, defer_count = defer_count + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND target_repair_id = ? AND status = 'attached'
  `).bind(input.repairId, id, input.repairId).run();
  return row;
}

export async function cancelQueuedNextPmRepair(
  db: D1Database,
  input: { repairId: number; equipmentId: number; itemId: unknown; userId: number },
) {
  const id = followupId(input.itemId);
  const row = await db.prepare(`
    SELECT id, description
    FROM pm_next_repairs
    WHERE id = ? AND equipment_id = ? AND queued_from_repair_id = ?
      AND target_repair_id IS NULL AND status = 'pending'
  `).bind(id, input.equipmentId, input.repairId).first<{ id: number; description: string }>();
  if (!row) throw new Error('That queued next-PM repair is no longer available.');
  await db.prepare(`
    UPDATE pm_next_repairs
    SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND queued_from_repair_id = ? AND target_repair_id IS NULL AND status = 'pending'
  `).bind(input.userId, id, input.repairId).run();
  return row;
}

export async function unresolvedAttachedNextPmCount(db: D1Database, repairId: number) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM pm_next_repairs
    WHERE target_repair_id = ? AND status = 'attached'
  `).bind(repairId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}
