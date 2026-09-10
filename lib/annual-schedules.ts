type AnnualRow = {
  id: number;
  unit: string;
  equipment_type: string;
  category: string;
  interval_days: number | null;
  active: number | null;
  annual_date: string | null;
  open_annual_repair_id: number | null;
};

type AnnualRepairEquipment = {
  id: number;
  unit: string;
  driver: string | null;
  location: string | null;
};

function positiveInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive whole number.`);
  return number;
}

function selectedIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Select at least one unit.');
  const ids = [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Error('Select at least one unit.');
  if (ids.length > 500) throw new Error('Select no more than 500 units at once.');
  return ids;
}

function dateOnly(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new Error('Annual completion date is invalid.');
  }
  return raw;
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 75) {
    await db.batch(statements.slice(index, index + 75));
  }
}

export async function getAnnualScheduleData(db: D1Database) {
  const result = await db.prepare(`
    SELECT e.id, e.unit, e.equipment_type, e.category,
           a.interval_days, a.active,
           COALESCE(ps.annual_date, e.annual_date) AS annual_date,
           (
             SELECT r.id
             FROM repairs r
             WHERE r.equipment_id = e.id
               AND r.source = 'scheduled-annual'
               AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
             ORDER BY r.id DESC
             LIMIT 1
           ) AS open_annual_repair_id
    FROM equipment e
    LEFT JOIN equipment_annual_settings a ON a.equipment_id = e.id
    LEFT JOIN pm_status ps ON ps.equipment_id = e.id
    WHERE e.active = 1
    ORDER BY CASE WHEN e.equipment_type = 'trailer' THEN 1 ELSE 0 END, e.unit
  `).all<AnnualRow>();

  return {
    equipment: result.results.map((row) => ({
      id: row.id,
      unit: row.unit,
      equipmentType: row.equipment_type === 'trailer' ? 'Trailer' : 'Truck / Vehicle',
      category: row.equipment_type === 'trailer' ? 'Trailers' : (row.category && row.category !== 'fleet' ? row.category : 'Uncategorized'),
      annualIntervalDays: row.interval_days == null || row.active === 0 ? null : Number(row.interval_days),
      lastAnnualDate: row.annual_date ?? '',
      openAnnualRepairId: row.open_annual_repair_id == null ? null : `repair-${Number(row.open_annual_repair_id)}`,
    })),
    updatedAt: new Date().toISOString(),
  };
}

export async function applyAnnualSchedule(db: D1Database, body: Record<string, unknown>) {
  const ids = selectedIds(body.equipmentIds);
  const intervalDays = positiveInteger(body.intervalDays ?? 365, 'Annual/time interval');
  const placeholders = ids.map(() => '?').join(', ');
  const existing = await db.prepare(`SELECT id FROM equipment WHERE active = 1 AND id IN (${placeholders})`).bind(...ids).all<{ id: number }>();
  if (existing.results.length !== ids.length) throw new Error('One or more selected units are no longer active.');

  await runBatches(db, ids.map((id) => db.prepare(`
    INSERT INTO equipment_annual_settings (equipment_id, interval_days, active, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(equipment_id) DO UPDATE SET
      interval_days = excluded.interval_days,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(id, intervalDays)));
  return { ok: true, count: ids.length, intervalDays };
}

export async function clearAnnualSchedule(db: D1Database, body: Record<string, unknown>) {
  const ids = selectedIds(body.equipmentIds);
  await runBatches(db, ids.map((id) => db.prepare(`
    UPDATE equipment_annual_settings SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?
  `).bind(id)));
  return { ok: true, count: ids.length };
}

export async function createAnnualRepairNow(
  db: D1Database,
  body: Record<string, unknown>,
  user: { id: number; displayName: string },
) {
  const equipmentId = positiveInteger(body.equipmentId, 'Unit');
  const equipment = await db.prepare(`
    SELECT id, unit, driver, location
    FROM equipment
    WHERE id = ? AND active = 1
  `).bind(equipmentId).first<AnnualRepairEquipment>();
  if (!equipment) throw new Error('Unit was not found or is inactive.');

  const existing = await db.prepare(`
    SELECT id
    FROM repairs
    WHERE equipment_id = ?
      AND source = 'scheduled-annual'
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    ORDER BY id DESC
    LIMIT 1
  `).bind(equipmentId).first<{ id: number }>();
  if (existing) {
    return { ok: true, existing: true, repairId: `repair-${existing.id}`, equipmentId, unit: equipment.unit };
  }

  const result = await db.prepare(`
    INSERT INTO repairs (
      equipment_id, title, description, status, priority, source,
      driver, location, technician_id, updated_at
    ) VALUES (?, 'Annual / inspection requested early', ?, 'New', '2', 'scheduled-annual', ?, ?, NULL, CURRENT_TIMESTAMP)
  `).bind(
    equipmentId,
    'Annual inspection manually released early from Annual Schedule Setup. The stored last-completed Annual date was not changed.',
    equipment.driver ?? '',
    equipment.location ?? '',
  ).run();
  const repairId = Number(result.meta.last_row_id);
  if (!repairId) throw new Error('Annual repair job could not be created.');

  await db.prepare(`
    INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
    VALUES (?, ?, NULL, 'scheduled_maintenance_added', ?)
  `).bind(
    repairId,
    user.id,
    `${user.displayName} created an Annual inspection job early for Unit ${equipment.unit}. The normal Annual history remains unchanged until the inspection is completed.`,
  ).run();

  return { ok: true, existing: false, repairId: `repair-${repairId}`, equipmentId, unit: equipment.unit };
}

export async function completeAnnual(db: D1Database, body: Record<string, unknown>) {
  const equipmentId = positiveInteger(body.equipmentId, 'Unit');
  const completedDate = dateOnly(body.date);
  await db.batch([
    db.prepare(`
      INSERT INTO pm_status (equipment_id, annual_date, status, updated_at)
      VALUES (?, ?, 'Current', CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET annual_date = excluded.annual_date, updated_at = CURRENT_TIMESTAMP
    `).bind(equipmentId, completedDate),
    db.prepare(`UPDATE equipment SET annual_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND active = 1`).bind(completedDate, equipmentId),
  ]);
  return { ok: true, equipmentId, completedDate };
}