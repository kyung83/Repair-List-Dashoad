function partIdValue(value: unknown) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Part is required.');
  return id;
}

async function requirePart(db: D1Database, partId: number) {
  const row = await db.prepare('SELECT id,part_number,description,active,core_return_part_id,deleted_at FROM parts WHERE id=?')
    .bind(partId)
    .first<{id:number;part_number:string;description:string;active:number;core_return_part_id:number|null;deleted_at:string|null}>();
  if (!row) throw new Error('Part was not found.');
  return row;
}

export async function setPartArchived(db: D1Database, input: {partId: unknown; archived: boolean}) {
  const partId = partIdValue(input.partId);
  const part = await requirePart(db, partId);
  if (part.deleted_at) throw new Error('Deleted parts cannot be archived or restored.');
  const active = input.archived ? 0 : 1;
  await db.prepare('UPDATE parts SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL')
    .bind(active, partId).run();
  return {
    ok: true,
    partId,
    partNumber: part.part_number,
    archived: Boolean(input.archived),
  };
}

async function count(db: D1Database, sql: string, ...bindings: unknown[]) {
  const row = await db.prepare(sql).bind(...bindings).first<{count:number}>();
  return Number(row?.count ?? 0);
}

export async function deletePartPreservingHistory(
  db: D1Database,
  input: {partId: unknown; userId?: number|null},
) {
  const partId = partIdValue(input.partId);
  const part = await requirePart(db, partId);
  if (part.deleted_at) return {ok:true,partId,partNumber:part.part_number,deleted:true,idempotent:true};

  const stock = await db.prepare(`
    SELECT COALESCE(SUM(quantity_on_hand),0) AS quantity_on_hand,
           COALESCE(SUM(on_order),0) AS on_order
    FROM part_warehouse_stock
    WHERE part_id=?
  `).bind(partId).first<{quantity_on_hand:number;on_order:number}>();
  const physical = Number(stock?.quantity_on_hand ?? 0);
  const onOrder = Number(stock?.on_order ?? 0);
  if (Math.abs(physical) > 0.000001 || Math.abs(onOrder) > 0.000001) {
    throw new Error(`Delete is blocked because ${part.part_number} still has warehouse stock or on-order quantity. Physical-count/transfer it to zero first. Its existing history will still be preserved after deletion.`);
  }

  const openRequests = await count(db,`
    SELECT COUNT(*) AS count
    FROM repair_part_requests q
    JOIN repairs r ON r.id=q.repair_id
    WHERE q.part_id=? AND q.status='open'
      AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
  `,partId);
  if (openRequests > 0) {
    throw new Error(`Delete is blocked because ${part.part_number} is still requested on an open repair. Close or remove the open request first; completed history does not block deletion.`);
  }

  const activePlanned = await count(db,`
    SELECT COUNT(*) AS count
    FROM repair_planned_parts pp
    JOIN repairs r ON r.id=pp.repair_id
    WHERE pp.part_id=? AND pp.removed_at IS NULL
      AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
  `,partId);
  if (activePlanned > 0) {
    throw new Error(`Delete is blocked because ${part.part_number} is still planned on an open repair. Remove it from the open job first; completed history does not block deletion.`);
  }

  await db.batch([
    // Tombstone the catalog row so every historical FK keeps the same part identity.
    db.prepare(`
      UPDATE parts
      SET active=0,deleted_at=CURRENT_TIMESTAMP,deleted_by_user_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at IS NULL
    `).bind(input.userId ?? null,partId),

    // Stop future PM templates from placing the deleted part on new work orders.
    db.prepare('DELETE FROM pm_kit_parts WHERE part_id=?').bind(partId),

    // A deleted part must not remain configured as a future return core.
    db.prepare('UPDATE parts SET core_return_part_id=NULL,core_return_quantity=0,updated_at=CURRENT_TIMESTAMP WHERE core_return_part_id=?').bind(partId),

    // Free interchange numbers for future active catalog parts while retaining the rows for audit.
    db.prepare('UPDATE part_cross_references SET active=0,updated_at=CURRENT_TIMESTAMP WHERE part_id=?').bind(partId),
  ]);

  return {
    ok:true,
    partId,
    partNumber:part.part_number,
    deleted:true,
    idempotent:false,
    historyPreserved:true,
  };
}


function warehouseCodeValue(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!code || code.length > 64 || code === 'ALL') throw new Error('Choose a specific warehouse.');
  return code;
}

export async function setPartWarehouseStatus(
  db: D1Database,
  input: {partId: unknown; warehouseCode: unknown; status: 'active'|'archived'|'removed'; userId?: number|null},
) {
  const partId = partIdValue(input.partId);
  const warehouseCode = warehouseCodeValue(input.warehouseCode);
  const part = await requirePart(db,partId);
  if (part.deleted_at) throw new Error('Deleted parts cannot be changed by warehouse.');

  const warehouse = await db.prepare('SELECT id,code,name FROM warehouses WHERE code=? AND active=1')
    .bind(warehouseCode).first<{id:number;code:string;name:string}>();
  if (!warehouse) throw new Error('Warehouse was not found.');

  await db.prepare(`
    INSERT INTO part_warehouse_catalog_status(part_id,warehouse_id,status,updated_by_user_id,updated_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(part_id,warehouse_id) DO UPDATE SET
      status=excluded.status,
      updated_by_user_id=excluded.updated_by_user_id,
      updated_at=CURRENT_TIMESTAMP
  `).bind(partId,warehouse.id,input.status,input.userId ?? null).run();

  return {ok:true,partId,partNumber:part.part_number,warehouseCode:warehouse.code,warehouseName:warehouse.name,status:input.status};
}

