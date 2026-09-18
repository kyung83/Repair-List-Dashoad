function partIdValue(value: unknown) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Part is required.');
  return id;
}

async function requirePart(db: D1Database, partId: number) {
  const row = await db.prepare('SELECT id,part_number,description,active,core_return_part_id FROM parts WHERE id=?')
    .bind(partId)
    .first<{id:number;part_number:string;description:string;active:number;core_return_part_id:number|null}>();
  if (!row) throw new Error('Part was not found.');
  return row;
}

export async function setPartArchived(db: D1Database, input: {partId: unknown; archived: boolean}) {
  const partId = partIdValue(input.partId);
  const part = await requirePart(db, partId);
  const active = input.archived ? 0 : 1;
  await db.prepare('UPDATE parts SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
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

export async function deleteUnusedPart(db: D1Database, input: {partId: unknown}) {
  const partId = partIdValue(input.partId);
  const part = await requirePart(db, partId);

  const stock = await db.prepare(`
    SELECT COALESCE(SUM(quantity_on_hand),0) AS quantity_on_hand,
           COALESCE(SUM(on_order),0) AS on_order
    FROM part_warehouse_stock
    WHERE part_id=?
  `).bind(partId).first<{quantity_on_hand:number;on_order:number}>();
  const physical = Number(stock?.quantity_on_hand ?? 0);
  const onOrder = Number(stock?.on_order ?? 0);
  if (Math.abs(physical) > 0.000001 || Math.abs(onOrder) > 0.000001) {
    throw new Error(`Permanent delete is blocked because ${part.part_number} still has warehouse stock or on-order quantity. Physical-count/transfer it to zero first, or archive it instead.`);
  }

  const blockers = [
    ['repair history', await count(db,'SELECT COUNT(*) AS count FROM repair_parts WHERE part_id=?',partId)],
    ['repair part requests', await count(db,'SELECT COUNT(*) AS count FROM repair_part_requests WHERE part_id=?',partId)],
    ['part lifecycle history', await count(db,'SELECT COUNT(*) AS count FROM part_lifecycle_events WHERE part_id=?',partId)],
    ['legacy transfers', await count(db,'SELECT COUNT(*) AS count FROM part_transfers WHERE part_id=?',partId)],
    ['inventory operations', await count(db,'SELECT COUNT(*) AS count FROM inventory_operation_lines WHERE part_id=?',partId)],
    ['physical-count history', await count(db,'SELECT COUNT(*) AS count FROM inventory_discrepancy_issues WHERE part_id=?',partId)],
    ['core history', await count(db,'SELECT COUNT(*) AS count FROM part_core_obligations WHERE issued_part_id=? OR core_part_id=?',partId,partId)],
    ['recovered tire history', await count(db,'SELECT COUNT(*) AS count FROM recovered_used_tires WHERE part_id=?',partId)],
    ['inventory transfers', await count(db,'SELECT COUNT(*) AS count FROM inventory_transfers WHERE part_id=?',partId)],
    ['receiving history', await count(db,'SELECT COUNT(*) AS count FROM parts_receipts WHERE part_id=?',partId)],
    ['PM kit assignments', await count(db,'SELECT COUNT(*) AS count FROM pm_kit_parts WHERE part_id=?',partId)],
    ['planned repair parts', await count(db,'SELECT COUNT(*) AS count FROM repair_planned_parts WHERE part_id=?',partId)],
    ['core configuration on another part', await count(db,'SELECT COUNT(*) AS count FROM parts WHERE core_return_part_id=? AND id<>?',partId,partId)],
  ].filter(([,value]) => Number(value) > 0) as Array<[string,number]>;

  if (blockers.length) {
    const detail = blockers.slice(0,3).map(([label,value]) => `${label} (${value})`).join(', ');
    throw new Error(`Permanent delete is blocked because ${part.part_number} has linked records: ${detail}${blockers.length>3?' and more':''}. Archive it instead so history stays intact.`);
  }

  try {
    await db.batch([
      db.prepare('DELETE FROM part_vendors WHERE part_id=?').bind(partId),
      db.prepare('DELETE FROM part_warehouse_minimums WHERE part_id=?').bind(partId),
      db.prepare('DELETE FROM part_equipment WHERE part_id=?').bind(partId),
      db.prepare('DELETE FROM part_cross_references WHERE part_id=?').bind(partId),
      db.prepare('DELETE FROM part_warehouse_stock WHERE part_id=?').bind(partId),
      db.prepare('DELETE FROM parts WHERE id=?').bind(partId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/foreign key|constraint/i.test(message)) {
      throw new Error(`Permanent delete is blocked because ${part.part_number} is still linked somewhere in the system. Archive it instead so history stays intact.`);
    }
    throw error;
  }

  return {ok:true,partId,partNumber:part.part_number,deleted:true};
}
