/** Deterministic planning and SQL generation for private, authenticated CI imports. */
import { createHash } from 'node:crypto';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const inventoryImportHash = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
const partKey = (value) => String(value ?? '').trim().replace(/[a-z]/g, (letter) => letter.toUpperCase());
const referenceKey = (value) => partKey(value).replace(/[^A-Z0-9]/g, '').slice(0,120);
const text = (value, maximum) => {
  const result = String(value ?? '').trim();
  if (result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new Error('A source text field is invalid.');
  return result;
};
const byId = (a, b) => Number(a.id) - Number(b.id);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function normalizeInventoryImport(input) {
  if (!input || typeof input !== 'object' || !input.source || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 5000) throw new Error('Provide a source descriptor and between 1 and 5000 source rows.');
  const source = { name: text(input.source.name, 240), sha256: text(input.source.sha256, 64).toLowerCase(), asOf: text(input.source.asOf, 100) || null };
  if (!source.name || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Source name and its SHA-256 are required.');
  const rows = input.rows.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error('Every source row must be an object.');
    const row = { sourceRowId: text(value.sourceRowId, 100), partNumber: text(value.partNumber, 120), description: text(value.description, 500),
      warehouseCode: partKey(text(value.warehouseCode, 60)), quantity: Number(value.quantity), sourceActive: value.sourceActive === true };
    if (!row.sourceRowId) throw new Error(`Source row ${index + 1} requires its original source-row identifier.`);
    if (own(value, 'binLocation')) row.binLocation = text(value.binLocation, 2000);
    if (own(value, 'unitOfMeasure')) row.unitOfMeasure = text(value.unitOfMeasure, 40);
    if (own(value, 'coreType')) row.coreType = text(value.coreType, 80);
    if (own(value, 'unitCost') && value.unitCost !== '' && value.unitCost != null) {
      row.unitCost = Number(value.unitCost);
      if (!Number.isFinite(row.unitCost) || row.unitCost < 0) throw new Error('Source unit costs must be finite and nonnegative.');
    }
    if (own(value, 'stockId')) {
      row.stockId = Number(value.stockId);
      if (!Number.isInteger(row.stockId) || row.stockId <= 0) throw new Error('An explicit stock mapping must be a positive integer.');
    }
    if (own(value, 'variantKey')) row.variantKey = text(value.variantKey, 160);
    return row;
  });
  return { source, rows };
}

