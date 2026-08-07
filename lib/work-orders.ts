import { completeRepair, savePart, saveRepair, usePartOnRepair } from './dashboard-db';

type RepairRow = {
  id: number;
  unit: string;
  title: string;
  status: string;
  parts_text: string | null;
  driver: string | null;
  location: string | null;
  technician_id: number | null;
  technician_name: string | null;
  geotab_defect_id: string | null;
};

type TechnicianRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
};

type PartRow = {
  id: number;
  part_number: string;
  description: string;
  quantity_on_hand: number;
  location: string | null;
};

type UsageRow = {
  repair_id: number;
  part_id: number;
  part_number: string;
  description: string;
  quantity: number;
};

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^repair-(\d+)$/);
  if (!match) throw new Error('Repair row not found');
  return Number(match[1]);
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function getWorkOrderData(db: D1Database) {
  const [repairsResult, techniciansResult, partsResult, usageResult] = await Promise.all([
    db.prepare(`
      SELECT r.id, COALESCE(e.unit, '') AS unit, r.title, r.status, r.parts_text,
             r.driver, r.location, r.technician_id, t.name AS technician_name,
             r.geotab_defect_id
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN technicians t ON t.id = r.technician_id
      ORDER BY CASE WHEN lower(r.status) LIKE '%complete%' THEN 1 ELSE 0 END,
               r.updated_at DESC
    `).all<RepairRow>(),
    db.prepare(`
      SELECT id, name, email, phone
      FROM technicians
      WHERE active = 1
      ORDER BY name
    `).all<TechnicianRow>(),
    db.prepare(`
      SELECT id, part_number, description, quantity_on_hand, location
      FROM parts
      WHERE active = 1
      ORDER BY description, part_number
    `).all<PartRow>(),
    db.prepare(`
      SELECT rp.repair_id, rp.part_id, p.part_number, p.description, rp.quantity
      FROM repair_parts rp
      JOIN parts p ON p.id = rp.part_id
      ORDER BY rp.created_at, rp.id
    `).all<UsageRow>(),
  ]);

  const usageByRepair = new Map<number, UsageRow[]>();
  for (const usage of usageResult.results) {
    const list = usageByRepair.get(usage.repair_id) ?? [];
    list.push(usage);
    usageByRepair.set(usage.repair_id, list);
  }

  return {
    repairs: repairsResult.results.map((row) => ({
      id: `repair-${row.id}`,
      unit: row.unit,
      issue: row.title,
      status: row.status,
      partsText: row.parts_text ?? '',
      assignedTo: row.technician_name ?? row.driver ?? '',
      technicianId: row.technician_id,
      location: row.location ?? '',
      relatedGeotabDefectId: row.geotab_defect_id ?? '',
      usedParts: (usageByRepair.get(row.id) ?? []).map((usage) => ({
        partId: usage.part_id,
        partNumber: usage.part_number,
        description: usage.description,
        quantity: Number(usage.quantity),
      })),
    })),
    technicians: techniciansResult.results.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email ?? '',
      phone: row.phone ?? '',
    })),
    parts: partsResult.results.map((row) => ({
      id: row.id,
      partNumber: row.part_number,
      description: row.description,
      quantityOnHand: Number(row.quantity_on_hand),
      location: row.location ?? '',
    })),
    updatedAt: new Date().toISOString(),
  };
}

export async function saveTechnician(db: D1Database, body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new Error('Technician name is required');
  const id = finiteNumber(body.id, 0);
  const email = String(body.email ?? '').trim();
  const phone = String(body.phone ?? '').trim();

  if (id > 0) {
    await db.prepare(`
      UPDATE technicians
      SET name = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name, email, phone, id).run();
    return { ok: true, id };
  }

  const result = await db.prepare(`
    INSERT INTO technicians (name, email, phone)
    VALUES (?, ?, ?)
  `).bind(name, email, phone).run();
  return { ok: true, id: result.meta.last_row_id };
}

export async function assignTechnician(db: D1Database, body: Record<string, unknown>) {
  const repairId = repairNumber(body.repairId);
  const technicianId = finiteNumber(body.technicianId, 0);

  if (!technicianId) {
    await db.prepare(`
      UPDATE repairs
      SET technician_id = NULL, driver = '', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(repairId).run();
    return { ok: true, repairId: `repair-${repairId}`, technicianId: null };
  }

  const technician = await db.prepare(`
    SELECT id, name FROM technicians WHERE id = ? AND active = 1
  `).bind(technicianId).first<{ id: number; name: string }>();
  if (!technician) throw new Error('Technician not found');

  await db.prepare(`
    UPDATE repairs
    SET technician_id = ?, driver = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(technician.id, technician.name, repairId).run();

  return { ok: true, repairId: `repair-${repairId}`, technicianId: technician.id };
}

async function refreshRepairPartsText(db: D1Database, repairId: number) {
  const rows = await db.prepare(`
    SELECT p.part_number, SUM(rp.quantity) AS quantity
    FROM repair_parts rp
    JOIN parts p ON p.id = rp.part_id
    WHERE rp.repair_id = ?
    GROUP BY p.id, p.part_number
    ORDER BY p.part_number
  `).bind(repairId).all<{ part_number: string; quantity: number }>();

  const text = rows.results
    .map((row) => `${row.part_number} x${Number(row.quantity)}`)
    .join(', ');

  await db.prepare(`
    UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(text, repairId).run();
}

export async function addPartToWorkOrder(db: D1Database, body: Record<string, unknown>) {
  const repairId = repairNumber(body.repairId);
  const result = await usePartOnRepair(db, body);
  await refreshRepairPartsText(db, repairId);
  return result;
}

export async function handleWorkOrderAction(db: D1Database, body: Record<string, unknown>) {
  const action = String(body.action ?? '');
  if (action === 'saveRepair') return saveRepair(db, body);
  if (action === 'completeRepair') return completeRepair(db, body.id ?? body.repairId);
  if (action === 'saveTechnician') return saveTechnician(db, body);
  if (action === 'assignTechnician') return assignTechnician(db, body);
  if (action === 'savePart') return savePart(db, body);
  if (action === 'usePart') return addPartToWorkOrder(db, body);
  throw new Error('Unknown work-order action');
}
