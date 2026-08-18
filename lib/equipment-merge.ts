type EquipmentCoreRow = {
  id: number;
  unit: string;
  category: string;
  equipment_type: string;
  active: number;
  archived_at: string | null;
  archive_reason: string | null;
  merged_into_equipment_id: number | null;
  geotab_device_id: string | null;
  vin: string | null;
  current_mileage: number | null;
  mileage_updated_at: string | null;
  service_date: string | null;
  annual_date: string | null;
};

type ForeignKeyRow = {
  table_name: string;
  column_name: string;
};

type CurrentDeviceRow = {
  equipment_id: number;
  geotab_device_id: string;
};

type QueueCandidateRow = {
  geotab_device_id: string;
  candidate_equipment_ids: string | null;
};

type CountResult = { count: number };

type ReferenceDefinition = {
  key: string;
  table: string;
  column: string;
};

const MUTABLE_EQUIPMENT_REFERENCES: ReferenceDefinition[] = [
  { key: 'pmSettings', table: 'equipment_pm_settings', column: 'equipment_id' },
  { key: 'repairs', table: 'repairs', column: 'equipment_id' },
  { key: 'pmStatus', table: 'pm_status', column: 'equipment_id' },
  { key: 'annualSettings', table: 'equipment_annual_settings', column: 'equipment_id' },
  { key: 'expenses', table: 'unit_expenses', column: 'equipment_id' },
  { key: 'maintenanceEvents', table: 'maintenance_events', column: 'equipment_id' },
  { key: 'invoices', table: 'invoices', column: 'equipment_id' },
  { key: 'historicalRepairs', table: 'historical_repairs', column: 'equipment_id' },
  { key: 'historicalRepairLines', table: 'historical_repair_lines', column: 'equipment_id' },
  { key: 'partCompatibility', table: 'part_equipment', column: 'equipment_id' },
  { key: 'statusEvents', table: 'equipment_status_events', column: 'equipment_id' },
  { key: 'maintenanceActions', table: 'pm_next_repairs', column: 'equipment_id' },
  { key: 'checklistRuns', table: 'maintenance_checklist_runs', column: 'equipment_id' },
  { key: 'deviceAssignments', table: 'equipment_geotab_devices', column: 'equipment_id' },
  { key: 'resolvedIdentityReviews', table: 'geotab_reconciliation_queue', column: 'resolved_equipment_id' },
  { key: 'mileageAnomalies', table: 'geotab_mileage_anomalies', column: 'equipment_id' },
  { key: 'mergedChildren', table: 'equipment', column: 'merged_into_equipment_id' },
];

const EXPECTED_EQUIPMENT_FOREIGN_KEYS = new Set([
  ...MUTABLE_EQUIPMENT_REFERENCES.map((reference) => `${reference.table}.${reference.column}`),
  'equipment_merge_events.source_equipment_id',
  'equipment_merge_events.target_equipment_id',
]);