export function planInventoryImport(input, snapshot) {
  const normalized = normalizeInventoryImport(input);
  if (snapshot?.schemaVersion !== 1 || snapshot.complete !== true || !snapshot.tables || snapshot.databaseName !== 'norlow-repair-production') throw new Error('A complete production inventory backup is required.');
  const { parts, part_warehouse_stock: stocks, warehouses, part_warehouse_locations: bins } = snapshot.tables;
  if (![parts, stocks, warehouses, bins, snapshot.inventoryOperationTail].every(Array.isArray)) throw new Error('Inventory backup shape is incomplete.');
  const rows = normalized.rows.map((source, index) => ({ source, inputIndex: index, issues: [], kind: null, partId: null, stockId: null, variantKey: null, warehouseId: null, existingVariants: [] }));
  const sourceIds = new Map();
  const grouped = new Map();
  for (const row of rows) {
    const idRows = sourceIds.get(row.source.sourceRowId) || [];
    idRows.push(row); sourceIds.set(row.source.sourceRowId, idRows);
    const key = partKey(row.source.partNumber);
    const group = grouped.get(key) || { partKey: key, rows: [], beforePart: null, beforeStocks: [], beforeBins: [], operationTail: [], warehouses: [] };
    group.rows.push(row); grouped.set(key, group);
    if (!key) row.issues.push('Part number is required.');
    if (!row.source.sourceActive) row.issues.push('Only sourceActive=true records may be imported.');
    if (!Number.isFinite(row.source.quantity) || row.source.quantity <= 0) row.issues.push('Only strictly positive, finite physical on-hand quantities may be imported.');
    const warehouse = warehouses.filter((entry) => entry.code === row.source.warehouseCode);
    if (warehouse.length !== 1 || Number(warehouse[0].active) !== 1) row.issues.push('Warehouse is not an exact, active destination.');
    else { row.warehouseId = Number(warehouse[0].id); if (!group.warehouses.some((entry) => entry.id === warehouse[0].id)) group.warehouses.push(warehouse[0]); }
  }
  for (const values of sourceIds.values()) if (values.length > 1) for (const row of values) row.issues.push('Duplicate original source-row identifier.');

  for (const group of grouped.values()) {
    const candidates = parts.filter((part) => partKey(part.part_number) === group.partKey);
    if (candidates.length > 1) { for (const row of group.rows) row.issues.push('Part number has ambiguous existing catalog matches.'); continue; }
    const part = candidates[0] || null;
    group.beforePart = part;
    if (!part) {
      const reference = referenceKey(group.partKey);
      const aliases = snapshot.tables.part_cross_references;
      if (!Array.isArray(aliases)) for (const row of group.rows) row.issues.push('A fresh backup including part cross-references is required before creating a new catalog part.');
      else if (parts.some((entry) => referenceKey(entry.part_number) === reference) || aliases.some((entry) => Number(entry.active) === 1 && entry.normalized_cross_part_number === reference)) {
        for (const row of group.rows) row.issues.push('Source number matches another catalog spelling or cross-reference; map the canonical inventory part explicitly before importing.');
      }
    }
    group.beforeStocks = part ? stocks.filter((stock) => Number(stock.part_id) === Number(part.id)).sort(byId) : [];
    group.beforeBins = part ? bins.filter((bin) => Number(bin.part_id) === Number(part.id) && group.warehouses.some((warehouse) => Number(warehouse.id) === Number(bin.warehouse_id))).sort(byId) : [];
    const stockIds = new Set(group.beforeStocks.map((stock) => Number(stock.id)));
    group.operationTail = snapshot.inventoryOperationTail.filter((tail) => stockIds.has(Number(tail.warehouse_stock_id))).sort((a, b) => Number(a.warehouse_stock_id) - Number(b.warehouse_stock_id));
    if (part && (Number(part.active) !== 1 || part.deleted_at != null)) for (const row of group.rows) row.issues.push('Locally archived or deleted parts are excluded; they are never automatically restored.');
    if (!part && new Set(group.rows.map((row) => row.source.description)).size !== 1) for (const row of group.rows) row.issues.push('New catalog part has conflicting descriptions across source rows.');
    const targetRows = new Map();
    const byWarehouse = new Map();
    for (const row of group.rows) {
      row.partId = part ? Number(part.id) : null;
      if (!part && !row.source.description) row.issues.push('A new part requires a description.');
      const siblings = byWarehouse.get(row.warehouseId) || []; siblings.push(row); byWarehouse.set(row.warehouseId, siblings);
      const existing = group.beforeStocks.filter((stock) => Number(stock.warehouse_id) === row.warehouseId);
      row.existingVariants = existing;
      let selected = null;
      if (row.source.stockId != null) {
        selected = existing.find((stock) => Number(stock.id) === row.source.stockId) || null;
        if (!selected) row.issues.push('Explicit stock ID does not belong to this part and warehouse.');
        if (selected && own(row.source, 'variantKey') && selected.variant_key !== row.source.variantKey) row.issues.push('Stock ID and variant key disagree.');
      } else if (own(row.source, 'variantKey')) {
        selected = existing.find((stock) => stock.variant_key === row.source.variantKey) || null;
        if (!selected && existing.length) row.issues.push('Explicit variant does not match existing stock; adding another snapshot balance would risk double counting.');
      } else if (existing.length === 1) selected = existing[0];
      else if (existing.length > 1) row.issues.push('Multiple existing stock variants require an explicit stockId or matching variantKey.');
      if (selected) {
        row.stockId = Number(selected.id); row.variantKey = selected.variant_key; row.kind = 'update_stock';
        if (row.source.coreType && partKey(selected.core_type) !== partKey(row.source.coreType)) row.issues.push('Source core type differs from the mapped stock variant.');
        if (row.source.unitOfMeasure && selected.unit_of_measure && partKey(selected.unit_of_measure) !== partKey(row.source.unitOfMeasure)) row.issues.push('Source unit of measure differs from the mapped stock variant.');
      } else {
        row.variantKey = own(row.source, 'variantKey') ? row.source.variantKey : '';
        row.kind = part ? 'new_stock' : 'new_part';
      }
      const key = selected ? `id:${selected.id}` : `new:${row.warehouseId}:${row.variantKey}`;
      const targets = targetRows.get(key) || []; targets.push(row); targetRows.set(key, targets);
    }
    for (const values of targetRows.values()) if (values.length > 1) for (const row of values) row.issues.push('Multiple source rows target the same stock balance; explicit distinct variant mapping is required.');
    for (const values of byWarehouse.values()) {
      if (values.length > 1 && values.some((row) => row.source.stockId == null && !own(row.source, 'variantKey'))) for (const row of values) row.issues.push('Duplicate source part/warehouse rows require explicit variant mapping.');
      const locations = new Set(values.filter((row) => own(row.source, 'binLocation')).map((row) => row.source.binLocation));
      if (locations.size > 1) for (const row of values) row.issues.push('Conflicting bin locations for the same part and warehouse.');
    }
    group.warehouses.sort(byId);
  }
  const groups = [...grouped.values()].sort((a, b) => a.partKey < b.partKey ? -1 : a.partKey > b.partKey ? 1 : 0);
  const blockedRows = rows.filter((row) => row.issues.length).length;
  const payloadSha256 = inventoryImportHash(normalized);
  const snapshotSha256 = inventoryImportHash(snapshot);
  const summary = {
    sourceRows: rows.length, readyRows: rows.length - blockedRows, blockedRows, parts: groups.length,
    newParts: groups.filter((group) => !group.beforePart).length,
    newStockRows: rows.filter((row) => row.kind === 'new_part' || row.kind === 'new_stock').length,
    existingStockRows: rows.filter((row) => row.kind === 'update_stock').length,
    binUpdates: [...new Set(rows.filter((row) => own(row.source, 'binLocation')).map((row) => `${partKey(row.source.partNumber)}:${row.warehouseId}`))].length,
    quantityBefore: rows.reduce((sum, row) => sum + Number(stocks.find((stock) => Number(stock.id) === row.stockId)?.quantity_on_hand || 0), 0),
    quantityAfter: rows.reduce((sum, row) => sum + (Number.isFinite(row.source.quantity) ? row.source.quantity : 0), 0),
  };
  const body = { schemaVersion: 1, source: normalized.source, normalized, payloadSha256, importKey: `emdecs:${normalized.source.sha256}:${payloadSha256.slice(0,32)}`, databaseId: snapshot.databaseId, groups, summary };
  const planHash = inventoryImportHash(body);
  // Approval concerns the affected records. Unrelated inventory or a fresh export
  // timestamp must not invalidate it; the complete backup has its own digest.
  return { ...body, snapshotSha256, sourceExportedAt: snapshot.exportedAt, planHash, planSha256: planHash, canApply: blockedRows === 0 };
}

