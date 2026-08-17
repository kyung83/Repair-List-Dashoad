export type PartAvailability = {
  partId: number;
  partNumber: string;
  description: string;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  physicalOnHand: number;
  reserved: number;
  available: number;
  onOrder: number;
  minimumQuantity: number;
};

export type RepairPartRequestView = {
  id: number;
  repairId: string;
  repairNumericId: number;
  partId: number;
  partNumber: string;
  description: string;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  unit: string;
  technicianId: number | null;
  assignedTo: string;
  priority: string;
  outOfService: boolean;
  requestedQuantity: number;
  reservedQuantity: number;
  usedQuantity: number;
  remainingQuantity: number;
  shortageQuantity: number;
  state: 'awaiting_parts' | 'partially_available' | 'available' | 'used';
  createdAt: string;
  updatedAt: string;
};

type RequestRow = {
  id: number;
  repair_id: number;
  part_id: number;
  warehouse_id: number;
  requested_quantity: number;
  reserved_quantity: number;
  used_quantity: number;
  status: string;
  created_at: string;
  updated_at: string;
};

type StockRow = {
  id: number;
  quantity_on_hand: number;
  unit_cost: number | null;
  on_order: number;
};

type ShopPartLike = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  location: string;
  [key: string]: unknown;
};

type InventoryWarehouseStockLike = {
  id?: number;
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  unitOfMeasure?: string;
  unitCost?: number | null;
  onOrder?: number;
  minimumQuantity?: number | null;
  [key: string]: unknown;
};

type InventoryPartLike = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCost: number | null;
  location: string;
  lowStock: boolean;
  warehouseStocks?: InventoryWarehouseStockLike[];
  [key: string]: unknown;
};

