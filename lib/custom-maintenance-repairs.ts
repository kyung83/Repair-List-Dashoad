import { getCustomMaintenanceDuePreview } from './maintenance-programs';

type DueRow = {
  id: string;
  equipmentId: number;
  unit: string;
  equipmentType: string;
  programId: number;
  programName: string;
  kind: 'rotation' | 'interval';
  programStepId: number;
  maintenanceItemId: number;
  itemName: string;
  milesRemaining: number | null;
  daysRemaining: number | null;
  status: string;
  due: boolean;
};

type OpenCustomRepair = {
  id: number;
  maintenance_source_id: string;
};

function sourceId(row: DueRow) {
  return row.kind === 'rotation'
    ? `custom-rotation-${row.equipmentId}-${row.programStepId}`
    : `custom-item-${row.equipmentId}-${row.programStepId}`;
}

function dueDescription(row: DueRow) {
  const bits: string[] = [];
  if (row.milesRemaining != null) {
    bits.push(row.milesRemaining <= 0
      ? `${Math.abs(row.milesRemaining).toLocaleString()} miles overdue`
      : `due in ${row.milesRemaining.toLocaleString()} miles`);
  }
  if (row.daysRemaining != null) {
    bits.push(row.daysRemaining <= 0
      ? `${Math.abs(row.daysRemaining)} days overdue`
      : `due in ${row.daysRemaining} days`);
  }
  const schedule = bits.length ? bits.join(' or ') : row.status;
  return `${row.programName} · ${row.kind === 'rotation' ? 'Rotational PM' : 'Independent maintenance'} · ${schedule}`;
}

export async function syncCustomMaintenanceRepairs(db: D1Database) {
  const preview = await getCustomMaintenanceDuePreview(db) as unknown as DueRow[];
  const due = preview.filter((row) => row.due === true && (row.status === 'Due Soon' || row.status === 'Overdue'));
  if (!due.length) return { created: 0, due: 0 };

  let created = 0;
  for (const row of due) {
    const maintenanceSourceId = sourceId(row);
    const result = await db.prepare(`
      INSERT INTO repairs (
        equipment_id, title, description, status, priority, source,
        maintenance_source_id, maintenance_program_step_id,
        opened_at, updated_at
      )
      SELECT ?, ?, ?, 'New', ?, 'custom-maintenance', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1
        FROM repairs
        WHERE source = 'custom-maintenance'
          AND maintenance_source_id = ?
          AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
      )
    `).bind(
      row.equipmentId,
      row.itemName,
      dueDescription(row),
      row.status === 'Overdue' ? '1' : '2',
      maintenanceSourceId,
      row.programStepId,
      maintenanceSourceId,
    ).run();
    created += Number(result.meta.changes ?? 0);
  }

  return { created, due: due.length };
}

export async function getOpenCustomMaintenanceRepairs(db: D1Database) {
  const rows = await db.prepare(`
    SELECT id, COALESCE(maintenance_source_id,'') AS maintenance_source_id
    FROM repairs
    WHERE source = 'custom-maintenance'
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
  `).all<OpenCustomRepair>();
  return new Map(rows.results.map((row) => [Number(row.id), row.maintenance_source_id]));
}