export function verifyInventoryImportPlan(plan) {
  if (plan?.schemaVersion !== 1 || !Array.isArray(plan.groups) || !plan.normalized || !plan.source) throw new Error('Invalid inventory import plan.');
  const { planSha256, planHash, canApply, snapshotSha256, sourceExportedAt, ...body } = plan;
  if (planHash !== planSha256 || inventoryImportHash(body) !== planSha256 || inventoryImportHash(plan.normalized) !== plan.payloadSha256) throw new Error('Inventory plan integrity check failed.');
  if (canApply !== true || plan.summary.blockedRows !== 0 || plan.groups.some((group) => group.rows.some((row) => row.issues.length))) throw new Error('Blocked source rows must be resolved before applying any inventory.');
  return plan;
}

const literal = (value) => value == null ? 'NULL' : typeof value === 'number' ? (Number.isFinite(value) ? String(value) : (() => { throw new Error('Invalid SQL numeric value.'); })()) : `'${String(value).replace(/'/g, "''")}'`;
const sameColumns = (alias, before, fields) => fields.filter((field) => own(before, field)).map((field) => `${alias}.${field} IS ${literal(before[field])}`).join(' AND ') || '1';
const PART_FIELDS = ['id','part_number','description','quantity_on_hand','reorder_level','preferred_vendor_id','unit_cost','location','active','updated_at','source_active_flag','source_stock_flag','product_group','markup_group','charge_price','source_updated_at','core_return_part_id','core_return_quantity','deleted_at','deleted_by_user_id'];
const STOCK_FIELDS = ['id','part_id','warehouse_id','variant_key','core_type','quantity_on_hand','unit_of_measure','unit_cost','charge_price','on_order','cm','inventory_line','last_purchase_received','last_issue','source_page','source_updated_at','updated_at'];
const BIN_FIELDS = ['id','part_id','warehouse_id','bin_location','source','source_updated_at','updated_at'];
const jsonObject = (alias, fields) => `json_object(${fields.flatMap((field) => [literal(field), `${alias}.${field}`]).join(',')})`;

