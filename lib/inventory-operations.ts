const EPSILON = 0.000001;

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value: unknown, label: string) {
  const number = finite(value);
  if (number <= EPSILON) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function cleanKey(value: unknown) {
  return String(value ?? '').trim().slice(0, 160);
}

export function normalizeVendorName(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Repair was not found.');
  return id;
}

async function operationByKey(db: D1Database, operationKey: string) {
  return db.prepare(`
    SELECT o.id,o.operation_key,o.operation_type,o.status,o.repair_id,o.created_at,
           l.part_id,l.warehouse_stock_id,l.warehouse_id,l.repair_part_id,l.quantity_delta,l.unit_cost
    FROM inventory_operations o
    LEFT JOIN inventory_operation_lines l ON l.operation_id = o.id
    WHERE o.operation_key = ?
    ORDER BY l.id LIMIT 1
  `).bind(operationKey).first<{
    id:number; operation_key:string; operation_type:string; status:string; repair_id:number|null; created_at:string;
    part_id:number|null; warehouse_stock_id:number|null; warehouse_id:number|null; repair_part_id:number|null;
    quantity_delta:number|null; unit_cost:number|null;
  }>();
}

async function latestStockOperation(db: D1Database, stockId: number) {
  return db.prepare(`
    SELECT o.id
    FROM inventory_operation_lines l
    JOIN inventory_operations o ON o.id = l.operation_id
    WHERE l.warehouse_stock_id = ? AND o.status = 'applied'
    ORDER BY l.id DESC LIMIT 1
  `).bind(stockId).first<{id:number}>();
}

async function warehouseStock(db: D1Database, partId: number, warehouseCode: string) {
  if (!warehouseCode) throw new Error('Choose the warehouse the part is physically coming from.');
  return db.prepare(`
    SELECT s.id,s.part_id,s.warehouse_id,s.quantity_on_hand,s.unit_cost,s.updated_at,w.code AS warehouse_code
    FROM part_warehouse_stock s
    JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.part_id = ? AND w.code = ? AND w.active = 1
    ORDER BY CASE WHEN s.variant_key = '' THEN 0 ELSE 1 END,s.quantity_on_hand DESC,s.id
    LIMIT 1
  `).bind(partId,warehouseCode.trim().toUpperCase()).first<{
    id:number; part_id:number; warehouse_id:number; quantity_on_hand:number; unit_cost:number|null;
    updated_at:string; warehouse_code:string;
  }>();
}

async function refreshPartTotal(db: D1Database, partId: number) {
  await db.prepare(`
    UPDATE parts
    SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?),0),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(partId,partId).run();
}

async function refreshRepairPartsText(db: D1Database, repairId: number) {
  const rows = await db.prepare(`
    SELECT p.part_number,SUM(rp.quantity) AS quantity
    FROM repair_parts rp JOIN parts p ON p.id = rp.part_id
    WHERE rp.repair_id = ?
    GROUP BY p.id,p.part_number ORDER BY p.part_number
  `).bind(repairId).all<{part_number:string;quantity:number}>();
  const text = rows.results.map((row)=>`${row.part_number} x${Number(row.quantity)}`).join(', ');
  await db.prepare('UPDATE repairs SET parts_text = ?,updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(text,repairId).run();
}

export async function applyPartToRepair(
  db: D1Database,
  input: {
    operationKey: string;
    repairId: unknown;
    partId: unknown;
    quantity: unknown;
    warehouseCode: unknown;
    userId?: number|null;
    unitCost?: unknown;
    source?: 'technician'|'work_order_review'|'maintenance';
    note?: string;
  },
) {
  const operationKey = cleanKey(input.operationKey);
  if (!operationKey) throw new Error('An idempotency key is required for this stock operation.');
  const prior = await operationByKey(db,operationKey);
  if (prior) return {ok:true,idempotent:true,operationId:prior.id,usageId:prior.repair_part_id,repairId:`repair-${prior.repair_id}`,partId:prior.part_id,quantity:Math.abs(finite(prior.quantity_delta))};

  const repairId = repairNumber(input.repairId);
  const partId = Number(input.partId ?? 0);
  const quantity = positive(input.quantity,'Part quantity');
  if (!Number.isInteger(partId) || partId <= 0) throw new Error('Choose a catalog part.');
  const repair = await db.prepare(`SELECT id,COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(repairId).first<{id:number;status:string}>();
  if (!repair) throw new Error('Repair was not found.');
  const source = input.source ?? 'technician';
  if (source !== 'work_order_review' && repair.status.toLowerCase().includes('complete')) throw new Error('Completed repairs cannot issue additional parts outside Work Order Review.');

  const part = await db.prepare('SELECT id,part_number,unit_cost FROM parts WHERE id = ? AND active = 1').bind(partId).first<{id:number;part_number:string;unit_cost:number|null}>();
  if (!part) throw new Error('Part was not found.');
  const stock = await warehouseStock(db,partId,String(input.warehouseCode ?? '').trim().toUpperCase());
  if (!stock) throw new Error('That part is not stocked in the selected warehouse.');
  if (finite(stock.quantity_on_hand) + EPSILON < quantity) throw new Error(`Not enough physical stock is available in ${stock.warehouse_code}.`);
  const unitCost = input.unitCost === '' || input.unitCost == null ? finite(stock.unit_cost ?? part.unit_cost) : Math.max(0,finite(input.unitCost));
  const dependsOn = await latestStockOperation(db,stock.id);
  const operationType = source === 'work_order_review' ? 'work_order_review_part' : 'apply_part';

  try {
    await db.batch([
      db.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note) VALUES (?,?,?,?,?)`)
        .bind(operationKey,operationType,repairId,input.userId ?? null,String(input.note ?? '').slice(0,500)),
      db.prepare(`
        UPDATE part_warehouse_stock
        SET quantity_on_hand = quantity_on_hand - ?,updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND part_id = ? AND quantity_on_hand >= ?
      `).bind(quantity,stock.id,partId,quantity),
      db.prepare(`
        INSERT INTO repair_parts (repair_id,part_id,quantity,unit_cost,warehouse_stock_id,inventory_operation_id)
        SELECT ?,?,?,?, ?,(SELECT id FROM inventory_operations WHERE operation_key = ?)
        WHERE changes() = 1
      `).bind(repairId,partId,quantity,unitCost,stock.id,operationKey),
      db.prepare(`
        INSERT INTO inventory_operation_lines
          (operation_id,part_id,warehouse_stock_id,warehouse_id,repair_part_id,quantity_delta,unit_cost,line_type)
        SELECT o.id,?,?,?,rp.id,?,?,?
        FROM inventory_operations o
        JOIN repair_parts rp ON rp.inventory_operation_id = o.id
        WHERE o.operation_key = ?
      `).bind(partId,stock.id,stock.warehouse_id,-quantity,unitCost,'part_issue',operationKey),
      ...(dependsOn ? [db.prepare(`
        INSERT INTO inventory_operation_dependencies (operation_id,depends_on_operation_id,reason)
        SELECT id,?, 'Later operation touched the same physical stock row.'
        FROM inventory_operations WHERE operation_key = ?
      `).bind(dependsOn.id,operationKey)] : []),
      db.prepare(`
        INSERT INTO inventory_operation_commits (operation_id,applied)
        SELECT o.id,CASE WHEN EXISTS(
          SELECT 1 FROM inventory_operation_lines l
          JOIN repair_parts rp ON rp.id = l.repair_part_id
          WHERE l.operation_id = o.id AND l.line_type = 'part_issue' AND l.quantity_delta = ?
        ) THEN 1 ELSE 0 END
        FROM inventory_operations o WHERE o.operation_key = ?
      `).bind(-quantity,operationKey),
    ]);
  } catch (error) {
    const duplicate = await operationByKey(db,operationKey);
    if (duplicate) return {ok:true,idempotent:true,operationId:duplicate.id,usageId:duplicate.repair_part_id,repairId:`repair-${repairId}`,partId,quantity};
    throw new Error(error instanceof Error && /CHECK constraint|constraint failed/i.test(error.message)
      ? 'Stock changed before the part could be applied. Nothing was posted; refresh inventory and try again.'
      : (error instanceof Error ? error.message : 'Part operation failed.'));
  }

  await refreshPartTotal(db,partId);
  await refreshRepairPartsText(db,repairId);
  const applied = await operationByKey(db,operationKey);
  if (!applied?.repair_part_id) throw new Error('Part operation committed without a usage record.');
  return {ok:true,idempotent:false,operationId:applied.id,usageId:applied.repair_part_id,repairId:`repair-${repairId}`,partId,quantity,unitCost,warehouseCode:stock.warehouse_code};
}

export async function undoInventoryOperation(
  db: D1Database,
  input: {operationId: unknown; operationKey: string; userId?: number|null; note?: string},
) {
  const originalId = Number(input.operationId ?? 0);
  const operationKey = cleanKey(input.operationKey);
  if (!Number.isInteger(originalId) || originalId <= 0 || !operationKey) throw new Error('Operation and idempotency key are required.');
  const existingUndo = await operationByKey(db,operationKey);
  if (existingUndo) return {ok:true,idempotent:true,operationId:existingUndo.id,undidOperationId:originalId};

  const original = await db.prepare(`
    SELECT o.id,o.status,o.repair_id,l.part_id,l.warehouse_stock_id,l.warehouse_id,l.repair_part_id,l.quantity_delta,l.unit_cost
    FROM inventory_operations o JOIN inventory_operation_lines l ON l.operation_id = o.id
    WHERE o.id = ? AND l.line_type = 'part_issue' LIMIT 1
  `).bind(originalId).first<{id:number;status:string;repair_id:number|null;part_id:number;warehouse_stock_id:number;warehouse_id:number;repair_part_id:number|null;quantity_delta:number;unit_cost:number|null}>();
  if (!original || original.status !== 'applied' || original.quantity_delta >= 0) throw new Error('This operation cannot be undone.');
  const dependent = await db.prepare(`
    SELECT d.operation_id FROM inventory_operation_dependencies d
    JOIN inventory_operations o ON o.id = d.operation_id
    WHERE d.depends_on_operation_id = ? AND o.status = 'applied' LIMIT 1
  `).bind(originalId).first<{operation_id:number}>();
  if (dependent) throw new Error('Undo is blocked because a later inventory operation depends on this one. Undo the later operation first.');
  if (!original.repair_part_id) throw new Error('The operation no longer has an attached repair-part row.');
  const quantity = Math.abs(finite(original.quantity_delta));

  await db.batch([
    db.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note,undo_of_operation_id) VALUES (?,'undo',?,?,?,?)`)
      .bind(operationKey,original.repair_id,input.userId ?? null,String(input.note ?? '').slice(0,500),originalId),
    db.prepare(`UPDATE part_warehouse_stock SET quantity_on_hand = quantity_on_hand + ?,updated_at = CURRENT_TIMESTAMP WHERE id = ? AND part_id = ?`)
      .bind(quantity,original.warehouse_stock_id,original.part_id),
    db.prepare(`DELETE FROM repair_parts WHERE id = ? AND inventory_operation_id = ?`).bind(original.repair_part_id,originalId),
    db.prepare(`
      INSERT INTO inventory_operation_lines (operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,unit_cost,line_type)
      SELECT id,?,?,?,?,?,'undo_part_issue' FROM inventory_operations WHERE operation_key = ?
    `).bind(original.part_id,original.warehouse_stock_id,original.warehouse_id,quantity,original.unit_cost,operationKey),
    db.prepare(`UPDATE inventory_operations SET status = 'undone',undone_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'applied'`).bind(originalId),
    db.prepare(`
      INSERT INTO inventory_operation_commits (operation_id,applied)
      SELECT id,CASE WHEN (SELECT status FROM inventory_operations WHERE id = ?) = 'undone' THEN 1 ELSE 0 END
      FROM inventory_operations WHERE operation_key = ?
    `).bind(originalId,operationKey),
  ]);
  await refreshPartTotal(db,original.part_id);
  if (original.repair_id) await refreshRepairPartsText(db,original.repair_id);
  const undo = await operationByKey(db,operationKey);
  return {ok:true,idempotent:false,operationId:undo?.id,undidOperationId:originalId};
}

export async function recordPhysicalCount(
  db: D1Database,
  input: {partId: unknown; warehouseCode: unknown; countedQuantity: unknown; stockVersion: unknown; reason?: unknown; userId?: number|null},
) {
  const partId = Number(input.partId ?? 0);
  const counted = finite(input.countedQuantity,NaN);
  if (!Number.isInteger(partId) || partId <= 0 || !Number.isFinite(counted) || counted < 0) throw new Error('Part and a non-negative physical count are required.');
  const stock = await warehouseStock(db,partId,String(input.warehouseCode ?? '').trim().toUpperCase());
  if (!stock) throw new Error('That part is not stocked in the selected warehouse.');
  const stockVersion = String(input.stockVersion ?? '').trim();
  if (!stockVersion || stock.updated_at !== stockVersion) throw new Error('Inventory changed after this count screen was loaded. Refresh before recording the physical count.');
  const expected = finite(stock.quantity_on_hand);
  const difference = counted - expected;
  if (Math.abs(difference) <= EPSILON) return {ok:true,matched:true,expectedQuantity:expected,countedQuantity:counted,stockVersion};
  const result = await db.prepare(`
    INSERT INTO inventory_discrepancy_issues
      (part_id,warehouse_id,warehouse_stock_id,expected_quantity,counted_quantity,difference_quantity,reason,stock_version,created_by_user_id)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(partId,stock.warehouse_id,stock.id,expected,counted,difference,String(input.reason ?? 'Physical count discrepancy').trim().slice(0,500),stockVersion,input.userId ?? null).run();
  return {ok:true,matched:false,issueId:Number(result.meta.last_row_id),expectedQuantity:expected,countedQuantity:counted,differenceQuantity:difference};
}

export async function resolvePhysicalCountIssue(
  db: D1Database,
  input: {issueId: unknown; operationKey: string; userId?: number|null; note?: unknown},
) {
  const issueId = Number(input.issueId ?? 0);
  const operationKey = cleanKey(input.operationKey);
  if (!Number.isInteger(issueId) || issueId <= 0 || !operationKey) throw new Error('Discrepancy issue and idempotency key are required.');
  const prior = await operationByKey(db,operationKey);
  if (prior) return {ok:true,idempotent:true,operationId:prior.id,issueId};
  const issue = await db.prepare(`
    SELECT i.*,s.quantity_on_hand,s.updated_at
    FROM inventory_discrepancy_issues i JOIN part_warehouse_stock s ON s.id = i.warehouse_stock_id
    WHERE i.id = ? AND i.status = 'open'
  `).bind(issueId).first<{id:number;part_id:number;warehouse_id:number;warehouse_stock_id:number;counted_quantity:number;stock_version:string;quantity_on_hand:number;updated_at:string}>();
  if (!issue) throw new Error('Open physical-count discrepancy was not found.');
  if (issue.updated_at !== issue.stock_version) throw new Error('Inventory changed after the discrepancy was recorded. Recount before resolving it.');
  const delta = finite(issue.counted_quantity)-finite(issue.quantity_on_hand);
  const dependsOn = await latestStockOperation(db,issue.warehouse_stock_id);

  await db.batch([
    db.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,user_id,note) VALUES (?,'physical_count_resolution',?,?)`)
      .bind(operationKey,input.userId ?? null,String(input.note ?? '').slice(0,500)),
    db.prepare(`UPDATE part_warehouse_stock SET quantity_on_hand = ?,updated_at = CURRENT_TIMESTAMP WHERE id = ? AND updated_at = ?`)
      .bind(issue.counted_quantity,issue.warehouse_stock_id,issue.stock_version),
    db.prepare(`
      INSERT INTO inventory_operation_lines (operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,line_type)
      SELECT id,?,?,?,?,'physical_count_resolution' FROM inventory_operations WHERE operation_key = ? AND changes() = 1
    `).bind(issue.part_id,issue.warehouse_stock_id,issue.warehouse_id,delta,operationKey),
    ...(dependsOn ? [db.prepare(`INSERT INTO inventory_operation_dependencies (operation_id,depends_on_operation_id,reason) SELECT id,?,'Physical count followed this stock operation.' FROM inventory_operations WHERE operation_key = ?`).bind(dependsOn.id,operationKey)] : []),
    db.prepare(`UPDATE inventory_discrepancy_issues SET status = 'resolved',resolved_by_user_id = ?,resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open' AND EXISTS (SELECT 1 FROM inventory_operation_lines l JOIN inventory_operations o ON o.id=l.operation_id WHERE o.operation_key = ?)`)
      .bind(input.userId ?? null,issueId,operationKey),
    db.prepare(`
      INSERT INTO inventory_operation_commits (operation_id,applied)
      SELECT id,CASE WHEN (SELECT status FROM inventory_discrepancy_issues WHERE id = ?) = 'resolved' THEN 1 ELSE 0 END
      FROM inventory_operations WHERE operation_key = ?
    `).bind(issueId,operationKey),
  ]);
  await refreshPartTotal(db,issue.part_id);
  const operation = await operationByKey(db,operationKey);
  return {ok:true,idempotent:false,operationId:operation?.id,issueId,quantityDelta:delta};
}

