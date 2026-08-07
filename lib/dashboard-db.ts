export type RepairInput = {
  id?: string;
  unit?: string;
  issue?: string;
  parts?: string;
  status?: string;
  driver?: string;
  location?: string;
  geotabDefectId?: string;
};

type RepairRow = {
  id: number;
  unit: string;
  issue: string;
  parts: string | null;
  status: string;
  driver: string | null;
  location: string | null;
  geotab_defect_id: string | null;
};

type DvirRow = {
  geotab_log_id: string;
  geotab_defect_id: string;
  asset_unit: string;
  driver: string | null;
  defect: string;
  comments: string | null;
  photos_url: string | null;
  repaired: number;
};

type PmRow = {
  unit: string;
  pm_type: string | null;
  status: string | null;
  driver: string | null;
  location: string | null;
};

type EquipmentRow = {
  unit: string;
  service_date: string | null;
  annual_date: string | null;
  notes: string | null;
  equipment_type: string;
};

export async function getDashboardData(db: D1Database, geotabConfigured: boolean) {
  const [repairsResult, dvirResult, pmResult, equipmentResult] = await Promise.all([
    db.prepare(`
      SELECT r.id, COALESCE(e.unit, '') AS unit, r.title AS issue,
             COALESCE(r.parts_text, '') AS parts, r.status,
             COALESCE(r.driver, '') AS driver, COALESCE(r.location, '') AS location,
             r.geotab_defect_id
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      ORDER BY CASE WHEN lower(r.status) LIKE '%complete%' THEN 1 ELSE 0 END, r.updated_at DESC
    `).all<RepairRow>(),
    db.prepare(`
      SELECT geotab_log_id, geotab_defect_id, asset_unit, driver, defect,
             comments, photos_url, repaired
      FROM dvir_defects
      ORDER BY repaired ASC, updated_at DESC
    `).all<DvirRow>(),
    db.prepare(`
      SELECT e.unit, p.pm_type, p.status, e.driver, e.location
      FROM pm_status p
      JOIN equipment e ON e.id = p.equipment_id
      WHERE e.active = 1
      ORDER BY e.unit
    `).all<PmRow>(),
    db.prepare(`
      SELECT unit, service_date, annual_date, notes, equipment_type
      FROM equipment
      WHERE active = 1
      ORDER BY unit
    `).all<EquipmentRow>(),
  ]);

  return {
    repairs: repairsResult.results.map((row) => ({
      id: `repair-${row.id}`,
      unit: row.unit,
      issue: row.issue,
      parts: row.parts ?? '',
      status: row.status,
      driver: row.driver ?? '',
      location: row.location ?? '',
      relatedGeotabDefectId: row.geotab_defect_id ?? '',
    })),
    dvir: dvirResult.results.map((row) => ({
      id: `dvir-${row.geotab_defect_id}`,
      asset: row.asset_unit,
      driver: row.driver ?? '',
      defect: row.defect,
      comments: row.comments ?? '',
      photos: row.photos_url ?? '',
      repaired: Boolean(row.repaired),
      logId: row.geotab_log_id,
      defectId: row.geotab_defect_id,
    })),
    pm: pmResult.results.map((row) => ({
      unit: row.unit,
      pmType: row.pm_type ?? '',
      status: row.status ?? '',
      driver: row.driver ?? '',
      location: row.location ?? '',
    })),
    equipment: equipmentResult.results.map((row) => ({
      unit: row.unit,
      serviceDate: row.service_date ?? '',
      annualDate: row.annual_date ?? '',
      notes: row.notes ?? '',
      type: row.equipment_type === 'trailer' ? 'Trailer' : 'Truck',
    })),
    updatedAt: new Date().toISOString(),
    preview: false,
    geotabConfigured,
  };
}

