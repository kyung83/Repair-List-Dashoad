type ItemRow = {
  id: number;
  name: string;
  description: string | null;
  active: number;
};

type ProgramRow = {
  id: number;
  name: string;
  equipment_scope: string;
  rotation_mileage_interval: number | null;
  rotation_time_interval_days: number | null;
  due_soon_miles: number;
  due_soon_days: number;
  active: number;
};

type StepRow = {
  id: number;
  program_id: number;
  maintenance_item_id: number;
  item_name: string;
  item_description: string | null;
  step_type: 'rotation' | 'interval';
  position: number;
  mileage_interval: number | null;
  time_interval_days: number | null;
  resets_item_ids_json: string;
};

type EquipmentRow = {
  id: number;
  unit: string;
  equipment_type: string;
  category: string;
  current_mileage: number | null;
  make: string | null;
  model: string | null;
  program_id: number | null;
  program_name: string | null;
  rotation_position: number | null;
  rotation_last_mileage: number | null;
  rotation_last_date: string | null;
};

type IntervalDraft = {
  maintenanceItemId: number;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  resetsItemIds: number[];
};

type AssignmentRow = {
  equipment_id: number;
  program_id: number;
  current_mileage: number | null;
  unit: string;
  equipment_type: string;
  rotation_position: number;
  rotation_last_mileage: number | null;
  rotation_last_date: string | null;
  program_name: string;
  rotation_mileage_interval: number | null;
  rotation_time_interval_days: number | null;
  due_soon_miles: number;
  due_soon_days: number;
};

type IntervalStatusRow = {
  equipment_id: number;
  unit: string;
  equipment_type: string;
  current_mileage: number | null;
  program_id: number;
  program_name: string;
  program_step_id: number;
  maintenance_item_id: number;
  item_name: string;
  mileage_interval: number | null;
  time_interval_days: number | null;
  last_mileage: number | null;
  last_date: string | null;
  resets_item_ids_json: string;
  due_soon_miles: number;
  due_soon_days: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_BATCH = 75;

function text(value: unknown, label: string, max = 100) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return result;
}

function optionalText(value: unknown, max = 500) {
  const result = String(value ?? '').trim();
  if (!result) return null;
  if (result.length > max) throw new Error(`Description must be ${max} characters or fewer.`);
  return result;
}

function positiveId(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} is invalid.`);
  return number;
}

function optionalPositive(value: unknown, label: string) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive whole number.`);
  return number;
}

