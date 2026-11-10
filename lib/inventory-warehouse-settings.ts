type SettingsRow = {
  part_id: number;
  part_number: string;
  description: string;
  default_minimum: number;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  bin_id: number | null;
  bin_location: string | null;
  bin_source: string | null;
  bin_source_updated_at: string | null;
  bin_updated_at: string | null;
  minimum_quantity: number | null;
  minimum_updated_at: string | null;
  last_settings_operation_id: number;
};

type SavedOperation = {
  id: number;
  operation_type: string;
  status: string;
  user_id: number | null;
  note: string | null;
  applied: number | null;
};

export class WarehouseSettingsError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'WarehouseSettingsError';
  }
}

function scope(partValue: unknown, warehouseValue: unknown) {
  const partId = typeof partValue === 'number' || typeof partValue === 'string' ? Number(partValue) : NaN;
  const warehouseCode = typeof warehouseValue === 'string' ? warehouseValue.trim().toUpperCase() : '';
  if (!Number.isSafeInteger(partId) || partId <= 0 || !warehouseCode || warehouseCode.length > 64 || warehouseCode === 'ALL') {
    throw new WarehouseSettingsError('Choose a part and a specific warehouse.');
  }
  return { partId, warehouseCode };
}

function normalizeBins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new WarehouseSettingsError('Provide up to 64 bin locations.');
  const bins: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 512 || /[\r\n\u0000]/.test(item)) {
      throw new WarehouseSettingsError('Enter each bin on its own line, using 512 characters or fewer.');
    }
    const bin = item.trim();
    if (bin && !bins.includes(bin)) bins.push(bin);
  }
  if (bins.join('\n').length > 16384) throw new WarehouseSettingsError('The bin locations are too long.');
  return bins;
}

function normalizeMinimum(value: unknown): number | null {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new WarehouseSettingsError('Minimum stock must be a number, or blank to use the part default.');
  const minimum = Number(value);
  if (!Number.isFinite(minimum) || minimum < 0) throw new WarehouseSettingsError('Minimum stock must be zero or greater.');
  return minimum;
}

function splitBins(value: string | null) {
  return [...new Set(String(value ?? '').split(/\r?\n/).map((bin) => bin.trim()).filter(Boolean))];
}

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const lastSettingsOperation = `(SELECT COALESCE(MAX(l.operation_id),0)
  FROM inventory_operation_lines l
  WHERE l.part_id=p.id AND l.warehouse_id=w.id AND l.line_type='warehouse_settings')`;

async function readSettings(db: D1Database, partId: number, warehouseCode: string) {
  return db.prepare(`
    SELECT p.id AS part_id,p.part_number,p.description,p.reorder_level AS default_minimum,
           w.id AS warehouse_id,w.code AS warehouse_code,w.name AS warehouse_name,
           b.id AS bin_id,b.bin_location,b.source AS bin_source,
           b.source_updated_at AS bin_source_updated_at,b.updated_at AS bin_updated_at,
           m.minimum_quantity,m.updated_at AS minimum_updated_at,
           ${lastSettingsOperation} AS last_settings_operation_id
    FROM parts p CROSS JOIN warehouses w
    LEFT JOIN part_warehouse_locations b ON b.part_id=p.id AND b.warehouse_id=w.id
    LEFT JOIN part_warehouse_minimums m ON m.part_id=p.id AND m.warehouse_id=w.id
    WHERE p.id=? AND p.active=1 AND p.deleted_at IS NULL AND w.code=? AND w.active=1
      AND EXISTS(SELECT 1 FROM part_warehouse_stock s WHERE s.part_id=p.id AND s.warehouse_id=w.id)
  `).bind(partId, warehouseCode).first<SettingsRow>();
}

async function version(row: SettingsRow) {
  return `settings:${await digest([
    row.part_id,row.warehouse_id,row.default_minimum,row.bin_id,row.bin_location,
    row.bin_source,row.bin_source_updated_at,row.bin_updated_at,
    row.minimum_quantity,row.minimum_updated_at,row.last_settings_operation_id,
  ])}`;
}