async function equipmentIdForUnit(db: D1Database, unit: string) {
  await db.prepare(`
    INSERT INTO equipment (unit, category, equipment_type, updated_at)
    VALUES (?, 'fleet', 'other', CURRENT_TIMESTAMP)
    ON CONFLICT(unit) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
  `).bind(unit).run();
  const row = await db.prepare('SELECT id FROM equipment WHERE unit = ?').bind(unit).first<{ id: number }>();
  if (!row) throw new Error('Unable to resolve equipment');
  return row.id;
}

export async function saveRepair(db: D1Database, input: RepairInput) {
  const unit = String(input.unit ?? '').trim();
  const issue = String(input.issue ?? '').trim();
  if (!unit || !issue) throw new Error('Unit and repair needed are required');

  const equipmentId = await equipmentIdForUnit(db, unit);
  const status = String(input.status ?? 'New').trim() || 'New';
  const geotabDefectId = String(input.geotabDefectId ?? '').trim() || null;
  const match = String(input.id ?? '').match(/^repair-(\d+)$/);

  if (match) {
    const id = Number(match[1]);
    await db.prepare(`
      UPDATE repairs
      SET equipment_id = ?, title = ?, parts_text = ?, status = ?, driver = ?,
          location = ?, geotab_defect_id = COALESCE(?, geotab_defect_id), updated_at = CURRENT_TIMESTAMP,
          completed_at = CASE WHEN lower(?) LIKE '%complete%' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END
      WHERE id = ?
    `).bind(
      equipmentId,
      issue,
      String(input.parts ?? '').trim(),
      status,
      String(input.driver ?? '').trim(),
      String(input.location ?? '').trim(),
      geotabDefectId,
      status,
      id,
    ).run();
    return { ok: true, id: `repair-${id}` };
  }

  const result = await db.prepare(`
    INSERT INTO repairs (equipment_id, title, parts_text, status, driver, location, source, geotab_defect_id)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)
  `).bind(
    equipmentId,
    issue,
    String(input.parts ?? '').trim(),
    status,
    String(input.driver ?? '').trim(),
    String(input.location ?? '').trim(),
    geotabDefectId,
  ).run();

  return { ok: true, id: `repair-${result.meta.last_row_id}` };
}