export async function saveNormalizedVendor(db: D1Database, body: Record<string,unknown>) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new Error('Vendor name is required.');
  const normalized = normalizeVendorName(name);
  if (!normalized) throw new Error('Vendor name is invalid.');
  const id = Number(body.id ?? 0);
  const phone = String(body.phone ?? '').trim();
  const email = String(body.email ?? '').trim();
  const notes = String(body.notes ?? '').trim();
  if (id > 0) {
    await db.prepare('UPDATE vendors SET name=?,normalized_name=?,phone=?,email=?,notes=? WHERE id=?').bind(name,normalized,phone,email,notes,id).run();
    return {ok:true,id,normalizedName:normalized};
  }
  const existing = await db.prepare(`SELECT id,name FROM vendors WHERE COALESCE(active,1)=1 AND normalized_name = ? ORDER BY id LIMIT 1`).bind(normalized).first<{id:number;name:string}>();
  if (existing) return {ok:true,id:existing.id,normalizedName:normalized,matchedExisting:true,canonicalName:existing.name};
  const result = await db.prepare('INSERT INTO vendors (name,normalized_name,phone,email,notes) VALUES (?,?,?,?,?)').bind(name,normalized,phone,email,notes).run();
  return {ok:true,id:Number(result.meta.last_row_id),normalizedName:normalized,matchedExisting:false};
}