function nonNegative(value: unknown, label: string, fallback: number) {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be zero or a positive whole number.`);
  return number;
}

function idList(value: unknown, label: string, max = 2000) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  const ids = value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length !== value.length) throw new Error(`${label} contains an invalid selection.`);
  if (ids.length > max) throw new Error(`${label} has too many selections.`);
  return ids;
}

function uniqueIds(value: unknown, label: string, max = 2000) {
  return [...new Set(idList(value, label, max))];
}

function parseJsonIds(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || '[]') as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      : [];
  } catch {
    return [];
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysRemaining(lastDate: string | null, interval: number | null) {
  if (!lastDate || interval == null) return null;
  const start = Date.parse(`${lastDate}T12:00:00Z`);
  if (!Number.isFinite(start)) return null;
  return Math.ceil((start + interval * DAY_MS - Date.now()) / DAY_MS);
}

function dueState(
  currentMileage: number | null,
  lastMileage: number | null,
  mileageInterval: number | null,
  lastDate: string | null,
  timeIntervalDays: number | null,
  dueSoonMiles: number,
  dueSoonDays: number,
) {
  const milesRemaining = currentMileage != null && lastMileage != null && mileageInterval != null
    ? lastMileage + mileageInterval - currentMileage
    : null;
  const timeRemaining = daysRemaining(lastDate, timeIntervalDays);
  const needsMileageBaseline = mileageInterval != null && lastMileage == null;
  const needsDateBaseline = timeIntervalDays != null && !lastDate;
  const overdue = (milesRemaining != null && milesRemaining <= 0) || (timeRemaining != null && timeRemaining <= 0);
  const dueSoon = overdue || (milesRemaining != null && milesRemaining <= dueSoonMiles) || (timeRemaining != null && timeRemaining <= dueSoonDays);
  return {
    milesRemaining,
    daysRemaining: timeRemaining,
    needsBaseline: needsMileageBaseline || needsDateBaseline,
    status: needsMileageBaseline || needsDateBaseline ? 'Needs baseline' : overdue ? 'Overdue' : dueSoon ? 'Due Soon' : 'OK',
    due: !needsMileageBaseline && !needsDateBaseline && dueSoon,
  };
}

async function ensureItemIds(db: D1Database, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const placeholders = unique.map(() => '?').join(',');
  const found = await db.prepare(`SELECT id FROM maintenance_items WHERE active = 1 AND id IN (${placeholders})`)
    .bind(...unique).all<{ id: number }>();
  if (found.results.length !== unique.length) throw new Error('One or more maintenance items are no longer active.');
}

export async function getMaintenanceProgramSetup(db: D1Database) {
  const [itemsResult, programsResult, stepsResult, equipmentResult] = await Promise.all([
    db.prepare(`
      SELECT id, name, description, active
      FROM maintenance_items
      WHERE active = 1
      ORDER BY name COLLATE NOCASE
    `).all<ItemRow>(),
    db.prepare(`
      SELECT id, name, equipment_scope, rotation_mileage_interval, rotation_time_interval_days,
             due_soon_miles, due_soon_days, active
      FROM maintenance_programs
      WHERE active = 1
      ORDER BY name COLLATE NOCASE
    `).all<ProgramRow>(),
    db.prepare(`
      SELECT s.id, s.program_id, s.maintenance_item_id, i.name AS item_name,
             i.description AS item_description, s.step_type, s.position,
             s.mileage_interval, s.time_interval_days, s.resets_item_ids_json
      FROM maintenance_program_steps s
      JOIN maintenance_items i ON i.id = s.maintenance_item_id
      JOIN maintenance_programs p ON p.id = s.program_id
      WHERE s.active = 1 AND p.active = 1 AND i.active = 1
      ORDER BY s.program_id, CASE s.step_type WHEN 'rotation' THEN 0 ELSE 1 END, s.position, i.name
    `).all<StepRow>(),
    db.prepare(`
      SELECT e.id, e.unit, e.equipment_type, e.category, e.current_mileage, e.make, e.model,
             a.program_id, p.name AS program_name, a.rotation_position,
             a.rotation_last_mileage, a.rotation_last_date
      FROM equipment e
      LEFT JOIN equipment_maintenance_programs a ON a.equipment_id = e.id
      LEFT JOIN maintenance_programs p ON p.id = a.program_id AND p.active = 1
      WHERE e.active = 1
      ORDER BY CASE WHEN e.equipment_type = 'trailer' THEN 1 ELSE 0 END, e.unit
    `).all<EquipmentRow>(),
  ]);

  const stepsByProgram = new Map<number, StepRow[]>();
  for (const step of stepsResult.results) {
    const list = stepsByProgram.get(step.program_id) ?? [];
    list.push(step);
    stepsByProgram.set(step.program_id, list);
  }

  const programs = programsResult.results.map((program) => {
    const steps = stepsByProgram.get(program.id) ?? [];
    return {
      id: program.id,
      name: program.name,
      equipmentScope: program.equipment_scope,
      rotationMileageInterval: program.rotation_mileage_interval == null ? null : Number(program.rotation_mileage_interval),
      rotationTimeIntervalDays: program.rotation_time_interval_days == null ? null : Number(program.rotation_time_interval_days),
      dueSoonMiles: Number(program.due_soon_miles),
      dueSoonDays: Number(program.due_soon_days),
      rotation: steps.filter((step) => step.step_type === 'rotation').map((step) => ({
        id: step.id,
        maintenanceItemId: step.maintenance_item_id,
        name: step.item_name,
        description: step.item_description ?? '',
        position: step.position,
      })),
      intervals: steps.filter((step) => step.step_type === 'interval').map((step) => ({
        id: step.id,
        maintenanceItemId: step.maintenance_item_id,
        name: step.item_name,
        description: step.item_description ?? '',
        mileageInterval: step.mileage_interval == null ? null : Number(step.mileage_interval),
        timeIntervalDays: step.time_interval_days == null ? null : Number(step.time_interval_days),
        resetsItemIds: parseJsonIds(step.resets_item_ids_json),
      })),
    };
  });

  const duePreview = await getCustomMaintenanceDuePreview(db);

  return {
    items: itemsResult.results.map((item) => ({ id: item.id, name: item.name, description: item.description ?? '' })),
    programs,
    equipment: equipmentResult.results.map((row) => ({
      id: row.id,
      unit: row.unit,
      equipmentType: row.equipment_type === 'trailer' ? 'Trailer' : 'Vehicle',
      category: row.category,
      currentMileage: row.current_mileage == null ? null : Number(row.current_mileage),
      make: row.make ?? '',
      model: row.model ?? '',
      programId: row.program_id,
      programName: row.program_name ?? '',
      rotationPosition: row.rotation_position ?? 0,
      rotationLastMileage: row.rotation_last_mileage == null ? null : Number(row.rotation_last_mileage),
      rotationLastDate: row.rotation_last_date ?? '',
    })),
    duePreview,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveMaintenanceItem(db: D1Database, body: Record<string, unknown>) {
  const name = text(body.name, 'Maintenance item name');
  const description = optionalText(body.description);
  const id = body.id == null || String(body.id).trim() === '' ? null : positiveId(body.id, 'Maintenance item');

  if (id == null) {
    const existing = await db.prepare('SELECT id FROM maintenance_items WHERE lower(name) = lower(?)').bind(name).first<{ id: number }>();
    if (existing) throw new Error('A maintenance item with that name already exists.');
    const result = await db.prepare(`
      INSERT INTO maintenance_items (name, description, active, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(name, description).run();
    return { ok: true, id: Number(result.meta.last_row_id), name };
  }

  const duplicate = await db.prepare('SELECT id FROM maintenance_items WHERE lower(name) = lower(?) AND id <> ?')
    .bind(name, id).first<{ id: number }>();
  if (duplicate) throw new Error('A maintenance item with that name already exists.');
  const result = await db.prepare(`
    UPDATE maintenance_items
    SET name = ?, description = ?, active = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, description, id).run();
  if (!result.meta.changes) throw new Error('Maintenance item was not found.');
  return { ok: true, id, name };
}

export async function deactivateMaintenanceItem(db: D1Database, body: Record<string, unknown>) {
  const id = positiveId(body.id, 'Maintenance item');
  const used = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM maintenance_program_steps s
    JOIN maintenance_programs p ON p.id = s.program_id
    WHERE s.maintenance_item_id = ? AND s.active = 1 AND p.active = 1
  `).bind(id).first<{ count: number }>();
  if (Number(used?.count ?? 0) > 0) throw new Error('Remove this item from active maintenance programs before deactivating it.');
  await db.prepare('UPDATE maintenance_items SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
  return { ok: true, id };
}

export async function saveMaintenanceProgram(db: D1Database, body: Record<string, unknown>) {
  const id = body.id == null || String(body.id).trim() === '' ? null : positiveId(body.id, 'Maintenance program');
  const name = text(body.name, 'Program name');
  const equipmentScope = String(body.equipmentScope ?? 'vehicle').trim().toLowerCase();
  if (!['vehicle', 'trailer', 'any'].includes(equipmentScope)) throw new Error('Choose Vehicle, Trailer, or Any for equipment type.');
  const rotationMileageInterval = optionalPositive(body.rotationMileageInterval, 'Rotation mileage interval');
  const rotationTimeIntervalDays = optionalPositive(body.rotationTimeIntervalDays, 'Rotation time interval');
  const dueSoonMiles = nonNegative(body.dueSoonMiles, 'Due-soon mileage', 1000);
  const dueSoonDays = nonNegative(body.dueSoonDays, 'Due-soon days', 30);
  const rotationItemIds = idList(body.rotationItemIds ?? [], 'Rotation');
  if (rotationItemIds.length && rotationMileageInterval == null && rotationTimeIntervalDays == null) {
    throw new Error('Set a mileage or time interval for the rotation.');
  }
  if (!rotationItemIds.length && (rotationMileageInterval != null || rotationTimeIntervalDays != null)) {
    throw new Error('Add at least one rotation step or clear the rotation interval.');
  }

  if (!Array.isArray(body.intervalItems)) throw new Error('Independent maintenance items must be a list.');
  const intervalItems: IntervalDraft[] = body.intervalItems.map((raw, index) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const maintenanceItemId = positiveId(item.maintenanceItemId, `Independent item ${index + 1}`);
    const mileageInterval = optionalPositive(item.mileageInterval, `Independent item ${index + 1} mileage`);
    const timeIntervalDays = optionalPositive(item.timeIntervalDays, `Independent item ${index + 1} time`);
    if (mileageInterval == null && timeIntervalDays == null) throw new Error(`Set mileage, time, or both for independent item ${index + 1}.`);
    const resetsItemIds = uniqueIds(item.resetsItemIds ?? [], `Independent item ${index + 1} reset list`, 100);
    return { maintenanceItemId, mileageInterval, timeIntervalDays, resetsItemIds };
  });
  if (new Set(intervalItems.map((item) => item.maintenanceItemId)).size !== intervalItems.length) {
    throw new Error('Each independent maintenance item can only appear once in a program.');
  }

  const allItemIds = [...rotationItemIds, ...intervalItems.flatMap((item) => [item.maintenanceItemId, ...item.resetsItemIds])];
  await ensureItemIds(db, allItemIds);

  const duplicate = id == null
    ? await db.prepare('SELECT id FROM maintenance_programs WHERE lower(name) = lower(?)').bind(name).first<{ id: number }>()
    : await db.prepare('SELECT id FROM maintenance_programs WHERE lower(name) = lower(?) AND id <> ?').bind(name, id).first<{ id: number }>();
  if (duplicate) throw new Error('A maintenance program with that name already exists.');

  let programId = id;
  if (programId == null) {
    const inserted = await db.prepare(`
      INSERT INTO maintenance_programs (
        name, equipment_scope, rotation_mileage_interval, rotation_time_interval_days,
        due_soon_miles, due_soon_days, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(name, equipmentScope, rotationMileageInterval, rotationTimeIntervalDays, dueSoonMiles, dueSoonDays).run();
    programId = Number(inserted.meta.last_row_id);
  } else {
    const updated = await db.prepare(`
      UPDATE maintenance_programs
      SET name = ?, equipment_scope = ?, rotation_mileage_interval = ?, rotation_time_interval_days = ?,
          due_soon_miles = ?, due_soon_days = ?, active = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name, equipmentScope, rotationMileageInterval, rotationTimeIntervalDays, dueSoonMiles, dueSoonDays, programId).run();
    if (!updated.meta.changes) throw new Error('Maintenance program was not found.');
  }

  const oldIntervals = await db.prepare(`
    SELECT id, maintenance_item_id FROM maintenance_program_steps
    WHERE program_id = ? AND step_type = 'interval'
  `).bind(programId).all<{ id: number; maintenance_item_id: number }>();
  const oldByItem = new Map<number, number>(oldIntervals.results.map((row) => [Number(row.maintenance_item_id), Number(row.id)]));
  const keepIntervalIds = new Set<number>();

  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM maintenance_program_steps WHERE program_id = ? AND step_type = 'rotation'`).bind(programId),
  ];

  rotationItemIds.forEach((maintenanceItemId, position) => {
    statements.push(db.prepare(`
      INSERT INTO maintenance_program_steps (
        program_id, maintenance_item_id, step_type, position, mileage_interval, time_interval_days,
        resets_item_ids_json, active, updated_at
      ) VALUES (?, ?, 'rotation', ?, NULL, NULL, '[]', 1, CURRENT_TIMESTAMP)
    `).bind(programId, maintenanceItemId, position));
  });

  intervalItems.forEach((item, position) => {
    const existingId = oldByItem.get(item.maintenanceItemId);
    const resetsJson = JSON.stringify(item.resetsItemIds);
    if (existingId) {
      keepIntervalIds.add(existingId);
      statements.push(db.prepare(`
        UPDATE maintenance_program_steps
        SET position = ?, mileage_interval = ?, time_interval_days = ?, resets_item_ids_json = ?,
            active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(position, item.mileageInterval, item.timeIntervalDays, resetsJson, existingId));
    } else {
      statements.push(db.prepare(`
        INSERT INTO maintenance_program_steps (
          program_id, maintenance_item_id, step_type, position, mileage_interval, time_interval_days,
          resets_item_ids_json, active, updated_at
        ) VALUES (?, ?, 'interval', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `).bind(programId, item.maintenanceItemId, position, item.mileageInterval, item.timeIntervalDays, resetsJson));
    }
  });

  for (const row of oldIntervals.results) {
    if (!keepIntervalIds.has(Number(row.id)) && !intervalItems.some((item) => item.maintenanceItemId === Number(row.maintenance_item_id))) {
      statements.push(db.prepare('DELETE FROM equipment_maintenance_step_status WHERE program_step_id = ?').bind(row.id));
      statements.push(db.prepare('DELETE FROM maintenance_program_steps WHERE id = ?').bind(row.id));
    }
  }

  for (let start = 0; start < statements.length; start += ID_BATCH) {
    await db.batch(statements.slice(start, start + ID_BATCH));
  }

  return { ok: true, id: programId, name };
}