export async function getWarehousePartSettings(db: D1Database, partValue: unknown, warehouseValue: unknown) {
  const { partId, warehouseCode } = scope(partValue, warehouseValue);
  const row = await readSettings(db, partId, warehouseCode);
  if (!row) throw new WarehouseSettingsError('That active part is not stocked in the selected active warehouse.');
  const options = await db.prepare(`
    SELECT DISTINCT b.bin_location FROM part_warehouse_locations b
    JOIN parts p ON p.id=b.part_id
    WHERE b.warehouse_id=? AND p.active=1 AND p.deleted_at IS NULL AND trim(b.bin_location)<>''
      AND EXISTS(SELECT 1 FROM part_warehouse_stock s WHERE s.part_id=b.part_id AND s.warehouse_id=b.warehouse_id)
  `).bind(row.warehouse_id).all<{bin_location: string}>();
  const binOptions = [...new Set(options.results.flatMap((item) => splitBins(item.bin_location)))];
  binOptions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    ok: true,
    partId: row.part_id,
    partNumber: row.part_number,
    description: row.description,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    binLocation: row.bin_location ?? '',
    binLocations: splitBins(row.bin_location),
    minimumQuantity: row.minimum_quantity,
    defaultMinimum: Number(row.default_minimum),
    settingsVersion: await version(row),
    binOptions,
  };
}

async function savedOperation(db: D1Database, key: string) {
  return db.prepare(`
    SELECT o.id,o.operation_type,o.status,o.user_id,o.note,c.applied
    FROM inventory_operations o LEFT JOIN inventory_operation_commits c ON c.operation_id=o.id
    WHERE o.operation_key=?
  `).bind(key).first<SavedOperation>();
}

