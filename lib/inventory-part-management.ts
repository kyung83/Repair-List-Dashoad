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