type InventoryDataLike = {
  parts: InventoryPartLike[];
  summary?: {
    partCount: number;
    lowStockCount: number;
    totalUnits: number;
    inventoryValue: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const EPSILON = 0.000001;

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeWarehouseCode(value: unknown) {
  const text = String(value ?? '').trim().toUpperCase();
  for (const code of ['CLARE', 'CADILLAC', 'BOYNE', 'LUDINGTON'] as const) {
    if (text === code || text.includes(code)) return code;
  }
  return '';
}

async function warehouseByCode(db: D1Database, code: string) {
  const normalized = normalizeWarehouseCode(code);
  if (!normalized) return null;
  return db.prepare('SELECT id, code, name FROM warehouses WHERE code = ? AND active = 1')
    .bind(normalized)
    .first<{ id: number; code: string; name: string }>();
}

export async function resolveRepairWarehouse(db: D1Database, repairId: number, fallbackYard = '') {
  const row = await db.prepare(`
    SELECT r.id, r.equipment_id, COALESCE(e.current_yard, '') AS current_yard,
           COALESCE(r.location, '') AS repair_location
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(repairId).first<{
    id: number;
    equipment_id: number | null;
    current_yard: string;
    repair_location: string;
  }>();
  if (!row) throw new Error('Repair was not found.');
  const code = normalizeWarehouseCode(row.equipment_id != null ? row.current_yard : row.repair_location)
    || normalizeWarehouseCode(fallbackYard);
  if (!code) throw new Error('This repair needs a Clare/Cadillac shop location before parts can be requested or used.');
  const warehouse = await warehouseByCode(db, code);
  if (!warehouse) throw new Error(`${code} is not configured as an active parts warehouse.`);
  return warehouse;
}

async function refreshFlatPartTotal(db: D1Database, partId: number) {
  await db.prepare(`
    UPDATE parts
    SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(partId, partId).run();
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
  const text = rows.results.map((row) => `${row.part_number} x${Number(row.quantity)}`).join(', ');
  await db.prepare('UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(text, repairId).run();
}

async function lifecycleEvent(
  db: D1Database,
  input: {
    partId: number;
    repairId?: number | null;
    warehouseId?: number | null;
    fromWarehouseId?: number | null;
    toWarehouseId?: number | null;
    userId?: number | null;
    eventType: string;
    quantity?: number;
    detail?: string;
  },
) {
  await db.prepare(`
    INSERT INTO part_lifecycle_events
      (part_id, repair_id, warehouse_id, from_warehouse_id, to_warehouse_id, user_id, event_type, quantity, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.partId,
    input.repairId ?? null,
    input.warehouseId ?? null,
    input.fromWarehouseId ?? null,
    input.toWarehouseId ?? null,
    input.userId ?? null,
    input.eventType,
    finite(input.quantity),
    String(input.detail ?? '').slice(0, 500),
  ).run();
}

export async function getPartAvailability(db: D1Database): Promise<PartAvailability[]> {
  const rows = await db.prepare(`
    WITH keys AS (
      SELECT part_id, warehouse_id FROM part_warehouse_stock
      UNION
      SELECT part_id, warehouse_id FROM repair_part_requests WHERE status = 'open'
      UNION
      SELECT part_id, warehouse_id FROM part_warehouse_minimums
    )
    SELECT k.part_id, p.part_number, p.description,
           w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
           COALESCE((SELECT SUM(s.quantity_on_hand) FROM part_warehouse_stock s
                     WHERE s.part_id = k.part_id AND s.warehouse_id = k.warehouse_id), 0) AS physical_on_hand,
           COALESCE((SELECT SUM(s.on_order) FROM part_warehouse_stock s
                     WHERE s.part_id = k.part_id AND s.warehouse_id = k.warehouse_id), 0) AS on_order,
           COALESCE((SELECT SUM(q.reserved_quantity) FROM repair_part_requests q
                     WHERE q.part_id = k.part_id AND q.warehouse_id = k.warehouse_id AND q.status = 'open'), 0) AS reserved,
           COALESCE(m.minimum_quantity, p.reorder_level, 0) AS minimum_quantity
    FROM keys k
    JOIN parts p ON p.id = k.part_id AND p.active = 1
    JOIN warehouses w ON w.id = k.warehouse_id AND w.active = 1
    LEFT JOIN part_warehouse_minimums m ON m.part_id = k.part_id AND m.warehouse_id = k.warehouse_id
    ORDER BY p.description, p.part_number, w.name
  `).all<{
    part_id: number;
    part_number: string;
    description: string;
    warehouse_id: number;
    warehouse_code: string;
    warehouse_name: string;
    physical_on_hand: number;
    on_order: number;
    reserved: number;
    minimum_quantity: number;
  }>();

  return rows.results.map((row) => {
    const physicalOnHand = finite(row.physical_on_hand);
    const reserved = finite(row.reserved);
    return {
      partId: Number(row.part_id),
      partNumber: row.part_number,
      description: row.description,
      warehouseId: Number(row.warehouse_id),
      warehouseCode: row.warehouse_code,
      warehouseName: row.warehouse_name,
      physicalOnHand,
      reserved,
      available: physicalOnHand - reserved,
      onOrder: finite(row.on_order),
      minimumQuantity: finite(row.minimum_quantity),
    };
  });
}

export async function decorateShopParts(db: D1Database, parts: ShopPartLike[]) {
  const availability = await getPartAvailability(db);
  const byPart = new Map<number, PartAvailability[]>();
  for (const row of availability) {
    const list = byPart.get(row.partId) ?? [];
    list.push(row);
    byPart.set(row.partId, list);
  }
  return parts.map((part) => {
    const rows = byPart.get(Number(part.id)) ?? [];
    const physicalOnHand = rows.reduce((sum, row) => sum + row.physicalOnHand, 0);
    const reserved = rows.reduce((sum, row) => sum + row.reserved, 0);
    const available = physicalOnHand - reserved;
    return {
      ...part,
      quantityOnHand: available,
      physicalOnHand,
      reserved,
      available,
      onOrder: rows.reduce((sum, row) => sum + row.onOrder, 0),
      warehouseStocks: rows.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        warehouseName: row.warehouseName,
        quantityOnHand: row.available,
        physicalOnHand: row.physicalOnHand,
        reserved: row.reserved,
        available: row.available,
        onOrder: row.onOrder,
        minimumQuantity: row.minimumQuantity,
      })),
    };
  });
}

export async function decorateInventoryData(db: D1Database, data: InventoryDataLike) {
  const availability = await getPartAvailability(db);
  const byPart = new Map<number, PartAvailability[]>();
  for (const row of availability) {
    const list = byPart.get(row.partId) ?? [];
    list.push(row);
    byPart.set(row.partId, list);
  }

  const parts = data.parts.map((part) => {
    const rows = byPart.get(Number(part.id)) ?? [];
    const originals = part.warehouseStocks ?? [];
    const physicalOnHand = rows.reduce((sum, row) => sum + row.physicalOnHand, 0);
    const reserved = rows.reduce((sum, row) => sum + row.reserved, 0);
    const available = physicalOnHand - reserved;
    const warehouseStocks = rows.map((row) => {
      const original = originals.find((item) => item.warehouseCode === row.warehouseCode);
      return {
        ...(original ?? {}),
        warehouseCode: row.warehouseCode,
        warehouseName: row.warehouseName,
        quantityOnHand: row.available,
        physicalOnHand: row.physicalOnHand,
        reserved: row.reserved,
        available: row.available,
        onOrder: row.onOrder,
        minimumQuantity: row.minimumQuantity,
      };
    });
    const lowStock = rows.length
      ? rows.some((row) => row.available <= row.minimumQuantity)
      : part.quantityOnHand <= part.reorderLevel;
    return {
      ...part,
      quantityOnHand: rows.length ? available : part.quantityOnHand,
      physicalOnHand: rows.length ? physicalOnHand : part.quantityOnHand,
      reserved,
      available: rows.length ? available : part.quantityOnHand,
      onOrder: rows.reduce((sum, row) => sum + row.onOrder, 0),
      warehouseStocks,
      lowStock,
    };
  });

  const summary = data.summary ? {
    ...data.summary,
    lowStockCount: parts.filter((part) => part.lowStock).length,
    totalUnits: parts.reduce((sum, part) => sum + finite(part.quantityOnHand), 0),
    physicalUnits: parts.reduce((sum, part) => sum + finite(part.physicalOnHand), 0),
    reservedUnits: parts.reduce((sum, part) => sum + finite(part.reserved), 0),
  } : undefined;

  return { ...data, parts, ...(summary ? { summary } : {}) };
}

async function loadRequest(db: D1Database, requestId: number) {
  return db.prepare(`
    SELECT id, repair_id, part_id, warehouse_id, requested_quantity, reserved_quantity,
           used_quantity, status, created_at, updated_at
    FROM repair_part_requests WHERE id = ?
  `).bind(requestId).first<RequestRow>();
}

async function allocateRequest(db: D1Database, requestId: number) {
  const before = await loadRequest(db, requestId);
  if (!before || before.status !== 'open') return { request: before, allocated: 0 };
  await db.prepare(`
    UPDATE repair_part_requests
    SET reserved_quantity = reserved_quantity + MAX(0, MIN(
          requested_quantity - used_quantity - reserved_quantity,
          (SELECT COALESCE(SUM(s.quantity_on_hand), 0)
             FROM part_warehouse_stock s
            WHERE s.part_id = repair_part_requests.part_id
              AND s.warehouse_id = repair_part_requests.warehouse_id)
          -
          (SELECT COALESCE(SUM(q.reserved_quantity), 0)
             FROM repair_part_requests q
            WHERE q.part_id = repair_part_requests.part_id
              AND q.warehouse_id = repair_part_requests.warehouse_id
              AND q.status = 'open')
        )),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'open'
  `).bind(requestId).run();
  const after = await loadRequest(db, requestId);
  return {
    request: after,
    allocated: Math.max(0, finite(after?.reserved_quantity) - finite(before.reserved_quantity)),
  };
}

export async function allocateWaitingForPart(
  db: D1Database,
  partId: number,
  warehouseId: number,
  userId: number | null = null,
) {
  const queue = await db.prepare(`
    SELECT q.id
    FROM repair_part_requests q
    JOIN repairs r ON r.id = q.repair_id
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE q.part_id = ? AND q.warehouse_id = ? AND q.status = 'open'
      AND q.requested_quantity > q.used_quantity + q.reserved_quantity
      AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
    ORDER BY COALESCE(e.out_of_service, 0) DESC,
             CASE trim(COALESCE(r.priority, '2'))
               WHEN '1' THEN 0
               WHEN '2' THEN 1
               WHEN '3' THEN 2
               ELSE 1
             END,
             q.created_at ASC, q.id ASC
  `).bind(partId, warehouseId).all<{ id: number }>();

  const allocations: { requestId: number; quantity: number }[] = [];
  for (const row of queue.results) {
    const allocation = await allocateRequest(db, Number(row.id));
    if (allocation.allocated > EPSILON && allocation.request) {
      allocations.push({ requestId: Number(row.id), quantity: allocation.allocated });
      await lifecycleEvent(db, {
        partId,
        repairId: Number(allocation.request.repair_id),
        warehouseId,
        userId,
        eventType: 'reserved',
        quantity: allocation.allocated,
        detail: 'Stock reserved automatically for waiting repair.',
      });
    }
  }
  return allocations;
}

async function stockRows(db: D1Database, partId: number, warehouseId: number) {
  const rows = await db.prepare(`
    SELECT id, quantity_on_hand, unit_cost, on_order
    FROM part_warehouse_stock
    WHERE part_id = ? AND warehouse_id = ?
    ORDER BY quantity_on_hand DESC, id ASC
  `).bind(partId, warehouseId).all<StockRow>();
  return rows.results;
}

async function preferredOrCreateStockRow(db: D1Database, partId: number, warehouseId: number) {
  const existing = await db.prepare(`
    SELECT id, quantity_on_hand, unit_cost, on_order
    FROM part_warehouse_stock
    WHERE part_id = ? AND warehouse_id = ?
    ORDER BY CASE WHEN variant_key = '' THEN 0 ELSE 1 END, quantity_on_hand DESC, id
    LIMIT 1
  `).bind(partId, warehouseId).first<StockRow>();
  if (existing) return existing;
  await db.prepare(`
    INSERT INTO part_warehouse_stock
      (part_id, warehouse_id, variant_key, quantity_on_hand, on_order, source_updated_at)
    VALUES (?, ?, 'repair-lifecycle', 0, 0, NULL)
  `).bind(partId, warehouseId).run();
  const created = await db.prepare(`
    SELECT id, quantity_on_hand, unit_cost, on_order
    FROM part_warehouse_stock
    WHERE part_id = ? AND warehouse_id = ? AND variant_key = 'repair-lifecycle'
    LIMIT 1
  `).bind(partId, warehouseId).first<StockRow>();
  if (!created) throw new Error('Warehouse stock row could not be created.');
  return created;
}

export async function consumeReservedPart(
  db: D1Database,
  input: { requestId: number; quantity?: number; userId?: number | null },
) {
  const request = await loadRequest(db, input.requestId);
  if (!request || request.status !== 'open') throw new Error('Part request was not found or is already closed.');
  const useQuantity = Math.min(
    input.quantity == null ? finite(request.reserved_quantity) : finite(input.quantity),
    finite(request.reserved_quantity),
    Math.max(0, finite(request.requested_quantity) - finite(request.used_quantity)),
  );
  if (useQuantity <= EPSILON) throw new Error('No reserved quantity is ready to use on this repair yet.');

  const rows = await stockRows(db, request.part_id, request.warehouse_id);
  const physical = rows.reduce((sum, row) => sum + Math.max(0, finite(row.quantity_on_hand)), 0);
  if (physical + EPSILON < useQuantity) {
    throw new Error('Physical stock changed after this part was reserved. Parts Desk needs to reconcile the warehouse count.');
  }
  const part = await db.prepare('SELECT unit_cost FROM parts WHERE id = ?')
    .bind(request.part_id).first<{ unit_cost: number | null }>();
  if (!part) throw new Error('Part was not found.');

  let remaining = useQuantity;
  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    if (remaining <= EPSILON) break;
    const take = Math.min(remaining, Math.max(0, finite(row.quantity_on_hand)));
    if (take <= EPSILON) continue;
    statements.push(
      db.prepare(`UPDATE part_warehouse_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(take, row.id),
      db.prepare(`INSERT INTO repair_parts (repair_id, part_id, quantity, unit_cost, warehouse_stock_id) VALUES (?, ?, ?, ?, ?)`)
        .bind(request.repair_id, request.part_id, take, row.unit_cost ?? part.unit_cost, row.id),
    );
    remaining -= take;
  }
  statements.push(
    db.prepare(`
      UPDATE repair_part_requests
      SET reserved_quantity = MAX(0, reserved_quantity - ?),
          used_quantity = used_quantity + ?,
          status = CASE WHEN used_quantity + ? >= requested_quantity - 0.000001 THEN 'closed' ELSE status END,
          closed_at = CASE WHEN used_quantity + ? >= requested_quantity - 0.000001 THEN CURRENT_TIMESTAMP ELSE closed_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'
    `).bind(useQuantity, useQuantity, useQuantity, useQuantity, request.id),
    db.prepare(`
      UPDATE repair_planned_parts
      SET used_quantity = MIN(quantity, used_quantity + ?), updated_at = CURRENT_TIMESTAMP
      WHERE repair_id = ? AND part_id = ? AND removed_at IS NULL
    `).bind(useQuantity, request.repair_id, request.part_id),
  );
  await db.batch(statements);
  await refreshFlatPartTotal(db, request.part_id);
  await refreshRepairPartsText(db, request.repair_id);
  await lifecycleEvent(db, {
    partId: request.part_id,
    repairId: request.repair_id,
    warehouseId: request.warehouse_id,
    userId: input.userId ?? null,
    eventType: 'used',
    quantity: useQuantity,
    detail: 'Reserved stock was physically used on the repair.',
  });
  return { ok: true, requestId: request.id, repairId: request.repair_id, partId: request.part_id, quantity: useQuantity };
}

export async function requestPartForRepair(
  db: D1Database,
  input: {
    repairId: number;
    partId: number;
    quantity: number;
    warehouseCode?: string;
    fallbackYard?: string;
    userId?: number | null;
  },
) {
  const quantity = finite(input.quantity);
  if (!Number.isInteger(input.partId) || input.partId <= 0 || quantity <= 0) {
    throw new Error('Choose a part and enter a positive quantity.');
  }
  const repair = await db.prepare(`
    SELECT id, COALESCE(status, '') AS status FROM repairs WHERE id = ?
  `).bind(input.repairId).first<{ id: number; status: string }>();
  if (!repair) throw new Error('Repair was not found.');
  if (String(repair.status).toLowerCase().includes('complete')) throw new Error('Completed repairs cannot request parts.');
  const part = await db.prepare('SELECT id, part_number, description FROM parts WHERE id = ? AND active = 1')
    .bind(input.partId).first<{ id: number; part_number: string; description: string }>();
  if (!part) throw new Error('Part was not found.');

  const warehouse = input.warehouseCode
    ? await warehouseByCode(db, input.warehouseCode)
    : await resolveRepairWarehouse(db, input.repairId, input.fallbackYard ?? '');
  if (!warehouse) throw new Error('The repair warehouse could not be determined.');

  const before = await db.prepare(`
    SELECT id, requested_quantity, reserved_quantity, used_quantity
    FROM repair_part_requests
    WHERE repair_id = ? AND part_id = ? AND warehouse_id = ?
  `).bind(input.repairId, input.partId, warehouse.id).first<{
    id: number;
    requested_quantity: number;
    reserved_quantity: number;
    used_quantity: number;
  }>();

  await db.prepare(`
    INSERT INTO repair_part_requests
      (repair_id, part_id, warehouse_id, requested_quantity, requested_by_user_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(repair_id, part_id, warehouse_id) DO UPDATE SET
      requested_quantity = repair_part_requests.requested_quantity + excluded.requested_quantity,
      status = 'open', closed_at = NULL, updated_at = CURRENT_TIMESTAMP
  `).bind(input.repairId, input.partId, warehouse.id, quantity, input.userId ?? null).run();

  const current = await db.prepare(`
    SELECT id FROM repair_part_requests WHERE repair_id = ? AND part_id = ? AND warehouse_id = ?
  `).bind(input.repairId, input.partId, warehouse.id).first<{ id: number }>();
  if (!current) throw new Error('Part request could not be saved.');

  await lifecycleEvent(db, {
    partId: input.partId,
    repairId: input.repairId,
    warehouseId: warehouse.id,
    userId: input.userId ?? null,
    eventType: 'requested',
    quantity,
    detail: `${quantity} x ${part.part_number} requested for ${warehouse.code}.`,
  });

  const allocation = await allocateRequest(db, current.id);
  if (allocation.allocated > EPSILON && allocation.request) {
    await lifecycleEvent(db, {
      partId: input.partId,
      repairId: input.repairId,
      warehouseId: warehouse.id,
      userId: input.userId ?? null,
      eventType: 'reserved',
      quantity: allocation.allocated,
      detail: 'Available yard stock reserved for this repair.',
    });
  }

  const newlyReserved = finite(allocation.request?.reserved_quantity) - finite(before?.reserved_quantity);
  let usedImmediately = 0;
  if (newlyReserved + EPSILON >= quantity) {
    const used = await consumeReservedPart(db, { requestId: current.id, quantity, userId: input.userId ?? null });
    usedImmediately = used.quantity;
  }

  const after = await loadRequest(db, current.id);
  if (!after) throw new Error('Part request could not be reloaded.');
  const remainingQuantity = Math.max(0, finite(after.requested_quantity) - finite(after.used_quantity));
  const reservedQuantity = Math.min(remainingQuantity, finite(after.reserved_quantity));
  const shortageQuantity = Math.max(0, remainingQuantity - reservedQuantity);

  return {
    ok: true,
    requestId: current.id,
    repairId: input.repairId,
    partId: input.partId,
    partNumber: part.part_number,
    warehouseCode: warehouse.code,
    requestedQuantity: quantity,
    usedImmediately,
    reservedQuantity,
    shortageQuantity,
    awaitingParts: shortageQuantity > EPSILON,
    partiallyAvailable: reservedQuantity > EPSILON && shortageQuantity > EPSILON,
  };
}

function requestState(requested: number, reserved: number, used: number): RepairPartRequestView['state'] {
  const remaining = Math.max(0, requested - used);
  if (remaining <= EPSILON) return 'used';
  if (reserved + EPSILON >= remaining) return 'available';
  if (reserved > EPSILON) return 'partially_available';
  return 'awaiting_parts';
}

export async function getRepairPartRequests(db: D1Database): Promise<RepairPartRequestView[]> {
  const rows = await db.prepare(`
    SELECT q.id, q.repair_id, q.part_id, q.warehouse_id, q.requested_quantity,
           q.reserved_quantity, q.used_quantity, q.created_at, q.updated_at,
           p.part_number, p.description, w.code AS warehouse_code, w.name AS warehouse_name,
           COALESCE(e.unit, '') AS unit, r.technician_id,
           COALESCE(t.name, '') AS technician_name, COALESCE(r.priority, '2') AS priority,
           COALESCE(e.out_of_service, 0) AS out_of_service
    FROM repair_part_requests q
    JOIN repairs r ON r.id = q.repair_id
    JOIN parts p ON p.id = q.part_id
    JOIN warehouses w ON w.id = q.warehouse_id
    LEFT JOIN equipment e ON e.id = r.equipment_id
    LEFT JOIN technicians t ON t.id = r.technician_id
    WHERE q.status = 'open' AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
    ORDER BY COALESCE(e.out_of_service, 0) DESC,
             CASE trim(COALESCE(r.priority, '2')) WHEN '1' THEN 0 WHEN '2' THEN 1 WHEN '3' THEN 2 ELSE 1 END,
             q.created_at ASC, q.id ASC
  `).all<{
    id: number;
    repair_id: number;
    part_id: number;
    warehouse_id: number;
    requested_quantity: number;
    reserved_quantity: number;
    used_quantity: number;
    created_at: string;
    updated_at: string;
    part_number: string;
    description: string;
    warehouse_code: string;
    warehouse_name: string;
    unit: string;
    technician_id: number | null;
    technician_name: string;
    priority: string;
    out_of_service: number;
  }>();

  return rows.results.map((row) => {
    const requestedQuantity = finite(row.requested_quantity);
    const usedQuantity = finite(row.used_quantity);
    const remainingQuantity = Math.max(0, requestedQuantity - usedQuantity);
    const reservedQuantity = Math.min(remainingQuantity, finite(row.reserved_quantity));
    return {
      id: Number(row.id),
      repairId: `repair-${row.repair_id}`,
      repairNumericId: Number(row.repair_id),
      partId: Number(row.part_id),
      partNumber: row.part_number,
      description: row.description,
      warehouseId: Number(row.warehouse_id),
      warehouseCode: row.warehouse_code,
      warehouseName: row.warehouse_name,
      unit: row.unit,
      technicianId: row.technician_id == null ? null : Number(row.technician_id),
      assignedTo: row.technician_name,
      priority: row.priority,
      outOfService: Boolean(row.out_of_service),
      requestedQuantity,
      reservedQuantity,
      usedQuantity,
      remainingQuantity,
      shortageQuantity: Math.max(0, remainingQuantity - reservedQuantity),
      state: requestState(requestedQuantity, reservedQuantity, usedQuantity),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function releaseRepairPartRequests(db: D1Database, repairId: number, userId: number | null = null) {
  const requests = await db.prepare(`
    SELECT id, part_id, warehouse_id, reserved_quantity
    FROM repair_part_requests WHERE repair_id = ? AND status = 'open'
  `).bind(repairId).all<{ id: number; part_id: number; warehouse_id: number; reserved_quantity: number }>();
  if (!requests.results.length) return { released: 0 };

  await db.prepare(`
    UPDATE repair_part_requests
    SET reserved_quantity = 0, status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE repair_id = ? AND status = 'open'
  `).bind(repairId).run();

  let released = 0;
  const keys = new Set<string>();
  for (const row of requests.results) {
    const quantity = Math.max(0, finite(row.reserved_quantity));
    released += quantity;
    keys.add(`${row.part_id}:${row.warehouse_id}`);
    if (quantity > EPSILON) {
      await lifecycleEvent(db, {
        partId: Number(row.part_id), repairId, warehouseId: Number(row.warehouse_id), userId,
        eventType: 'reservation_released', quantity,
        detail: 'Unused reserved quantity released when the repair closed.',
      });
    }
  }
  for (const key of keys) {
    const [partId, warehouseId] = key.split(':').map(Number);
    await allocateWaitingForPart(db, partId, warehouseId, userId);
  }
  return { released };
}

export async function orderPartForWarehouse(
  db: D1Database,
  input: { partId: number; warehouseCode: string; quantity: number; userId?: number | null },
) {
  const quantity = finite(input.quantity);
  if (!Number.isInteger(input.partId) || input.partId <= 0 || quantity <= 0) throw new Error('Part and positive order quantity are required.');
  const warehouse = await warehouseByCode(db, input.warehouseCode);
  if (!warehouse) throw new Error('Warehouse was not found.');
  const stock = await preferredOrCreateStockRow(db, input.partId, warehouse.id);
  await db.prepare('UPDATE part_warehouse_stock SET on_order = on_order + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(quantity, stock.id).run();
  await lifecycleEvent(db, {
    partId: input.partId, warehouseId: warehouse.id, userId: input.userId ?? null,
    eventType: 'ordered', quantity, detail: `${quantity} units marked on order for ${warehouse.code}.`,
  });
  return { ok: true, partId: input.partId, warehouseCode: warehouse.code, quantity };
}

export async function receivePartForWarehouse(
  db: D1Database,
  input: { partId: number; warehouseCode: string; quantity: number; userId?: number | null },
) {
  const quantity = finite(input.quantity);
  if (!Number.isInteger(input.partId) || input.partId <= 0 || quantity <= 0) throw new Error('Part and positive received quantity are required.');
  const warehouse = await warehouseByCode(db, input.warehouseCode);
  if (!warehouse) throw new Error('Warehouse was not found.');
  const target = await preferredOrCreateStockRow(db, input.partId, warehouse.id);
  const rows = await stockRows(db, input.partId, warehouse.id);
  let orderRemaining = quantity;
  const statements: D1PreparedStatement[] = [
    db.prepare('UPDATE part_warehouse_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(quantity, target.id),
  ];
  for (const row of rows.filter((row) => finite(row.on_order) > EPSILON)) {
    if (orderRemaining <= EPSILON) break;
    const reduce = Math.min(orderRemaining, finite(row.on_order));
    statements.push(
      db.prepare('UPDATE part_warehouse_stock SET on_order = MAX(0, on_order - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(reduce, row.id),
    );
    orderRemaining -= reduce;
  }
  await db.batch(statements);
  await refreshFlatPartTotal(db, input.partId);
  await lifecycleEvent(db, {
    partId: input.partId, warehouseId: warehouse.id, userId: input.userId ?? null,
    eventType: 'received', quantity, detail: `${quantity} units received into ${warehouse.code}.`,
  });
  const allocations = await allocateWaitingForPart(db, input.partId, warehouse.id, input.userId ?? null);
  return { ok: true, partId: input.partId, warehouseCode: warehouse.code, quantity, allocations };
}

export async function getPartsDeskData(db: D1Database) {
  const [availability, requests] = await Promise.all([getPartAvailability(db), getRepairPartRequests(db)]);
  const availabilityByKey = new Map(availability.map((row) => [`${row.partId}:${row.warehouseId}`, row]));
  const groups = new Map<string, {
    partId: number;
    partNumber: string;
    description: string;
    warehouseId: number;
    warehouseCode: string;
    warehouseName: string;
    requested: number;
    reserved: number;
    used: number;
    shortage: number;
    waitingJobs: RepairPartRequestView[];
  }>();
  for (const request of requests) {
    const key = `${request.partId}:${request.warehouseId}`;
    const group = groups.get(key) ?? {
      partId: request.partId,
      partNumber: request.partNumber,
      description: request.description,
      warehouseId: request.warehouseId,
      warehouseCode: request.warehouseCode,
      warehouseName: request.warehouseName,
      requested: 0, reserved: 0, used: 0, shortage: 0, waitingJobs: [],
    };
    group.requested += request.requestedQuantity;
    group.reserved += request.reservedQuantity;
    group.used += request.usedQuantity;
    group.shortage += request.shortageQuantity;
    group.waitingJobs.push(request);
    groups.set(key, group);
  }

  const jobShortages = [...groups.values()]
    .filter((group) => group.shortage > EPSILON)
    .map((group) => ({ ...group, stock: availabilityByKey.get(`${group.partId}:${group.warehouseId}`) ?? null }))
    .sort((a, b) => {
      const aTop = a.waitingJobs[0];
      const bTop = b.waitingJobs[0];
      return Number(Boolean(bTop?.outOfService)) - Number(Boolean(aTop?.outOfService))
        || (aTop?.priority === '1' ? 0 : aTop?.priority === '3' ? 2 : 1) - (bTop?.priority === '1' ? 0 : bTop?.priority === '3' ? 2 : 1)
        || String(aTop?.createdAt ?? '').localeCompare(String(bTop?.createdAt ?? ''));
    });

  const lowStock = availability
    .filter((row) => row.minimumQuantity > 0 && row.available <= row.minimumQuantity)
    .map((row) => ({
      ...row,
      reorderSuggested: Math.max(0, row.minimumQuantity - row.available - row.onOrder),
    }))
    .sort((a, b) => a.available - a.minimumQuantity - (b.available - b.minimumQuantity) || a.partNumber.localeCompare(b.partNumber));

  return {
    jobShortages,
    requests,
    lowStock,
    availability,
    summary: {
      shortageLines: jobShortages.length,
      waitingJobs: requests.filter((request) => request.shortageQuantity > EPSILON).length,
      readyJobs: requests.filter((request) => request.reservedQuantity > EPSILON).length,
      lowStockLines: lowStock.length,
    },
    updatedAt: new Date().toISOString(),
  };
}