function positiveId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is invalid.`);
  return id;
}

function normalizedText(value: string | null) {
  return String(value ?? '').trim();
}

function normalizedVin(value: string | null) {
  return normalizedText(value).toUpperCase();
}

function parseCandidateIds(value: string | null) {
  if (!value) return [] as number[];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [] as number[];
    return parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [] as number[];
  }
}

async function assertKnownEquipmentForeignKeys(db: D1Database) {
  const result = await db.prepare(`
    SELECT m.name AS table_name, fk."from" AS column_name
    FROM sqlite_master m
    JOIN pragma_foreign_key_list(m.name) AS fk
    WHERE m.type = 'table'
      AND fk."table" = 'equipment'
    ORDER BY m.name, fk.id
  `).all<ForeignKeyRow>();

  const actual = new Set(result.results.map((row) => `${row.table_name}.${row.column_name}`));
  const unexpected = [...actual].filter((reference) => !EXPECTED_EQUIPMENT_FOREIGN_KEYS.has(reference));
  const missing = [...EXPECTED_EQUIPMENT_FOREIGN_KEYS].filter((reference) => !actual.has(reference));
  if (unexpected.length || missing.length) {
    console.error(JSON.stringify({
      event: 'equipment_merge_schema_guard_failed',
      unexpected,
      missing,
    }));
    const detail = [
      unexpected.length ? `unknown references: ${unexpected.join(', ')}` : '',
      missing.length ? `expected references missing: ${missing.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Equipment merge stopped because the database relationship map changed (${detail}).`);
  }
}

async function loadEquipmentCore(db: D1Database, id: number) {
  return db.prepare(`
    SELECT id, unit, category, equipment_type, active, archived_at, archive_reason,
           merged_into_equipment_id, geotab_device_id, vin, current_mileage,
           mileage_updated_at, service_date, annual_date
    FROM equipment
    WHERE id = ?
  `).bind(id).first<EquipmentCoreRow>();
}

async function referenceCounts(db: D1Database, equipmentId: number) {
  const statements = MUTABLE_EQUIPMENT_REFERENCES.map((reference) =>
    db.prepare(`SELECT COUNT(*) AS count FROM ${reference.table} WHERE ${reference.column} = ?`).bind(equipmentId),
  );
  statements.push(
    db.prepare('SELECT COUNT(*) AS count FROM equipment_merge_events WHERE target_equipment_id = ?').bind(equipmentId),
  );
  const results = await db.batch<CountResult>(statements);
  const counts: Record<string, number> = {};
  MUTABLE_EQUIPMENT_REFERENCES.forEach((reference, index) => {
    counts[reference.key] = Number(results[index]?.results?.[0]?.count ?? 0);
  });
  counts.priorMergeEvents = Number(results[MUTABLE_EQUIPMENT_REFERENCES.length]?.results?.[0]?.count ?? 0);
  return counts;
}

function nonZeroReferenceCount(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
}

export async function previewEquipmentMerge(db: D1Database, sourceValue: unknown, targetValue: unknown) {
  const sourceId = positiveId(sourceValue, 'Duplicate equipment');
  const targetId = positiveId(targetValue, 'Canonical equipment');
  if (sourceId === targetId) throw new Error('Choose two different equipment records.');

  await assertKnownEquipmentForeignKeys(db);
  const [source, target, sourceSnapshot, targetSnapshot, currentDevices, sourceCounts, targetCounts] = await Promise.all([
    loadEquipmentCore(db, sourceId),
    loadEquipmentCore(db, targetId),
    db.prepare('SELECT * FROM equipment WHERE id = ?').bind(sourceId).first<Record<string, unknown>>(),
    db.prepare('SELECT * FROM equipment WHERE id = ?').bind(targetId).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT equipment_id, geotab_device_id
      FROM equipment_geotab_devices
      WHERE current = 1 AND equipment_id IN (?, ?)
      ORDER BY equipment_id
    `).bind(sourceId, targetId).all<CurrentDeviceRow>(),
    referenceCounts(db, sourceId),
    referenceCounts(db, targetId),
  ]);

  if (!source || !sourceSnapshot) throw new Error('Duplicate equipment record was not found.');
  if (!target || !targetSnapshot) throw new Error('Canonical equipment record was not found.');

  const blockers: string[] = [];
  const warnings: string[] = [];
  const sourceDevice = normalizedText(source.geotab_device_id);
  const targetDevice = normalizedText(target.geotab_device_id);
  const sourceVin = normalizedVin(source.vin);
  const targetVin = normalizedVin(target.vin);

  if (source.merged_into_equipment_id != null) blockers.push(`${source.unit} was already merged into equipment #${source.merged_into_equipment_id}.`);
  if (target.merged_into_equipment_id != null) blockers.push(`${target.unit} is itself a merged tombstone and cannot be canonical.`);
  if (target.archived_at) blockers.push(`${target.unit} is archived. Restore/resolve the canonical row before merging history into it.`);
  if (!sourceDevice || !targetDevice || sourceDevice !== targetDevice) {
    blockers.push('Historical Geotab fork merges require both rows to carry the same non-empty Geotab device ID.');
  }
  if (sourceVin && targetVin && sourceVin !== targetVin) {
    blockers.push(`VIN conflict: ${source.unit} has ${sourceVin} while ${target.unit} has ${targetVin}. Resolve identity before merging history.`);
  }

  const deviceAssignments = currentDevices.results;
  if (deviceAssignments.length > 1) {
    blockers.push('Both equipment rows have current Geotab device assignments. Resolve the live hardware assignment before merging history.');
  }

  if (source.equipment_type !== target.equipment_type) {
    warnings.push(`Equipment types differ (${source.equipment_type} → ${target.equipment_type}); the canonical type will be kept.`);
  }
  if (source.current_mileage != null && target.current_mileage != null) {
    const delta = Math.abs(Number(source.current_mileage) - Number(target.current_mileage));
    if (delta >= 500) warnings.push(`Mileage differs by ${delta.toLocaleString()} mi; the canonical trusted mileage will be kept.`);
  }
  if (sourceCounts.pmSettings && targetCounts.pmSettings) warnings.push('Both rows have PM settings; canonical settings win and missing intervals are filled from the duplicate.');
  if (sourceCounts.pmStatus && targetCounts.pmStatus) warnings.push('Both rows have PM status; latest dates/highest PM mileage are consolidated into the canonical row.');
  if (sourceCounts.annualSettings && targetCounts.annualSettings) warnings.push('Both rows have annual settings; canonical interval is retained and active state is preserved.');

  return {
    source,
    target,
    sourceSnapshot,
    targetSnapshot,
    sourceCounts,
    targetCounts,
    referencesToMove: nonZeroReferenceCount(sourceCounts),
    blockers,
    warnings,
    currentDeviceAssignment: deviceAssignments[0] ?? null,
  };
}