export async function saveWarehousePartSettings(db: D1Database, input: Record<string, unknown>, userId: number) {
  const { partId, warehouseCode } = scope(input.partId, input.warehouseCode);
  const binLocations = normalizeBins(input.binLocations);
  const binLocation = binLocations.join('\n');
  const minimumQuantity = normalizeMinimum(input.minimumQuantity);
  const settingsVersion = typeof input.settingsVersion === 'string' ? input.settingsVersion : '';
  const operationKey = typeof input.operationKey === 'string' ? input.operationKey.trim() : '';
  if (!/^settings:[a-f0-9]{64}$/.test(settingsVersion)) throw new WarehouseSettingsError('Reload the warehouse settings before saving.');
  if (!/^warehouse-settings:[A-Za-z0-9._:-]{1,120}$/.test(operationKey)) throw new WarehouseSettingsError('A warehouse settings save key is required.');
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new WarehouseSettingsError('Authentication required.', 401);
  const requestHash = await digest({partId,warehouseCode,binLocations,minimumQuantity,settingsVersion});

  async function replay(operation: SavedOperation) {
    let note: {requestHash?: string} = {};
    try { note = JSON.parse(operation.note ?? '{}') as {requestHash?: string}; } catch { /* Reject unrelated operations. */ }
    if (operation.operation_type !== 'warehouse_settings' || operation.status !== 'applied'
        || operation.applied !== 1 || operation.user_id !== userId || note.requestHash !== requestHash) {
      throw new WarehouseSettingsError('This save key was already used for a different update. Reload and try again.', 409);
    }
    return {ok: true, idempotent: true, operationId: operation.id, settings: await getWarehousePartSettings(db, partId, warehouseCode)};
  }

  const prior = await savedOperation(db, operationKey);
  if (prior) return replay(prior);
  const before = await readSettings(db, partId, warehouseCode);
  if (!before) throw new WarehouseSettingsError('That active part is not stocked in the selected active warehouse.');
  if (await version(before) !== settingsVersion) throw new WarehouseSettingsError('Bin locations or minimum stock changed while you were editing. Reload this warehouse before saving.', 409);

  // The guard is evaluated inside the same D1 batch as both settings updates.
  // A stale guard produces no audit line; the final commit CHECK then rolls back
  // the entire batch. No stock quantity or other warehouse setting is written.
  const guard = `EXISTS(
    SELECT 1 FROM parts p CROSS JOIN warehouses w
    LEFT JOIN part_warehouse_locations b ON b.part_id=p.id AND b.warehouse_id=w.id
    LEFT JOIN part_warehouse_minimums m ON m.part_id=p.id AND m.warehouse_id=w.id
    WHERE p.id=? AND p.active=1 AND p.deleted_at IS NULL AND w.id=? AND w.active=1 AND w.code=?
      AND p.reorder_level IS ? AND b.id IS ? AND b.bin_location IS ? AND b.source IS ?
      AND b.source_updated_at IS ? AND b.updated_at IS ?
      AND m.minimum_quantity IS ? AND m.updated_at IS ?
      AND ${lastSettingsOperation}=?
      AND EXISTS(SELECT 1 FROM part_warehouse_stock s WHERE s.part_id=p.id AND s.warehouse_id=w.id)
  )`;
  const auditExists = `EXISTS(SELECT 1 FROM inventory_operation_lines l JOIN inventory_operations o ON o.id=l.operation_id
    WHERE o.operation_key=? AND l.line_type='warehouse_settings' AND l.part_id=? AND l.warehouse_id=?)`;
  const auditArgs = [operationKey,partId,before.warehouse_id] as const;
  const note = JSON.stringify({requestHash,partId,warehouseCode,settingsVersion,
    before:{binLocation:before.bin_location,minimumQuantity:before.minimum_quantity,binSource:before.bin_source,binSourceUpdatedAt:before.bin_source_updated_at},
    after:{binLocation,minimumQuantity}});
  const statements = [
    db.prepare(`INSERT INTO inventory_operations(operation_key,operation_type,user_id,note) VALUES(?,'warehouse_settings',?,?)`)
      .bind(operationKey,userId,note),
    db.prepare(`INSERT INTO inventory_operation_lines(operation_id,part_id,warehouse_id,quantity_delta,line_type)
      SELECT id,?,?,0,'warehouse_settings' FROM inventory_operations WHERE operation_key=? AND ${guard}`)
      .bind(partId,before.warehouse_id,operationKey,partId,before.warehouse_id,warehouseCode,
        before.default_minimum,before.bin_id,before.bin_location,before.bin_source,before.bin_source_updated_at,before.bin_updated_at,
        before.minimum_quantity,before.minimum_updated_at,before.last_settings_operation_id),
  ];
  if (binLocation !== (before.bin_location ?? '')) {
    statements.push(db.prepare(`INSERT INTO part_warehouse_locations(part_id,warehouse_id,bin_location,source,source_updated_at,updated_at)
      SELECT ?,?,?,'manual',NULL,CURRENT_TIMESTAMP WHERE ${auditExists}
      ON CONFLICT(part_id,warehouse_id) DO UPDATE SET bin_location=excluded.bin_location,source='manual',source_updated_at=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(partId,before.warehouse_id,binLocation,...auditArgs));
  }
  if (minimumQuantity !== before.minimum_quantity) {
    statements.push(minimumQuantity === null
      ? db.prepare(`DELETE FROM part_warehouse_minimums WHERE part_id=? AND warehouse_id=? AND ${auditExists}`)
        .bind(partId,before.warehouse_id,...auditArgs)
      : db.prepare(`INSERT INTO part_warehouse_minimums(part_id,warehouse_id,minimum_quantity,updated_at)
          SELECT ?,?,?,CURRENT_TIMESTAMP WHERE ${auditExists}
          ON CONFLICT(part_id,warehouse_id) DO UPDATE SET minimum_quantity=excluded.minimum_quantity,updated_at=CURRENT_TIMESTAMP`)
        .bind(partId,before.warehouse_id,minimumQuantity,...auditArgs));
  }
  statements.push(db.prepare(`INSERT INTO inventory_operation_commits(operation_id,applied)
    SELECT id,CASE WHEN ${auditExists}
      AND COALESCE((SELECT bin_location FROM part_warehouse_locations WHERE part_id=? AND warehouse_id=?),'')=?
      AND (SELECT minimum_quantity FROM part_warehouse_minimums WHERE part_id=? AND warehouse_id=?) IS ?
    THEN 1 ELSE 0 END FROM inventory_operations WHERE operation_key=?`)
    .bind(...auditArgs,partId,before.warehouse_id,binLocation,partId,before.warehouse_id,minimumQuantity,operationKey));
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await savedOperation(db, operationKey);
    if (concurrent) return replay(concurrent);
    const current = await readSettings(db, partId, warehouseCode);
    if (!current || await version(current) !== settingsVersion) {
      throw new WarehouseSettingsError('Warehouse settings changed before this save completed. Reload this warehouse and try again.', 409);
    }
    throw error;
  }
  const applied = await savedOperation(db, operationKey);
  if (!applied || applied.applied !== 1) throw new Error('Warehouse settings operation did not commit.');
  return {ok: true, idempotent: false, operationId: applied.id, settings: await getWarehousePartSettings(db, partId, warehouseCode)};
}