export async function completeRepair(db: D1Database, idValue: unknown) {
  const match = String(idValue ?? '').match(/^repair-(\d+)$/);
  if (!match) throw new Error('Repair row not found');
  const id = Number(match[1]);
  await db.prepare(`
    UPDATE repairs
    SET status = 'Completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(id).run();
  return { ok: true, id: `repair-${id}` };
}

export async function markDvirRepairedLocal(db: D1Database, defectId: string) {
  await db.prepare(`
    UPDATE dvir_defects
    SET repaired = 1, repair_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE geotab_defect_id = ?
  `).bind(defectId).run();
}

type PartRow = {
  id: number;
  part_number: string;
  description: string;
  quantity_on_hand: number;
  reorder_level: number;
  unit_cost: number | null;
  location: string | null;
  preferred_vendor_id: number | null;
  vendor_name: string | null;
};

type VendorRow = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

export async function getInventoryData(db: D1Database) {
  const [partsResult, vendorsResult] = await Promise.all([
    db.prepare(`
      SELECT p.id, p.part_number, p.description, p.quantity_on_hand, p.reorder_level,
             p.unit_cost, p.location, p.preferred_vendor_id, v.name AS vendor_name
      FROM parts p
      LEFT JOIN vendors v ON v.id = p.preferred_vendor_id
      WHERE p.active = 1
      ORDER BY p.description, p.part_number
    `).all<PartRow>(),
    db.prepare('SELECT id, name, phone, email, notes FROM vendors ORDER BY name').all<VendorRow>(),
  ]);

  const parts = partsResult.results.map((row) => ({
    id: row.id,
    partNumber: row.part_number,
    description: row.description,
    quantityOnHand: Number(row.quantity_on_hand),
    reorderLevel: Number(row.reorder_level),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    location: row.location ?? '',
    preferredVendorId: row.preferred_vendor_id,
    vendorName: row.vendor_name ?? '',
    lowStock: Number(row.quantity_on_hand) <= Number(row.reorder_level),
  }));

  return {
    parts,
    vendors: vendorsResult.results.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone ?? '',
      email: row.email ?? '',
      notes: row.notes ?? '',
    })),
    summary: {
      partCount: parts.length,
      lowStockCount: parts.filter((part) => part.lowStock).length,
      totalUnits: parts.reduce((sum, part) => sum + part.quantityOnHand, 0),
      inventoryValue: parts.reduce((sum, part) => sum + part.quantityOnHand * (part.unitCost ?? 0), 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function savePart(db: D1Database, body: Record<string, unknown>) {
  const partNumber = String(body.partNumber ?? '').trim();
  const description = String(body.description ?? '').trim();
  if (!partNumber || !description) throw new Error('Part number and description are required');
  const id = finiteNumber(body.id, 0);
  const vendorId = finiteNumber(body.preferredVendorId, 0) || null;
  const values = [
    partNumber,
    description,
    finiteNumber(body.quantityOnHand),
    finiteNumber(body.reorderLevel),
    vendorId,
    body.unitCost === '' || body.unitCost == null ? null : finiteNumber(body.unitCost),
    String(body.location ?? '').trim(),
  ] as const;

  if (id > 0) {
    await db.prepare(`
      UPDATE parts
      SET part_number = ?, description = ?, quantity_on_hand = ?, reorder_level = ?,
          preferred_vendor_id = ?, unit_cost = ?, location = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(...values, id).run();
    return { ok: true, id };
  }

  const result = await db.prepare(`
    INSERT INTO parts (part_number, description, quantity_on_hand, reorder_level,
                       preferred_vendor_id, unit_cost, location)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(...values).run();
  return { ok: true, id: result.meta.last_row_id };
}

export async function adjustStock(db: D1Database, body: Record<string, unknown>) {
  const id = finiteNumber(body.id, 0);
  const delta = finiteNumber(body.delta, 0);
  if (!id || !delta) throw new Error('Part and adjustment are required');
  await db.prepare(`
    UPDATE parts
    SET quantity_on_hand = MAX(0, quantity_on_hand + ?), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(delta, id).run();
  return { ok: true, id };
}

export async function saveVendor(db: D1Database, body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new Error('Vendor name is required');
  const id = finiteNumber(body.id, 0);
  const values = [
    name,
    String(body.phone ?? '').trim(),
    String(body.email ?? '').trim(),
    String(body.notes ?? '').trim(),
  ] as const;

  if (id > 0) {
    await db.prepare('UPDATE vendors SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?')
      .bind(...values, id).run();
    return { ok: true, id };
  }

  const result = await db.prepare('INSERT INTO vendors (name, phone, email, notes) VALUES (?, ?, ?, ?)')
    .bind(...values).run();
  return { ok: true, id: result.meta.last_row_id };
}

export async function usePartOnRepair(db: D1Database, body: Record<string, unknown>) {
  const partId = finiteNumber(body.partId, 0);
  const quantity = finiteNumber(body.quantity, 0);
  const repairMatch = String(body.repairId ?? '').match(/^repair-(\d+)$/);
  if (!partId || quantity <= 0 || !repairMatch) throw new Error('Repair, part, and positive quantity are required');
  const repairId = Number(repairMatch[1]);
  const part = await db.prepare('SELECT quantity_on_hand, unit_cost FROM parts WHERE id = ?')
    .bind(partId).first<{ quantity_on_hand: number; unit_cost: number | null }>();
  if (!part || Number(part.quantity_on_hand) < quantity) throw new Error('Not enough stock available');

  await db.batch([
    db.prepare('UPDATE parts SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(quantity, partId),
    db.prepare('INSERT INTO repair_parts (repair_id, part_id, quantity, unit_cost) VALUES (?, ?, ?, ?)')
      .bind(repairId, partId, quantity, part.unit_cost),
  ]);
  return { ok: true, partId, repairId };
}
