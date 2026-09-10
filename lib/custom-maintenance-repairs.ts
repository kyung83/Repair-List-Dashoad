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

function repairSource(row: DueRow) {
  return row.kind === 'rotation' ? 'scheduled-pm' : 'custom-maintenance';
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
  const workflow = row.kind === 'rotation'
    ? 'Rotational PM · mechanic PM checklist required'
    : 'Independent maintenance';
  return `${row.programName} · ${workflow} · ${schedule}`;
}

export async function syncCustomMaintenanceRepairs(db: D1Database) {
  const preview = await getCustomMaintenanceDuePreview(db) as unknown as DueRow[];
  const due = preview.filter((row) => row.due === true && (row.status === 'Due Soon' || row.status === 'Overdue'));
  if (!due.length) return { created: 0, due: 0 };

  let created = 0;
  for (const row of due) {
    const maintenanceSourceId = sourceId(row);
    const source = repairSource(row);
    const result = await db.prepare(`
      INSERT INTO repairs (
        equipment_id, title, description, status, priority, source,
        maintenance_source_id, maintenance_program_step_id,
        opened_at, updated_at
      )
      SELECT ?, ?, ?, 'New', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1
        FROM repairs existing
        LEFT JOIN maintenance_program_steps existing_step
          ON existing_step.id = existing.maintenance_program_step_id
        WHERE lower(COALESCE(existing.status,'')) NOT LIKE '%complete%'
          AND (
            (existing.maintenance_source_id = ? AND existing.maintenance_source_id IS NOT NULL)
            OR (
              ? = 'scheduled-pm'
              AND existing.equipment_id = ?
              AND (
                existing.source = 'scheduled-pm'
                OR (existing.source = 'custom-maintenance' AND existing_step.step_type = 'rotation')
              )
            )
          )
      )
    `).bind(
      row.equipmentId,
      row.itemName,
      dueDescription(row),
      row.status === 'Overdue' ? '1' : '2',
      source,
      maintenanceSourceId,
      row.programStepId,
      maintenanceSourceId,
      source,
      row.equipmentId,
    ).run();
    created += Number(result.meta.changes ?? 0);
  }

  return { created, due: due.length };
}

export async function getOpenCustomMaintenanceRepairs(db: D1Database) {
  const rows = await db.prepare(`
    SELECT id, COALESCE(maintenance_source_id,'') AS maintenance_source_id
    FROM repairs
    WHERE source IN ('custom-maintenance', 'scheduled-pm')
      AND COALESCE(maintenance_source_id,'') <> ''
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
  `).all<OpenCustomRepair>();
  return new Map(rows.results.map((row) => [Number(row.id), row.maintenance_source_id]));
}