export function buildInventoryImportSql(inputPlan, actor = 'Authorized GitHub Actions inventory import') {
  const plan = verifyInventoryImportPlan(inputPlan);
  const key = literal(plan.importKey);
  const applying = `EXISTS(SELECT 1 FROM inventory_source_imports WHERE import_key=${key} AND status='applying')`;
  const statements = [
    '-- Private generated inventory source reconciliation. Do not commit this file.',
    `INSERT OR IGNORE INTO inventory_source_imports(import_key,source_name,source_sha256,source_as_of,payload_sha256,plan_sha256,snapshot_sha256,actor,status,source_row_count,part_count,quantity_before,quantity_after) VALUES(${key},${literal(plan.source.name)},${literal(plan.source.sha256)},${literal(plan.source.asOf)},${literal(plan.payloadSha256)},${literal(plan.planSha256)},${literal(plan.snapshotSha256)},${literal(text(actor,240))},'applying',${plan.summary.sourceRows},${plan.summary.parts},${plan.summary.quantityBefore},${plan.summary.quantityAfter})`,
    `UPDATE inventory_source_imports SET guard=CASE WHEN payload_sha256=${literal(plan.payloadSha256)} AND source_sha256=${literal(plan.source.sha256)} AND (status='applied' OR plan_sha256=${literal(plan.planSha256)}) THEN 1 ELSE 0 END WHERE import_key=${key}`,
  ];
  const guard = (condition) => statements.push(`UPDATE inventory_source_imports SET guard=CASE WHEN ${condition} THEN 1 ELSE 0 END WHERE import_key=${key} AND status='applying'`);
  for (const group of plan.groups) {
    const part = group.beforePart;
    const partNumber = part ? part.part_number : group.rows[0].source.partNumber;
    const partId = part ? String(part.id) : `(SELECT id FROM parts WHERE part_number=${literal(partNumber)})`;
    const partMatch = `(SELECT COUNT(*) FROM parts WHERE UPPER(TRIM(part_number))=${literal(group.partKey)})=${part ? 1 : 0}`;
    const conditions = [partMatch];
    if (!part) {
      const reference = literal(referenceKey(group.partKey));
      conditions.push(`NOT EXISTS(SELECT 1 FROM part_cross_references WHERE active=1 AND normalized_cross_part_number=${reference})`);
      conditions.push(`NOT EXISTS(SELECT 1 FROM parts WHERE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(part_number,'-',''),' ',''),'.',''),'/',''),'_',''))=${reference})`);
    }
    if (part) conditions.push(`EXISTS(SELECT 1 FROM parts p WHERE ${sameColumns('p',part,PART_FIELDS)})`);
    for (const warehouse of group.warehouses) conditions.push(`EXISTS(SELECT 1 FROM warehouses w WHERE ${sameColumns('w',warehouse,['id','code','name','active','updated_at'])} AND w.active=1)`);
    if (part) {
      conditions.push(`(SELECT COUNT(*) FROM part_warehouse_stock WHERE part_id=${part.id})=${group.beforeStocks.length}`);
      for (const stock of group.beforeStocks) conditions.push(`EXISTS(SELECT 1 FROM part_warehouse_stock s WHERE ${sameColumns('s',stock,STOCK_FIELDS)})`);
      for (const warehouse of group.warehouses) {
        const bin = group.beforeBins.find((entry) => Number(entry.warehouse_id) === Number(warehouse.id));
        conditions.push(bin ? `EXISTS(SELECT 1 FROM part_warehouse_locations b WHERE ${sameColumns('b',bin,BIN_FIELDS)})` : `NOT EXISTS(SELECT 1 FROM part_warehouse_locations WHERE part_id=${part.id} AND warehouse_id=${warehouse.id})`);
      }
      for (const stock of group.beforeStocks) {
        const tail = group.operationTail.find((entry) => Number(entry.warehouse_stock_id) === Number(stock.id));
        conditions.push(`(SELECT MAX(l.id) FROM inventory_operation_lines l JOIN inventory_operations o ON o.id=l.operation_id WHERE l.warehouse_stock_id=${stock.id} AND o.status='applied') IS ${literal(tail?.line_id ?? null)}`);
      }
    }
    guard(conditions.join(' AND '));
    if (!part) {
      const source = group.rows[0].source;
      statements.push(`INSERT INTO parts(part_number,description,quantity_on_hand,reorder_level,unit_cost,location,active,source_active_flag,source_updated_at) SELECT ${literal(partNumber)},${literal(source.description)},0,0,${literal(source.unitCost ?? null)},'',1,'Y',${literal(plan.source.asOf)} WHERE ${applying}`);
    }
    for (const row of group.rows.filter((entry) => entry.stockId == null)) {
      const source = row.source;
      statements.push(`INSERT INTO part_warehouse_stock(part_id,warehouse_id,variant_key,core_type,quantity_on_hand,unit_of_measure,unit_cost,on_order,source_updated_at) SELECT ${partId},${row.warehouseId},${literal(row.variantKey)},${literal(source.coreType || null)},0,${literal(source.unitOfMeasure || null)},${literal(source.unitCost ?? part?.unit_cost ?? null)},0,${literal(plan.source.asOf)} WHERE ${applying}`);
    }
    for (const warehouse of group.warehouses) {
      const source = group.rows.find((row) => row.warehouseId === Number(warehouse.id) && own(row.source,'binLocation'))?.source;
      if (source) statements.push(`INSERT INTO part_warehouse_locations(part_id,warehouse_id,bin_location,source,source_updated_at) SELECT ${partId},${warehouse.id},${literal(source.binLocation)},'EMDECS',${literal(plan.source.asOf)} WHERE ${applying} ON CONFLICT(part_id,warehouse_id) DO UPDATE SET bin_location=excluded.bin_location,source=excluded.source,source_updated_at=excluded.source_updated_at,updated_at=CURRENT_TIMESTAMP`);
    }
    for (const row of group.rows) {
      const stockId = row.stockId == null ? `(SELECT id FROM part_warehouse_stock WHERE part_id=${partId} AND warehouse_id=${row.warehouseId} AND variant_key=${literal(row.variantKey)})` : String(row.stockId);
      const beforeStock = group.beforeStocks.find((stock) => Number(stock.id) === row.stockId) || null;
      const beforeBin = group.beforeBins.find((bin) => Number(bin.warehouse_id) === row.warehouseId) || null;
      const operationKey = literal(`${plan.importKey}:${inventoryImportHash(row.source.sourceRowId).slice(0,24)}`);
      const operationId = `(SELECT id FROM inventory_operations WHERE operation_key=${operationKey})`;
      const delta = row.source.quantity - Number(beforeStock?.quantity_on_hand || 0);
      statements.push(`INSERT INTO inventory_operations(operation_key,operation_type,note) SELECT ${operationKey},'source_inventory_snapshot',${literal(`EMDECS physical balance from import ${plan.importKey}; source row ${row.source.sourceRowId}`)} WHERE ${applying}`);
      statements.push(`UPDATE part_warehouse_stock SET quantity_on_hand=${row.source.quantity},source_updated_at=COALESCE(${literal(plan.source.asOf)},source_updated_at),updated_at=CURRENT_TIMESTAMP WHERE id=${stockId} AND part_id=${partId} AND warehouse_id=${row.warehouseId} AND ${applying}`);
      statements.push(`INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,unit_cost,line_type) SELECT ${operationId},${partId},${stockId},${row.warehouseId},${delta},(SELECT unit_cost FROM part_warehouse_stock WHERE id=${stockId}),'source_snapshot' WHERE ${applying}`);
      const tail = group.operationTail.find((entry) => Number(entry.warehouse_stock_id) === row.stockId);
      if (tail) statements.push(`INSERT INTO inventory_operation_dependencies(operation_id,depends_on_operation_id,reason) SELECT ${operationId},${tail.operation_id},'Authorized source snapshot followed this physical stock operation.' WHERE ${applying}`);
      statements.push(`INSERT INTO inventory_operation_commits(operation_id,applied) SELECT ${operationId},CASE WHEN EXISTS(SELECT 1 FROM inventory_operation_lines WHERE operation_id=${operationId} AND warehouse_stock_id=${stockId} AND quantity_delta=${delta}) AND (SELECT quantity_on_hand FROM part_warehouse_stock WHERE id=${stockId})=${row.source.quantity} THEN 1 ELSE 0 END WHERE ${applying}`);
      const before = { part, stock: beforeStock, bin: beforeBin };
      statements.push(`INSERT INTO inventory_source_import_rows(import_key,source_row_id,part_id,warehouse_id,warehouse_stock_id,operation_id,before_json,after_json,source_json) SELECT ${key},${literal(row.source.sourceRowId)},${partId},${row.warehouseId},${stockId},${operationId},${literal(canonicalJson(before))},'{}',${literal(canonicalJson(row.source))} WHERE ${applying}`);
    }
    statements.push(`UPDATE parts SET quantity_on_hand=COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id=${partId}),0),updated_at=CURRENT_TIMESTAMP WHERE id=${partId} AND ${applying}`);
    statements.push(`UPDATE inventory_source_import_rows SET after_json=json_object('part',json((SELECT ${jsonObject('p',PART_FIELDS)} FROM parts p WHERE p.id=inventory_source_import_rows.part_id)),'stock',json((SELECT ${jsonObject('s',STOCK_FIELDS)} FROM part_warehouse_stock s WHERE s.id=inventory_source_import_rows.warehouse_stock_id)),'bin',json((SELECT ${jsonObject('b',BIN_FIELDS)} FROM part_warehouse_locations b WHERE b.part_id=inventory_source_import_rows.part_id AND b.warehouse_id=inventory_source_import_rows.warehouse_id))) WHERE import_key=${key} AND part_id=${partId} AND ${applying}`);
    for (const row of group.rows) guard(`EXISTS(SELECT 1 FROM inventory_source_import_rows r JOIN part_warehouse_stock s ON s.id=r.warehouse_stock_id WHERE r.import_key=${key} AND r.source_row_id=${literal(row.source.sourceRowId)} AND s.quantity_on_hand=${row.source.quantity} AND r.after_json<>'{}')`);
  }
  guard(`(SELECT COUNT(*) FROM inventory_source_import_rows WHERE import_key=${key})=${plan.summary.sourceRows} AND (SELECT COUNT(DISTINCT part_id) FROM inventory_source_import_rows WHERE import_key=${key})=${plan.summary.parts}`);
  statements.push(`UPDATE inventory_source_imports SET status='applied',applied_at=CURRENT_TIMESTAMP WHERE import_key=${key} AND status='applying'`);
  const sql = `${statements.join(';\n')};\n`;
  if (statements.some((statement) => Buffer.byteLength(statement,'utf8') > 90000)) throw new Error('An import statement exceeds the conservative D1 query size bound.');
  return sql;
}
