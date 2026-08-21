import { normalizeTirePositions, tireAxlesForEquipment, tireRepairRequired } from './tire-position-rules.js';

type TireRepairRow = {
  id: number;
  title: string;
  description: string;
  equipment_type: string;
};

type TirePositionRow = {
  position_code: string;
};

async function repairRow(db: D1Database, repairId: number) {
  return db.prepare(`
    SELECT r.id,
           COALESCE(r.title, '') AS title,
           COALESCE(r.description, '') AS description,
           COALESCE(e.equipment_type, '') AS equipment_type
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(repairId).first<TireRepairRow>();
}

async function savedPositions(db: D1Database, repairId: number) {
  const result = await db.prepare(`
    SELECT position_code
    FROM repair_tire_positions
    WHERE repair_id = ?
    ORDER BY position_code
  `).bind(repairId).all<TirePositionRow>();
  return result.results.map((row) => row.position_code);
}

export async function getTirePositionStatus(db: D1Database, repairId: number) {
  const repair = await repairRow(db, repairId);
  if (!repair) throw new Error('Repair was not found.');
  const equipmentType = String(repair.equipment_type || '').trim().toLowerCase();
  const required = tireRepairRequired({
    title: repair.title,
    description: repair.description,
    equipmentType,
  });
  return {
    required,
    equipmentType,
    axles: tireAxlesForEquipment(equipmentType),
    positions: await savedPositions(db, repairId),
  };
}

export async function replaceTirePositions(
  db: D1Database,
  input: {
    repairId: number;
    rawPositions: unknown;
    technicianId: number;
    userId: number;
  },
) {
  const status = await getTirePositionStatus(db, input.repairId);
  if (!status.required) throw new Error('This repair does not require a tire position.');

  const normalized = normalizeTirePositions(input.rawPositions, status.equipmentType);
  if (normalized.invalid.length) {
    throw new Error(`Invalid tire position for this ${status.equipmentType}: ${normalized.invalid.join(', ')}.`);
  }
  if (!normalized.positions.length) {
    throw new Error('Choose at least one tire position.');
  }

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM repair_tire_positions WHERE repair_id = ?').bind(input.repairId),
    ...normalized.positions.map((position) => db.prepare(`
      INSERT INTO repair_tire_positions
        (repair_id, position_code, technician_id, recorded_by_user_id, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(input.repairId, position, input.technicianId, input.userId)),
  ];
  await db.batch(statements);

  return {
    ...status,
    positions: normalized.positions,
  };
}

export async function requireSavedTirePositionBeforeCompletion(db: D1Database, repairId: number) {
  const status = await getTirePositionStatus(db, repairId);
  if (status.required && !status.positions.length) {
    throw new Error('TIRE POSITION REQUIRED: choose and save the tire position before marking this repair REPAIRED.');
  }
  return status;
}