export async function deactivateMaintenanceProgram(db: D1Database, body: Record<string, unknown>) {
  const id = positiveId(body.id, 'Maintenance program');
  const assigned = await db.prepare('SELECT COUNT(*) AS count FROM equipment_maintenance_programs WHERE program_id = ?')
    .bind(id).first<{ count: number }>();
  if (Number(assigned?.count ?? 0) > 0) throw new Error('Reassign or remove this program from its units before deactivating it.');
  await db.prepare('UPDATE maintenance_programs SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
  return { ok: true, id };
}

export async function assignMaintenanceProgram(db: D1Database, body: Record<string, unknown>) {
  const programId = positiveId(body.programId, 'Maintenance program');
  const equipmentIds = uniqueIds(body.equipmentIds, 'Selected units');
  if (!equipmentIds.length) throw new Error('Select at least one unit.');
  const program = await db.prepare(`
    SELECT id, equipment_scope FROM maintenance_programs WHERE id = ? AND active = 1
  `).bind(programId).first<{ id: number; equipment_scope: string }>();
  if (!program) throw new Error('Maintenance program was not found.');

  const rows: Array<{ id: number; equipment_type: string; current_mileage: number | null }> = [];
  for (let start = 0; start < equipmentIds.length; start += ID_BATCH) {
    const chunk = equipmentIds.slice(start, start + ID_BATCH);
    const placeholders = chunk.map(() => '?').join(',');
    const found = await db.prepare(`
      SELECT id, equipment_type, current_mileage FROM equipment
      WHERE active = 1 AND id IN (${placeholders})
    `).bind(...chunk).all<{ id: number; equipment_type: string; current_mileage: number | null }>();
    rows.push(...found.results);
  }
  if (rows.length !== equipmentIds.length) throw new Error('One or more selected units are no longer active.');

  const incompatible = rows.filter((row) => {
    if (program.equipment_scope === 'any') return false;
    const isTrailer = row.equipment_type === 'trailer';
    return program.equipment_scope === 'trailer' ? !isTrailer : isTrailer;
  });
  if (incompatible.length) throw new Error('The selected program does not match one or more selected unit types.');

  const intervalSteps = await db.prepare(`
    SELECT id FROM maintenance_program_steps
    WHERE program_id = ? AND step_type = 'interval' AND active = 1
  `).bind(programId).all<{ id: number }>();
  const date = today();
  const statements: D1PreparedStatement[] = [];

  for (const row of rows) {
    const current = await db.prepare('SELECT program_id FROM equipment_maintenance_programs WHERE equipment_id = ?')
      .bind(row.id).first<{ program_id: number }>();
    const sameProgram = Number(current?.program_id ?? 0) === programId;
    if (!sameProgram) {
      statements.push(db.prepare('DELETE FROM equipment_maintenance_step_status WHERE equipment_id = ?').bind(row.id));
    }
    statements.push(db.prepare(`
      INSERT INTO equipment_maintenance_programs (
        equipment_id, program_id, rotation_position, rotation_last_mileage, rotation_last_date, assigned_at, updated_at
      ) VALUES (?, ?, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET
        program_id = excluded.program_id,
        rotation_position = CASE WHEN equipment_maintenance_programs.program_id = excluded.program_id THEN equipment_maintenance_programs.rotation_position ELSE 0 END,
        rotation_last_mileage = CASE WHEN equipment_maintenance_programs.program_id = excluded.program_id THEN equipment_maintenance_programs.rotation_last_mileage ELSE excluded.rotation_last_mileage END,
        rotation_last_date = CASE WHEN equipment_maintenance_programs.program_id = excluded.program_id THEN equipment_maintenance_programs.rotation_last_date ELSE excluded.rotation_last_date END,
        updated_at = CURRENT_TIMESTAMP
    `).bind(row.id, programId, row.current_mileage, date));
    for (const step of intervalSteps.results) {
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO equipment_maintenance_step_status (
          equipment_id, program_step_id, last_mileage, last_date, updated_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(row.id, step.id, row.current_mileage, date));
    }
  }

  for (let start = 0; start < statements.length; start += ID_BATCH) {
    await db.batch(statements.slice(start, start + ID_BATCH));
  }
  return { ok: true, count: rows.length, programId };
}

export async function removeMaintenanceProgramAssignment(db: D1Database, body: Record<string, unknown>) {
  const equipmentIds = uniqueIds(body.equipmentIds, 'Selected units');
  if (!equipmentIds.length) throw new Error('Select at least one unit.');
  const statements: D1PreparedStatement[] = [];
  for (const id of equipmentIds) {
    statements.push(db.prepare('DELETE FROM equipment_maintenance_step_status WHERE equipment_id = ?').bind(id));
    statements.push(db.prepare('DELETE FROM equipment_maintenance_programs WHERE equipment_id = ?').bind(id));
  }
  for (let start = 0; start < statements.length; start += ID_BATCH) await db.batch(statements.slice(start, start + ID_BATCH));
  return { ok: true, count: equipmentIds.length };
}

export async function getCustomMaintenanceDuePreview(db: D1Database) {
  const [assignmentsResult, rotationsResult, intervalsResult] = await Promise.all([
    db.prepare(`
      SELECT a.equipment_id, a.program_id, e.current_mileage, e.unit, e.equipment_type,
             a.rotation_position, a.rotation_last_mileage, a.rotation_last_date,
             p.name AS program_name, p.rotation_mileage_interval, p.rotation_time_interval_days,
             p.due_soon_miles, p.due_soon_days
      FROM equipment_maintenance_programs a
      JOIN equipment e ON e.id = a.equipment_id AND e.active = 1
      JOIN maintenance_programs p ON p.id = a.program_id AND p.active = 1
      ORDER BY e.unit
    `).all<AssignmentRow>(),
    db.prepare(`
      SELECT s.id, s.program_id, s.maintenance_item_id, i.name AS item_name,
             i.description AS item_description, s.step_type, s.position,
             s.mileage_interval, s.time_interval_days, s.resets_item_ids_json
      FROM maintenance_program_steps s
      JOIN maintenance_items i ON i.id = s.maintenance_item_id AND i.active = 1
      JOIN maintenance_programs p ON p.id = s.program_id AND p.active = 1
      WHERE s.step_type = 'rotation' AND s.active = 1
      ORDER BY s.program_id, s.position
    `).all<StepRow>(),
    db.prepare(`
      SELECT a.equipment_id, e.unit, e.equipment_type, e.current_mileage,
             a.program_id, p.name AS program_name, s.id AS program_step_id,
             s.maintenance_item_id, i.name AS item_name, s.mileage_interval, s.time_interval_days,
             st.last_mileage, st.last_date, s.resets_item_ids_json,
             p.due_soon_miles, p.due_soon_days
      FROM equipment_maintenance_programs a
      JOIN equipment e ON e.id = a.equipment_id AND e.active = 1
      JOIN maintenance_programs p ON p.id = a.program_id AND p.active = 1
      JOIN maintenance_program_steps s ON s.program_id = a.program_id AND s.step_type = 'interval' AND s.active = 1
      JOIN maintenance_items i ON i.id = s.maintenance_item_id AND i.active = 1
      LEFT JOIN equipment_maintenance_step_status st ON st.equipment_id = a.equipment_id AND st.program_step_id = s.id
      ORDER BY e.unit, s.position, i.name
    `).all<IntervalStatusRow>(),
  ]);

  const rotationsByProgram = new Map<number, StepRow[]>();
  for (const step of rotationsResult.results) {
    const list = rotationsByProgram.get(step.program_id) ?? [];
    list.push(step);
    rotationsByProgram.set(step.program_id, list);
  }

  const preview: Array<Record<string, unknown>> = [];
  for (const assignment of assignmentsResult.results) {
    const rotation = rotationsByProgram.get(assignment.program_id) ?? [];
    if (rotation.length) {
      const position = Math.max(0, Number(assignment.rotation_position ?? 0)) % rotation.length;
      const step = rotation[position];
      const state = dueState(
        assignment.current_mileage == null ? null : Number(assignment.current_mileage),
        assignment.rotation_last_mileage == null ? null : Number(assignment.rotation_last_mileage),
        assignment.rotation_mileage_interval == null ? null : Number(assignment.rotation_mileage_interval),
        assignment.rotation_last_date,
        assignment.rotation_time_interval_days == null ? null : Number(assignment.rotation_time_interval_days),
        Number(assignment.due_soon_miles),
        Number(assignment.due_soon_days),
      );
      preview.push({
        id: `custom-rotation-${assignment.equipment_id}`,
        equipmentId: assignment.equipment_id,
        unit: assignment.unit,
        equipmentType: assignment.equipment_type,
        programId: assignment.program_id,
        programName: assignment.program_name,
        kind: 'rotation',
        programStepId: step.id,
        maintenanceItemId: step.maintenance_item_id,
        itemName: step.item_name,
        sequencePosition: position,
        ...state,
      });
    }
  }

  for (const row of intervalsResult.results) {
    const state = dueState(
      row.current_mileage == null ? null : Number(row.current_mileage),
      row.last_mileage == null ? null : Number(row.last_mileage),
      row.mileage_interval == null ? null : Number(row.mileage_interval),
      row.last_date,
      row.time_interval_days == null ? null : Number(row.time_interval_days),
      Number(row.due_soon_miles),
      Number(row.due_soon_days),
    );
    preview.push({
      id: `custom-item-${row.equipment_id}-${row.program_step_id}`,
      equipmentId: row.equipment_id,
      unit: row.unit,
      equipmentType: row.equipment_type,
      programId: row.program_id,
      programName: row.program_name,
      kind: 'interval',
      programStepId: row.program_step_id,
      maintenanceItemId: row.maintenance_item_id,
      itemName: row.item_name,
      mileageInterval: row.mileage_interval == null ? null : Number(row.mileage_interval),
      timeIntervalDays: row.time_interval_days == null ? null : Number(row.time_interval_days),
      resetsItemIds: parseJsonIds(row.resets_item_ids_json),
      ...state,
    });
  }

  return preview.sort((a, b) => String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true }) || String(a.itemName).localeCompare(String(b.itemName)));
}

