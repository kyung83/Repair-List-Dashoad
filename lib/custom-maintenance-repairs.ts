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

type OpenCustomRepairInfo = {
  maintenanceSourceId: string;
  issue: string;
  dueSort: number;
};

function sourceId(row: DueRow) {
  return row.kind === 'rotation'
    ? `custom-rotation-${row.equipmentId}-${row.programStepId}`
    : `custom-item-${row.equipmentId}-${row.programStepId}`;
}

function repairSource(row: DueRow) {
  return row.kind === 'rotation' ? 'scheduled-pm' : 'custom-maintenance';
}

function dueBits(row: DueRow) {
  const bits: string[] = [];
  if (row.milesRemaining != null) {
    bits.push(row.milesRemaining <= 0
      ? `${Math.abs(row.milesRemaining).toLocaleString()} miles overdue`
      : `due in ${row.milesRemaining.toLocaleString()} miles`);
  }
  if (row.daysRemaining != null) {
    bits.push(row.daysRemaining <= 0
      ? `${Math.abs(row.daysRemaining)} day(s) overdue`
      : `due in ${row.daysRemaining} day(s)`);
  }
  return bits;
}

function dueDescription(row: DueRow) {
  const schedule = dueBits(row);
  const workflow = row.kind === 'rotation'
    ? 'Rotational PM · mechanic PM checklist required'
    : 'Independent maintenance';
  return `${row.programName} · ${workflow} · ${schedule.length ? schedule.join(' or ') : row.status}`;
}

function boardIssue(row: DueRow) {
  const schedule = dueBits(row);
  return `${row.itemName}${schedule.length ? ` — ${schedule.join(' or ')}` : ` — ${row.status}`}`;
}

function dueSort(row: DueRow) {
  const scores: number[] = [];
  // Custom programs can mix mileage and calendar triggers. Normalize against the
  // program's default due-soon windows so the board can compare both dimensions.
  if (row.milesRemaining != null) scores.push(row.milesRemaining / 1000);
  if (row.daysRemaining != null) scores.push(row.daysRemaining / 30);
  return scores.length ? Math.min(...scores) : 1_000_000;
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
  const [rows, preview] = await Promise.all([
    db.prepare(`
      SELECT id, COALESCE(maintenance_source_id,'') AS maintenance_source_id
      FROM repairs
      WHERE source IN ('custom-maintenance', 'scheduled-pm')
        AND COALESCE(maintenance_source_id,'') <> ''
        AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    `).all<OpenCustomRepair>(),
    getCustomMaintenanceDuePreview(db) as unknown as Promise<DueRow[]>,
  ]);

  const dueBySource = new Map(preview.map((row) => [sourceId(row), row]));
  const result = new Map<number, OpenCustomRepairInfo>();
  for (const repair of rows.results) {
    const maintenanceSourceId = repair.maintenance_source_id;
    const live = dueBySource.get(maintenanceSourceId);
    result.set(Number(repair.id), {
      maintenanceSourceId,
      issue: live ? boardIssue(live) : maintenanceSourceId,
      dueSort: live ? dueSort(live) : 1_000_000,
    });
  }
  return result;
}