/**
 * Explicitly activate zero-quantity stock tracking for an existing catalog part.
 * Never guess an opening balance or rewrite an existing warehouse stock row.
 * The first physical count (if nonzero) remains an independently audited action.
 */
export async function initializePartWarehouseStock(
  db: D1Database,
  input: {partId: unknown; warehouseCode: unknown; userId: number; operationKey: string},
) {
  const partId=partIdValue(input.partId);
  const warehouseCode=warehouseCodeValue(input.warehouseCode);
  const userId=Number(input.userId);
  const operationKey=String(input.operationKey??'').trim();
  if (!Number.isSafeInteger(userId)||userId<=0) throw new Error('Authentication required.');
  if (!/^warehouse-stock-init:[A-Za-z0-9._:-]{1,120}$/.test(operationKey)) throw new Error('A stock tracking request key is required.');
  const part=await db.prepare(`
    SELECT id,part_number,quantity_on_hand,unit_cost
    FROM parts WHERE id=? AND active=1 AND deleted_at IS NULL AND COALESCE(inventory_class,'stock')='stock'
  `).bind(partId).first<{id:number;part_number:string;quantity_on_hand:number;unit_cost:number|null}>();
  if(!part) throw new Error('An active inventory part is required.');
  const warehouse=await db.prepare(`
    SELECT w.id,w.code,w.name,COALESCE(cs.status,'active') AS status
    FROM warehouses w LEFT JOIN part_warehouse_catalog_status cs
      ON cs.warehouse_id=w.id AND cs.part_id=?
    WHERE w.code=? AND w.active=1
  `).bind(partId,warehouseCode).first<{id:number;code:string;name:string;status:string}>();
  if(!warehouse)throw new Error('That warehouse is not active.');
  if(warehouse.status!=='active')throw new Error('Restore this part in the warehouse before starting stock tracking.');

  const existing=await db.prepare('SELECT id FROM part_warehouse_stock WHERE part_id=? AND warehouse_id=? LIMIT 1')
    .bind(partId,warehouse.id).first<{id:number}>();
  if(existing)return{ok:true,created:false,partId,warehouseCode,warehouseName:warehouse.name,quantityOnHandUnchanged:true};

  const anyStock=await db.prepare('SELECT id FROM part_warehouse_stock WHERE part_id=? LIMIT 1')
    .bind(partId).first<{id:number}>();
  if(!anyStock && Number(part.quantity_on_hand)!==0) {
    throw new Error('This part has a nonzero legacy inventory balance without warehouse records. Reconcile the opening balance before enabling zero-stock tracking.');
  }

  // D1 batch is atomic: the audit and zero-stock row either both exist or neither does.
  // A duplicate request safely reuses the unique stock row; no quantities are adjusted.
  await db.batch([
    db.prepare(`INSERT INTO inventory_operations(operation_key,operation_type,user_id,note)
      VALUES(?,'warehouse_stock_initialized',?,?)`)
      .bind(operationKey,userId,`Enabled zero-stock tracking for ${part.part_number} at ${warehouse.name}; opening quantity not assumed.`),
    db.prepare(`
      INSERT INTO part_warehouse_stock(part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure,unit_cost,on_order)
      SELECT p.id,w.id,'',0,'EA',p.unit_cost,0
      FROM parts p JOIN warehouses w ON w.id=?
      LEFT JOIN part_warehouse_catalog_status cs ON cs.part_id=p.id AND cs.warehouse_id=w.id
      WHERE p.id=? AND p.active=1 AND p.deleted_at IS NULL AND COALESCE(p.inventory_class,'stock')='stock'
        AND w.active=1 AND COALESCE(cs.status,'active')='active'
        AND NOT EXISTS(SELECT 1 FROM part_warehouse_stock s WHERE s.part_id=p.id AND s.warehouse_id=w.id)
        AND (p.quantity_on_hand=0 OR EXISTS(SELECT 1 FROM part_warehouse_stock other WHERE other.part_id=p.id))
      ON CONFLICT(part_id,warehouse_id,variant_key) DO NOTHING
    `).bind(warehouse.id,partId),
    db.prepare(`
      INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,line_type)
      SELECT o.id,s.part_id,s.id,s.warehouse_id,0,'warehouse_stock_initialized'
      FROM inventory_operations o JOIN part_warehouse_stock s ON s.part_id=? AND s.warehouse_id=?
      WHERE o.operation_key=? ORDER BY CASE WHEN s.variant_key='' THEN 0 ELSE 1 END,s.id LIMIT 1
    `).bind(partId,warehouse.id,operationKey),
    db.prepare(`
      INSERT INTO inventory_operation_commits(operation_id,applied)
      SELECT o.id,CASE WHEN EXISTS(
        SELECT 1 FROM inventory_operation_lines l
        WHERE l.operation_id=o.id AND l.part_id=? AND l.warehouse_id=? AND l.line_type='warehouse_stock_initialized'
      ) THEN 1 ELSE 0 END
      FROM inventory_operations o WHERE o.operation_key=?
    `).bind(partId,warehouse.id,operationKey),
  ]);
  return{ok:true,created:true,partId,warehouseCode,warehouseName:warehouse.name,quantityOnHandUnchanged:true};
}
