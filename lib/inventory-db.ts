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

type WarehouseStockRow = {
  id: number;
  part_id: number;
  warehouse_code: string;
  warehouse_name: string;
  quantity_on_hand: number;
  unit_of_measure: string | null;
  unit_cost: number | null;
  on_order: number;
};

type WarehouseRow = { code: string; name: string };

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function getInventoryData(db: D1Database) {
  const [partsResult, vendorsResult, stockResult, warehousesResult] = await Promise.all([
    db.prepare(`
      SELECT p.id, p.part_number, p.description, p.quantity_on_hand, p.reorder_level,
             p.unit_cost, p.location, p.preferred_vendor_id, v.name AS vendor_name
      FROM parts p
      LEFT JOIN vendors v ON v.id = p.preferred_vendor_id
      WHERE p.active = 1
      ORDER BY p.description, p.part_number
    `).all<PartRow>(),
    db.prepare('SELECT id, name, phone, email, notes FROM vendors WHERE COALESCE(active, 1) = 1 ORDER BY name').all<VendorRow>(),
    db.prepare(`
      SELECT s.id, s.part_id, w.code AS warehouse_code, w.name AS warehouse_name,
             s.quantity_on_hand, s.unit_of_measure, s.unit_cost, s.on_order
      FROM part_warehouse_stock s
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE w.active = 1
      ORDER BY s.part_id, w.name, s.variant_key
    `).all<WarehouseStockRow>(),
    db.prepare('SELECT code, name FROM warehouses WHERE active = 1 ORDER BY name').all<WarehouseRow>(),
  ]);

  const stockByPart = new Map<number, WarehouseStockRow[]>();
  for (const stock of stockResult.results) {
    const list = stockByPart.get(stock.part_id) ?? [];
    list.push(stock);
    stockByPart.set(stock.part_id, list);
  }

  const parts = partsResult.results.map((row) => {
    const rows = stockByPart.get(row.id) ?? [];
    const warehouseStocks = rows.map((stock) => ({
      id: stock.id,
      warehouseCode: stock.warehouse_code,
      warehouseName: stock.warehouse_name,
      quantityOnHand: Number(stock.quantity_on_hand),
      unitOfMeasure: stock.unit_of_measure ?? '',
      unitCost: stock.unit_cost == null ? null : Number(stock.unit_cost),
      onOrder: Number(stock.on_order),
    }));
    const quantityOnHand = rows.length
      ? rows.reduce((sum, stock) => sum + Number(stock.quantity_on_hand), 0)
      : Number(row.quantity_on_hand);
    const location = rows.length
      ? warehouseStocks
          .filter((stock) => stock.quantityOnHand !== 0 || stock.onOrder !== 0)
          .map((stock) => `${stock.warehouseName}: ${stock.quantityOnHand}${stock.unitOfMeasure ? ` ${stock.unitOfMeasure}` : ''}`)
          .join(' | ')
      : (row.location ?? '');

    return {
      id: row.id,
      partNumber: row.part_number,
      description: row.description,
      quantityOnHand,
      reorderLevel: Number(row.reorder_level),
      unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
      location,
      preferredVendorId: row.preferred_vendor_id,
      vendorName: row.vendor_name ?? '',
      warehouseStocks,
      lowStock: quantityOnHand <= Number(row.reorder_level),
    };
  });

  return {
    parts,
    warehouses: warehousesResult.results.map((row) => ({ code: row.code, name: row.name })),
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

async function preferredStockRow(db: D1Database, partId: number, warehouseCode: string, minimum = 0) {
  return db.prepare(`
    SELECT s.id, s.quantity_on_hand, s.unit_cost, w.code AS warehouse_code
    FROM part_warehouse_stock s
    JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.part_id = ?
      AND (? = '' OR w.code = ?)
      AND s.quantity_on_hand >= ?
    ORDER BY s.quantity_on_hand DESC, CASE w.code WHEN 'CLARE' THEN 0 ELSE 1 END, s.id
    LIMIT 1
  `).bind(partId, warehouseCode, warehouseCode, minimum).first<{
    id: number;
    quantity_on_hand: number;
    unit_cost: number | null;
    warehouse_code: string;
  }>();
}

async function refreshFlatPartTotal(db: D1Database, partId: number) {
  await db.prepare(`
    UPDATE parts
    SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(partId, partId).run();
}

export async function adjustStock(db: D1Database, body: Record<string, unknown>) {
  const id = finiteNumber(body.id, 0);
  const delta = finiteNumber(body.delta, 0);
  const warehouseCode = String(body.warehouseCode ?? '').trim().toUpperCase();
  if (!id || !delta) throw new Error('Part and adjustment are required');

  let stock = await preferredStockRow(db, id, warehouseCode, delta < 0 ? Math.abs(delta) : 0);
  if (!stock && warehouseCode) throw new Error(`No available stock found in ${warehouseCode}.`);

  if (!stock) {
    stock = await preferredStockRow(db, id, '', delta < 0 ? Math.abs(delta) : 0);
  }

  if (!stock && delta > 0) {
    const code = warehouseCode || 'NO_WAREHOUSE';
    await db.prepare(`
      INSERT INTO part_warehouse_stock (part_id, warehouse_id, variant_key, quantity_on_hand, source_updated_at)
      VALUES (?, (SELECT id FROM warehouses WHERE code = ?), 'manual-adjustment', ?, NULL)
      ON CONFLICT(part_id, warehouse_id, variant_key) DO UPDATE SET
        quantity_on_hand = quantity_on_hand + excluded.quantity_on_hand,
        updated_at = CURRENT_TIMESTAMP
    `).bind(id, code, delta).run();
    await refreshFlatPartTotal(db, id);
    return { ok: true, id, warehouseCode: code };
  }

  if (!stock) throw new Error('Not enough stock available');
  await db.prepare(`
    UPDATE part_warehouse_stock
    SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(delta, stock.id).run();
  await refreshFlatPartTotal(db, id);
  return { ok: true, id, warehouseCode: stock.warehouse_code };
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
  const warehouseCode = String(body.warehouseCode ?? '').trim().toUpperCase();
  const repairMatch = String(body.repairId ?? '').match(/^repair-(\d+)$/);
  if (!partId || quantity <= 0 || !repairMatch) throw new Error('Repair, part, and positive quantity are required');
  const repairId = Number(repairMatch[1]);
  const part = await db.prepare('SELECT unit_cost FROM parts WHERE id = ?')
    .bind(partId).first<{ unit_cost: number | null }>();
  if (!part) throw new Error('Part not found');

  const stock = await preferredStockRow(db, partId, warehouseCode, quantity);
  if (!stock) throw new Error(warehouseCode ? `Not enough stock available in ${warehouseCode}.` : 'Not enough stock available');

  await db.batch([
    db.prepare(`
      UPDATE part_warehouse_stock
      SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND quantity_on_hand >= ?
    `).bind(quantity, stock.id, quantity),
    db.prepare('INSERT INTO repair_parts (repair_id, part_id, quantity, unit_cost, warehouse_stock_id) VALUES (?, ?, ?, ?, ?)')
      .bind(repairId, partId, quantity, stock.unit_cost ?? part.unit_cost, stock.id),
    db.prepare(`
      UPDATE parts
      SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(partId, partId),
  ]);

  return { ok: true, partId, repairId, warehouseCode: stock.warehouse_code };
}


export async function removePartFromRepair(db: D1Database, body: Record<string, unknown>) {
  const usageId = finiteNumber(body.usageId, 0);
  if (!usageId) throw new Error('Attached part row is required');

  const usage = await db.prepare(`
    SELECT id, repair_id, part_id, quantity, warehouse_stock_id
    FROM repair_parts
    WHERE id = ?
  `).bind(usageId).first<{
    id: number;
    repair_id: number;
    part_id: number;
    quantity: number;
    warehouse_stock_id: number | null;
  }>();
  if (!usage) throw new Error('Attached part was not found');

  const requestedRepair = String(body.repairId ?? '').match(/^repair-(\d+)$/);
  if (requestedRepair && Number(requestedRepair[1]) !== usage.repair_id) throw new Error('Attached part does not belong to this repair');
  if (usage.warehouse_stock_id == null) {
    throw new Error('This older attachment does not record its source warehouse, so it cannot be safely returned automatically.');
  }

  await db.batch([
    db.prepare(`
      UPDATE part_warehouse_stock
      SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND part_id = ?
    `).bind(Number(usage.quantity), usage.warehouse_stock_id, usage.part_id),
    db.prepare('DELETE FROM repair_parts WHERE id = ?').bind(usage.id),
    db.prepare(`
      UPDATE parts
      SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(usage.part_id, usage.part_id),
  ]);

  return { ok: true, usageId: usage.id, repairId: usage.repair_id, partId: usage.part_id };
}