export async function getCustomMaintenanceBoardItems(db: D1Database) {
  const preview = await getCustomMaintenanceDuePreview(db);
  return preview.filter((item) => item.due === true).map((item) => {
    const miles = item.milesRemaining as number | null;
    const days = item.daysRemaining as number | null;
    const dueBits: string[] = [];
    if (miles != null) dueBits.push(miles <= 0 ? `${Math.abs(miles).toLocaleString()} mi overdue` : `in ${miles.toLocaleString()} mi`);
    if (days != null) dueBits.push(days <= 0 ? `${Math.abs(days)} day(s) overdue` : `in ${days} day(s)`);
    return {
      id: String(item.id),
      equipmentId: Number(item.equipmentId),
      unit: String(item.unit),
      issue: `${String(item.itemName)} ${String(item.status).toLowerCase()}${dueBits.length ? ` — ${dueBits.join(' or ')}` : ''}`,
      status: item.status === 'Overdue' ? 'PM Overdue' : 'PM Due Soon',
      equipmentType: String(item.equipmentType),
      maintenanceKind: 'custom' as const,
      programName: String(item.programName),
      programStepId: Number(item.programStepId),
    };
  });
}

export async function completeCustomMaintenanceBoardItem(db: D1Database, idValue: unknown) {
  const id = String(idValue ?? '');
  const rotationMatch = id.match(/^custom-rotation-(\d+)$/);
  const intervalMatch = id.match(/^custom-item-(\d+)-(\d+)$/);
  if (!rotationMatch && !intervalMatch) return null;
  const equipmentId = Number(rotationMatch?.[1] ?? intervalMatch?.[1]);
  const suppliedStepId = intervalMatch ? Number(intervalMatch[2]) : null;

  const assignment = await db.prepare(`
    SELECT a.program_id, a.rotation_position, e.current_mileage
    FROM equipment_maintenance_programs a
    JOIN equipment e ON e.id = a.equipment_id AND e.active = 1
    JOIN maintenance_programs p ON p.id = a.program_id AND p.active = 1
    WHERE a.equipment_id = ?
  `).bind(equipmentId).first<{ program_id: number; rotation_position: number; current_mileage: number | null }>();
  if (!assignment) throw new Error('The custom maintenance program is no longer assigned to this unit.');
  const date = today();
  const mileage = assignment.current_mileage == null ? null : Number(assignment.current_mileage);

  let step: StepRow | null = null;
  let nextRotationPosition: number | null = null;
  if (rotationMatch) {
    const rotation = await db.prepare(`
      SELECT s.id, s.program_id, s.maintenance_item_id, i.name AS item_name,
             i.description AS item_description, s.step_type, s.position,
             s.mileage_interval, s.time_interval_days, s.resets_item_ids_json
      FROM maintenance_program_steps s
      JOIN maintenance_items i ON i.id = s.maintenance_item_id
      WHERE s.program_id = ? AND s.step_type = 'rotation' AND s.active = 1 AND i.active = 1
      ORDER BY s.position
    `).bind(assignment.program_id).all<StepRow>();
    if (!rotation.results.length) throw new Error('The rotation no longer has any steps.');
    const position = Math.max(0, Number(assignment.rotation_position ?? 0)) % rotation.results.length;
    step = rotation.results[position];
    nextRotationPosition = (position + 1) % rotation.results.length;
  } else {
    step = await db.prepare(`
      SELECT s.id, s.program_id, s.maintenance_item_id, i.name AS item_name,
             i.description AS item_description, s.step_type, s.position,
             s.mileage_interval, s.time_interval_days, s.resets_item_ids_json
      FROM maintenance_program_steps s
      JOIN maintenance_items i ON i.id = s.maintenance_item_id
      WHERE s.id = ? AND s.program_id = ? AND s.step_type = 'interval' AND s.active = 1 AND i.active = 1
    `).bind(suppliedStepId, assignment.program_id).first<StepRow>();
    if (!step) throw new Error('The maintenance item is no longer part of this program.');
  }

  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO custom_maintenance_events (
        equipment_id, program_id, program_step_id, maintenance_item_id, event_date, mileage, source
      ) VALUES (?, ?, ?, ?, ?, ?, 'repair-board')
    `).bind(equipmentId, assignment.program_id, step.id, step.maintenance_item_id, date, mileage),
  ];

  if (rotationMatch) {
    statements.push(db.prepare(`
      UPDATE equipment_maintenance_programs
      SET rotation_position = ?, rotation_last_mileage = ?, rotation_last_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE equipment_id = ?
    `).bind(nextRotationPosition, mileage, date, equipmentId));
  } else {
    statements.push(db.prepare(`
      INSERT INTO equipment_maintenance_step_status (
        equipment_id, program_step_id, last_mileage, last_date, last_completed_at, updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id, program_step_id) DO UPDATE SET
        last_mileage = excluded.last_mileage,
        last_date = excluded.last_date,
        last_completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).bind(equipmentId, step.id, mileage, date));

    const resetIds = parseJsonIds(step.resets_item_ids_json);
    if (resetIds.length) {
      const placeholders = resetIds.map(() => '?').join(',');
      const resetSteps = await db.prepare(`
        SELECT id FROM maintenance_program_steps
        WHERE program_id = ? AND step_type = 'interval' AND active = 1
          AND maintenance_item_id IN (${placeholders})
      `).bind(assignment.program_id, ...resetIds).all<{ id: number }>();
      for (const resetStep of resetSteps.results) {
        statements.push(db.prepare(`
          INSERT INTO equipment_maintenance_step_status (
            equipment_id, program_step_id, last_mileage, last_date, last_completed_at, updated_at
          ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(equipment_id, program_step_id) DO UPDATE SET
            last_mileage = excluded.last_mileage,
            last_date = excluded.last_date,
            last_completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        `).bind(equipmentId, resetStep.id, mileage, date));
      }
    }
  }

  await db.batch(statements);
  return {
    ok: true,
    equipmentId,
    programId: assignment.program_id,
    programStepId: step.id,
    maintenanceItemId: step.maintenance_item_id,
    completedItem: step.item_name,
    completedDate: date,
    mileage,
    nextRotationPosition,
  };
}
