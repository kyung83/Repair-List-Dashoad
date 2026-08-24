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
      db.prepare(`
        INSERT OR IGNORE INTO part_core_obligations
          (source_operation_id,repair_id,issued_part_id,core_part_id,quantity,status)
        SELECT o.id,?,p.id,p.core_return_part_id,? * p.core_return_quantity,'open'
        FROM inventory_operations o
        JOIN parts p ON p.id = ?
        WHERE o.operation_key = ?
          AND p.core_return_part_id IS NOT NULL
          AND p.core_return_quantity > 0
          AND EXISTS (
            SELECT 1 FROM inventory_operation_lines l
            WHERE l.operation_id = o.id AND l.line_type = 'part_issue'
          )
      `).bind(repairId,quantity,partId,operationKey),
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

  const core = await db.prepare(`
    SELECT id,status FROM part_core_obligations WHERE source_operation_id = ? LIMIT 1
  `).bind(originalId).first<{id:number;status:string}>();
  if (core && core.status !== 'open') throw new Error('Undo is blocked because the core obligation was already returned or waived.');
  if (!original.repair_part_id) throw new Error('The operation no longer has an attached repair-part row.');
  const quantity = Math.abs(finite(original.quantity_delta));

  await db.batch([
    db.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note,undo_of_operation_id) VALUES (?,'undo',?,?,?,?)`)
      .bind(operationKey,original.repair_id,input.userId ?? null,String(input.note ?? '').slice(0,500),originalId),
    db.prepare(`UPDATE part_warehouse_stock SET quantity_on_hand = quantity_on_hand + ?,updated_at = CURRENT_TIMESTAMP WHERE id = ? AND part_id = ?`)
      .bind(quantity,original.warehouse_stock_id,original.part_id),
    db.prepare(`DELETE FROM repair_parts WHERE id = ? AND inventory_operation_id = ?`).bind(original.repair_part_id,originalId),
    db.prepare(`DELETE FROM part_core_obligations WHERE source_operation_id = ? AND status = 'open'`).bind(originalId),
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