export async function mergeEquipmentFork(
  db: D1Database,
  sourceValue: unknown,
  targetValue: unknown,
  userId: number,
  noteValue: unknown,
) {
  const preview = await previewEquipmentMerge(db, sourceValue, targetValue);
  if (preview.blockers.length) throw new Error(preview.blockers.join(' '));

  const sourceId = preview.source.id;
  const targetId = preview.target.id;
  const note = String(noteValue ?? '').trim().slice(0, 1000) || null;
  const openQueue = await db.prepare(`
    SELECT geotab_device_id, candidate_equipment_ids
    FROM geotab_reconciliation_queue
    WHERE status = 'open' AND candidate_equipment_ids IS NOT NULL
  `).all<QueueCandidateRow>();

  const queueCandidateUpdates: D1PreparedStatement[] = [];
  for (const row of openQueue.results) {
    const ids = parseCandidateIds(row.candidate_equipment_ids);
    if (!ids.includes(sourceId)) continue;
    const replaced = [...new Set(ids.map((id) => id === sourceId ? targetId : id))];
    queueCandidateUpdates.push(db.prepare(`
      UPDATE geotab_reconciliation_queue
      SET candidate_equipment_ids = ?, last_seen_at = last_seen_at
      WHERE geotab_device_id = ? AND status = 'open'
    `).bind(JSON.stringify(replaced), row.geotab_device_id));
  }

  const statements: D1PreparedStatement[] = [
    // The UNIQUE source_equipment_id makes the merge idempotent/concurrency-safe:
    // a competing merge of the same duplicate aborts this whole D1 batch.
    db.prepare(`
      INSERT INTO equipment_merge_events (
        source_equipment_id, target_equipment_id, source_unit, target_unit,
        source_geotab_device_id, target_geotab_device_id, source_vin, target_vin,
        source_snapshot_json, target_snapshot_json, reference_counts_json,
        merged_by_user_id, merge_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sourceId,
      targetId,
      preview.source.unit,
      preview.target.unit,
      preview.source.geotab_device_id,
      preview.target.geotab_device_id,
      preview.source.vin,
      preview.target.vin,
      JSON.stringify(preview.sourceSnapshot),
      JSON.stringify(preview.targetSnapshot),
      JSON.stringify(preview.sourceCounts),
      userId,
      note,
    ),

    // Keep the chosen canonical row authoritative. Only fill missing durable
    // metadata from the duplicate; PM/annual baselines are consolidated below.
    db.prepare(`
      UPDATE equipment
      SET vin = COALESCE(NULLIF(TRIM(vin), ''), (SELECT NULLIF(TRIM(vin), '') FROM equipment WHERE id = ?)),
          license_plate = COALESCE(NULLIF(TRIM(license_plate), ''), (SELECT NULLIF(TRIM(license_plate), '') FROM equipment WHERE id = ?)),
          license_state = COALESCE(NULLIF(TRIM(license_state), ''), (SELECT NULLIF(TRIM(license_state), '') FROM equipment WHERE id = ?)),
          model_year = COALESCE(model_year, (SELECT model_year FROM equipment WHERE id = ?)),
          make = COALESCE(NULLIF(TRIM(make), ''), (SELECT NULLIF(TRIM(make), '') FROM equipment WHERE id = ?)),
          model = COALESCE(NULLIF(TRIM(model), ''), (SELECT NULLIF(TRIM(model), '') FROM equipment WHERE id = ?)),
          engine = COALESCE(NULLIF(TRIM(engine), ''), (SELECT NULLIF(TRIM(engine), '') FROM equipment WHERE id = ?)),
          purchase_date = COALESCE(purchase_date, (SELECT purchase_date FROM equipment WHERE id = ?)),
          purchase_price = COALESCE(purchase_price, (SELECT purchase_price FROM equipment WHERE id = ?)),
          purchased_from = COALESCE(NULLIF(TRIM(purchased_from), ''), (SELECT NULLIF(TRIM(purchased_from), '') FROM equipment WHERE id = ?)),
          in_service_date = COALESCE(in_service_date, (SELECT in_service_date FROM equipment WHERE id = ?)),
          acquisition_mileage = COALESCE(acquisition_mileage, (SELECT acquisition_mileage FROM equipment WHERE id = ?)),
          expected_residual_value = COALESCE(expected_residual_value, (SELECT expected_residual_value FROM equipment WHERE id = ?)),
          retired_date = COALESCE(retired_date, (SELECT retired_date FROM equipment WHERE id = ?)),
          current_mileage = COALESCE(current_mileage, (SELECT current_mileage FROM equipment WHERE id = ?)),
          mileage_updated_at = CASE
            WHEN current_mileage IS NULL AND (SELECT current_mileage FROM equipment WHERE id = ?) IS NOT NULL
              THEN (SELECT mileage_updated_at FROM equipment WHERE id = ?)
            ELSE mileage_updated_at
          END,
          service_date = CASE
            WHEN COALESCE((SELECT service_date FROM equipment WHERE id = ?), '') > COALESCE(service_date, '')
              THEN (SELECT service_date FROM equipment WHERE id = ?)
            ELSE service_date
          END,
          annual_date = CASE
            WHEN COALESCE((SELECT annual_date FROM equipment WHERE id = ?), '') > COALESCE(annual_date, '')
              THEN (SELECT annual_date FROM equipment WHERE id = ?)
            ELSE annual_date
          END,
          out_of_service_reason = CASE
            WHEN out_of_service = 1 THEN out_of_service_reason
            WHEN COALESCE((SELECT out_of_service FROM equipment WHERE id = ?), 0) = 1
              THEN (SELECT out_of_service_reason FROM equipment WHERE id = ?)
            ELSE out_of_service_reason
          END,
          out_of_service_at = CASE
            WHEN out_of_service = 1 THEN out_of_service_at
            WHEN COALESCE((SELECT out_of_service FROM equipment WHERE id = ?), 0) = 1
              THEN (SELECT out_of_service_at FROM equipment WHERE id = ?)
            ELSE out_of_service_at
          END,
          out_of_service = CASE
            WHEN out_of_service = 1 OR COALESCE((SELECT out_of_service FROM equipment WHERE id = ?), 0) = 1 THEN 1
            ELSE 0
          END,
          active = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND archived_at IS NULL AND merged_into_equipment_id IS NULL
    `).bind(
      sourceId, sourceId, sourceId, sourceId, sourceId, sourceId, sourceId,
      sourceId, sourceId, sourceId, sourceId, sourceId, sourceId, sourceId,
      sourceId, sourceId, sourceId,
      sourceId, sourceId,
      sourceId, sourceId,
      sourceId, sourceId,
      sourceId, sourceId,
      sourceId,
      targetId,
    ),

    // One-to-one PM settings: canonical row wins; source fills blanks only.
    db.prepare(`
      UPDATE equipment_pm_settings
      SET mileage_interval = COALESCE(mileage_interval, (SELECT mileage_interval FROM equipment_pm_settings WHERE equipment_id = ?)),
          time_interval_days = COALESCE(time_interval_days, (SELECT time_interval_days FROM equipment_pm_settings WHERE equipment_id = ?)),
          annual_required = CASE
            WHEN annual_required = 1 OR COALESCE((SELECT annual_required FROM equipment_pm_settings WHERE equipment_id = ?), 0) = 1 THEN 1
            ELSE 0
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE equipment_id = ? AND EXISTS (SELECT 1 FROM equipment_pm_settings WHERE equipment_id = ?)
    `).bind(sourceId, sourceId, sourceId, targetId, sourceId),
    db.prepare(`
      DELETE FROM equipment_pm_settings
      WHERE equipment_id = ? AND EXISTS (SELECT 1 FROM equipment_pm_settings WHERE equipment_id = ?)
    `).bind(sourceId, targetId),
    db.prepare('UPDATE equipment_pm_settings SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?')
      .bind(targetId, sourceId),

    // Current PM status: preserve the newest dates and highest cumulative mileage.
    db.prepare(`
      UPDATE pm_status
      SET pm_type = CASE
            WHEN COALESCE((SELECT updated_at FROM pm_status WHERE equipment_id = ?), '') > COALESCE(updated_at, '')
              THEN COALESCE((SELECT pm_type FROM pm_status WHERE equipment_id = ?), pm_type)
            ELSE pm_type
          END,
          status = CASE
            WHEN COALESCE((SELECT updated_at FROM pm_status WHERE equipment_id = ?), '') > COALESCE(updated_at, '')
              THEN COALESCE((SELECT status FROM pm_status WHERE equipment_id = ?), status)
            ELSE status
          END,
          last_mileage = CASE
            WHEN last_mileage IS NULL THEN (SELECT last_mileage FROM pm_status WHERE equipment_id = ?)
            WHEN (SELECT last_mileage FROM pm_status WHERE equipment_id = ?) IS NULL THEN last_mileage
            WHEN (SELECT last_mileage FROM pm_status WHERE equipment_id = ?) > last_mileage
              THEN (SELECT last_mileage FROM pm_status WHERE equipment_id = ?)
            ELSE last_mileage
          END,
          service_date = CASE
            WHEN COALESCE((SELECT service_date FROM pm_status WHERE equipment_id = ?), '') > COALESCE(service_date, '')
              THEN (SELECT service_date FROM pm_status WHERE equipment_id = ?)
            ELSE service_date
          END,
          annual_date = CASE
            WHEN COALESCE((SELECT annual_date FROM pm_status WHERE equipment_id = ?), '') > COALESCE(annual_date, '')
              THEN (SELECT annual_date FROM pm_status WHERE equipment_id = ?)
            ELSE annual_date
          END,
          notes = CASE
            WHEN TRIM(COALESCE(notes, '')) = '' THEN (SELECT notes FROM pm_status WHERE equipment_id = ?)
            ELSE notes
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE equipment_id = ? AND EXISTS (SELECT 1 FROM pm_status WHERE equipment_id = ?)
    `).bind(
      sourceId, sourceId, sourceId, sourceId,
      sourceId, sourceId, sourceId, sourceId,
      sourceId, sourceId, sourceId, sourceId, sourceId,
      targetId, sourceId,
    ),
    db.prepare('DELETE FROM pm_status WHERE equipment_id = ? AND EXISTS (SELECT 1 FROM pm_status WHERE equipment_id = ?)')
      .bind(sourceId, targetId),
    db.prepare('UPDATE pm_status SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?')
      .bind(targetId, sourceId),

    // Annual settings are also one-to-one. Keep canonical interval; preserve an
    // active setting if either historical row had it active.
    db.prepare(`
      UPDATE equipment_annual_settings
      SET active = CASE
            WHEN active = 1 OR COALESCE((SELECT active FROM equipment_annual_settings WHERE equipment_id = ?), 0) = 1 THEN 1
            ELSE 0
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE equipment_id = ? AND EXISTS (SELECT 1 FROM equipment_annual_settings WHERE equipment_id = ?)
    `).bind(sourceId, targetId, sourceId),
    db.prepare(`
      DELETE FROM equipment_annual_settings
      WHERE equipment_id = ? AND EXISTS (SELECT 1 FROM equipment_annual_settings WHERE equipment_id = ?)
    `).bind(sourceId, targetId),
    db.prepare('UPDATE equipment_annual_settings SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?')
      .bind(targetId, sourceId),

    // Maintenance-event uniqueness includes equipment_id. Fold exact duplicate
    // events before moving the remaining history to the canonical row.
    db.prepare(`
      UPDATE maintenance_events
      SET mileage = COALESCE(mileage, (
            SELECT s.mileage FROM maintenance_events s
            WHERE s.equipment_id = ?
              AND s.event_type = maintenance_events.event_type
              AND s.event_date = maintenance_events.event_date
              AND s.source = maintenance_events.source
            LIMIT 1
          )),
          notes = CASE WHEN TRIM(COALESCE(notes, '')) = '' THEN (
            SELECT s.notes FROM maintenance_events s
            WHERE s.equipment_id = ?
              AND s.event_type = maintenance_events.event_type
              AND s.event_date = maintenance_events.event_date
              AND s.source = maintenance_events.source
            LIMIT 1
          ) ELSE notes END
      WHERE equipment_id = ?
        AND EXISTS (
          SELECT 1 FROM maintenance_events s
          WHERE s.equipment_id = ?
            AND s.event_type = maintenance_events.event_type
            AND s.event_date = maintenance_events.event_date
            AND s.source = maintenance_events.source
        )
    `).bind(sourceId, sourceId, targetId, sourceId),
    db.prepare(`
      DELETE FROM maintenance_events
      WHERE equipment_id = ?
        AND EXISTS (
          SELECT 1 FROM maintenance_events t
          WHERE t.equipment_id = ?
            AND t.event_type = maintenance_events.event_type
            AND t.event_date = maintenance_events.event_date
            AND t.source = maintenance_events.source
        )
    `).bind(sourceId, targetId),
    db.prepare('UPDATE maintenance_events SET equipment_id = ? WHERE equipment_id = ?').bind(targetId, sourceId),

    // Part compatibility uses (part_id, equipment_id) as its primary key.
    db.prepare(`
      INSERT OR IGNORE INTO part_equipment (part_id, equipment_id, created_at)
      SELECT part_id, ?, created_at FROM part_equipment WHERE equipment_id = ?
    `).bind(targetId, sourceId),
    db.prepare('DELETE FROM part_equipment WHERE equipment_id = ?').bind(sourceId),

    // Pending anomaly uniqueness can collide after the equipment ID changes.
    // Preserve the source audit row by dismissing only the exact duplicate before
    // relinking all anomaly history to the canonical unit.
    db.prepare(`
      UPDATE geotab_mileage_anomalies
      SET status = 'dismissed',
          reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
          review_note = COALESCE(review_note, 'Duplicate anomaly retired during equipment history merge')
      WHERE equipment_id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM geotab_mileage_anomalies t
          WHERE t.equipment_id = ?
            AND t.status = 'pending'
            AND t.geotab_device_id = geotab_mileage_anomalies.geotab_device_id
            AND t.incoming_mileage = geotab_mileage_anomalies.incoming_mileage
        )
    `).bind(sourceId, targetId),
    db.prepare('UPDATE geotab_mileage_anomalies SET equipment_id = ? WHERE equipment_id = ?').bind(targetId, sourceId),

    // References with no equipment-specific uniqueness can move directly.
    db.prepare('UPDATE repairs SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE unit_expenses SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE invoices SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE historical_repairs SET equipment_id = ? WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE historical_repair_lines SET equipment_id = ? WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE equipment_status_events SET equipment_id = ? WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE pm_next_repairs SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE maintenance_checklist_runs SET equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE geotab_reconciliation_queue SET resolved_equipment_id = ? WHERE resolved_equipment_id = ?').bind(targetId, sourceId),
    db.prepare('UPDATE equipment_geotab_devices SET equipment_id = ? WHERE equipment_id = ?').bind(targetId, sourceId),

    // Flatten prior merged tombstones that pointed at this source canonical row.
    db.prepare('UPDATE equipment SET merged_into_equipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE merged_into_equipment_id = ?')
      .bind(targetId, sourceId),
    ...queueCandidateUpdates,

    // Retire the duplicate but retain its identity snapshot and original unit/VIN
    // on the tombstone for audit. Geotab sync explicitly ignores merged rows.
    db.prepare(`
      UPDATE equipment
      SET active = 0,
          archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
          archive_reason = ?,
          merged_into_equipment_id = ?,
          merged_at = CURRENT_TIMESTAMP,
          merged_by_user_id = ?,
          merge_note = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND merged_into_equipment_id IS NULL
    `).bind(`Merged into ${preview.target.unit} (#${targetId})`, targetId, userId, note, sourceId),
  ];

  await db.batch(statements);

  const [sourceAfter, targetAfter] = await Promise.all([
    loadEquipmentCore(db, sourceId),
    loadEquipmentCore(db, targetId),
  ]);
  if (!sourceAfter || sourceAfter.merged_into_equipment_id !== targetId || !targetAfter || targetAfter.archived_at) {
    throw new Error('Equipment merge verification failed after the transaction.');
  }

  console.log(JSON.stringify({
    event: 'equipment_history_merge_completed',
    sourceEquipmentId: sourceId,
    targetEquipmentId: targetId,
    referencesMoved: preview.referencesToMove,
    mergedByUserId: userId,
  }));

  return {
    ok: true,
    sourceEquipmentId: sourceId,
    targetEquipmentId: targetId,
    sourceUnit: preview.source.unit,
    targetUnit: preview.target.unit,
    referenceCounts: preview.sourceCounts,
    referencesMoved: preview.referencesToMove,
    warnings: preview.warnings,
  };
}
