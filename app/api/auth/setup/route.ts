import { env } from 'cloudflare:workers';
import {
  appUserCount,
  createSession,
  hashPassword,
  normalizeEmail,
  secureTokenEqual,
  sessionCookie,
} from '@/lib/auth';

type AuthEnv = typeof env & { AUTH_BOOTSTRAP_TOKEN?: string };
type PmImportReceipt = {
  pm_events: number;
  resolved_units: number;
  pm_40: number;
  pm_20a: number;
  pm_20b: number;
  future_repairs: number;
  unresolved_events: number;
  applied_at: string;
};
type WorkingManagerLinks = { linked: number };
type WorkingManagerReceipt = { applied_at: string };

const RELEASE = '2026-08-18-working-managers-0078';

async function deploymentHealth(db: D1Database) {
  const empty = {
    '0059': false,
    '0060': false,
    '0061': false,
    '0062': false,
    '0063': false,
    '0064': false,
    '0065': false,
    '0077': false,
    '0078': false,
  };
  try {
    const [
      repairColumns,
      dvirColumns,
      assignmentColumns,
      reconciliationColumns,
      anomalyColumns,
      equipmentColumns,
      objects,
      pmImportReceipt,
      workingManagerLinks,
      workingManagerReceipt,
    ] = await Promise.all([
      db.prepare(`SELECT name FROM pragma_table_info('repairs')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('dvir_defects')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('equipment_geotab_devices')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('geotab_reconciliation_queue')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('geotab_mileage_anomalies')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('equipment')`).all<{ name: string }>(),
      db.prepare(`
        SELECT type, name
        FROM sqlite_master
        WHERE name IN (
          'unmatched_part_requests',
          'trg_geotab_truck_require_archive_state',
          'trg_dvir_keep_local_repair',
          'trg_dvir_keep_local_repair_row',
          'equipment_geotab_devices',
          'geotab_reconciliation_queue',
          'geotab_mileage_anomalies',
          'idx_equipment_geotab_devices_current_device',
          'idx_equipment_geotab_devices_current_equipment',
          'idx_geotab_device_assignments_review',
          'idx_geotab_reconciliation_resolved_by',
          'idx_geotab_mileage_reviewed_by',
          'equipment_merge_events',
          'idx_equipment_merged_into',
          'idx_equipment_merge_events_target',
          'trg_equipment_sanitize_merged_identity',
          'trg_equipment_keep_merged_identity_retired',
          'trg_equipment_keep_merged_unit_retired',
          'trg_geotab_assignment_reject_merged_insert',
          'trg_geotab_assignment_reject_merged_update',
          'trg_equipment_prevent_restore_merged',
          'pm_import_unresolved_20260818',
          'pm_import_receipts',
          'working_manager_feature_receipts'
        )
      `).all<{ type: string; name: string }>(),
      db.prepare(`
        SELECT pm_events, resolved_units, pm_40, pm_20a, pm_20b,
               future_repairs, unresolved_events, applied_at
        FROM pm_import_receipts
        WHERE import_batch = 'pm-sheet-2026-08-18'
      `).first<PmImportReceipt>(),
      db.prepare(`
        SELECT COUNT(*) AS linked
        FROM app_users u
        JOIN technicians t ON t.id = u.technician_id AND t.active = 1
        WHERE u.active = 1 AND u.role = 'manager'
          AND (
            (u.username = 'jeffw' COLLATE NOCASE AND lower(trim(t.name)) = lower('Jeff Wittig'))
            OR
            (u.username = 'jesseg' COLLATE NOCASE AND lower(trim(t.name)) = lower('Jesse Graham'))
          )
      `).first<WorkingManagerLinks>(),
      db.prepare(`
        SELECT applied_at
        FROM working_manager_feature_receipts
        WHERE feature_key = 'working-manager-technician-links-0078'
      `).first<WorkingManagerReceipt>(),
    ]);

    const repairNames = new Set(repairColumns.results.map((row) => row.name));
    const dvirNames = new Set(dvirColumns.results.map((row) => row.name));
    const assignmentNames = new Set(assignmentColumns.results.map((row) => row.name));
    const reconciliationNames = new Set(reconciliationColumns.results.map((row) => row.name));
    const anomalyNames = new Set(anomalyColumns.results.map((row) => row.name));
    const equipmentNames = new Set(equipmentColumns.results.map((row) => row.name));
    const objectNames = new Set(objects.results.map((row) => row.name));

    const pmImport = pmImportReceipt ? {
      events: Number(pmImportReceipt.pm_events),
      resolvedUnits: Number(pmImportReceipt.resolved_units),
      pm40: Number(pmImportReceipt.pm_40),
      pm20A: Number(pmImportReceipt.pm_20a),
      pm20B: Number(pmImportReceipt.pm_20b),
      futureRepairs: Number(pmImportReceipt.future_repairs),
      unresolvedEvents: Number(pmImportReceipt.unresolved_events),
      appliedAt: pmImportReceipt.applied_at,
      ok: Number(pmImportReceipt.pm_events) === 508
        && Number(pmImportReceipt.resolved_units) === 263
        && Number(pmImportReceipt.pm_40) === 262
        && Number(pmImportReceipt.pm_20a) === 163
        && Number(pmImportReceipt.pm_20b) === 83
        && Number(pmImportReceipt.future_repairs) === 54
        && Number(pmImportReceipt.unresolved_events) === 1,
    } : null;
    const workingManagers = {
      linked: Number(workingManagerLinks?.linked ?? 0),
      featureAppliedAt: workingManagerReceipt?.applied_at ?? null,
    };

    const migrations = {
      '0059': objectNames.has('unmatched_part_requests'),
      '0060': objectNames.has('trg_geotab_truck_require_archive_state'),
      '0061': dvirNames.has('local_repaired')
        && objectNames.has('trg_dvir_keep_local_repair')
        && objectNames.has('trg_dvir_keep_local_repair_row'),
      '0062': repairNames.has('reviewed_at')
        && repairNames.has('reviewed_by_user_id')
        && repairNames.has('review_note'),
      '0063': objectNames.has('equipment_geotab_devices')
        && objectNames.has('geotab_reconciliation_queue')
        && objectNames.has('geotab_mileage_anomalies')
        && objectNames.has('idx_equipment_geotab_devices_current_device')
        && objectNames.has('idx_equipment_geotab_devices_current_equipment'),
      '0064': assignmentNames.has('mileage_offset')
        && assignmentNames.has('mileage_calibrated_at')
        && assignmentNames.has('mileage_calibrated_by_user_id')
        && reconciliationNames.has('resolved_by_user_id')
        && reconciliationNames.has('resolution_note')
        && anomalyNames.has('raw_mileage')
        && anomalyNames.has('adjusted_mileage')
        && anomalyNames.has('trusted_mileage')
        && anomalyNames.has('reviewed_by_user_id')
        && anomalyNames.has('review_note')
        && objectNames.has('idx_geotab_device_assignments_review')
        && objectNames.has('idx_geotab_reconciliation_resolved_by')
        && objectNames.has('idx_geotab_mileage_reviewed_by'),
      '0065': equipmentNames.has('merged_into_equipment_id')
        && equipmentNames.has('merged_at')
        && equipmentNames.has('merged_by_user_id')
        && equipmentNames.has('merge_note')
        && objectNames.has('equipment_merge_events')
        && objectNames.has('idx_equipment_merged_into')
        && objectNames.has('idx_equipment_merge_events_target')
        && objectNames.has('trg_equipment_sanitize_merged_identity')
        && objectNames.has('trg_equipment_keep_merged_identity_retired')
        && objectNames.has('trg_equipment_keep_merged_unit_retired')
        && objectNames.has('trg_geotab_assignment_reject_merged_insert')
        && objectNames.has('trg_geotab_assignment_reject_merged_update')
        && objectNames.has('trg_equipment_prevent_restore_merged'),
      '0077': objectNames.has('pm_import_unresolved_20260818')
        && objectNames.has('pm_import_receipts')
        && pmImport?.ok === true,
      '0078': objectNames.has('working_manager_feature_receipts')
        && Boolean(workingManagerReceipt?.applied_at),
    };
    return {
      ok: Object.values(migrations).every(Boolean),
      release: RELEASE,
      migrations,
      pmImport,
      workingManagers,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(JSON.stringify({ event: 'deployment_health_failed', error: String(error) }));
    return {
      ok: false,
      release: RELEASE,
      migrations: empty,
      pmImport: null,
      workingManagers: null,
      error: 'schema_check_failed',
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function GET() {
  const runtime = env as AuthEnv;
  const [count, deployment] = await Promise.all([
    appUserCount(runtime.DB),
    deploymentHealth(runtime.DB),
  ]);
  return Response.json({
    setupRequired: count === 0,
    bootstrapConfigured: Boolean(runtime.AUTH_BOOTSTRAP_TOKEN),
    deployment,
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const runtime = env as AuthEnv;
    if (await appUserCount(runtime.DB) > 0) {
      return Response.json({ error: 'Administrator setup has already been completed.' }, { status: 409 });
    }

    if (!runtime.AUTH_BOOTSTRAP_TOKEN) {
      return Response.json(
        { error: 'AUTH_BOOTSTRAP_TOKEN is not configured in Cloudflare Worker secrets.' },
        { status: 503 },
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const suppliedToken = String(body.setupToken ?? '');
    if (!suppliedToken || !(await secureTokenEqual(suppliedToken, runtime.AUTH_BOOTSTRAP_TOKEN))) {
      return Response.json({ error: 'Setup token is incorrect.' }, { status: 403 });
    }

    const email = normalizeEmail(body.email);
    const displayName = String(body.displayName ?? '').trim();
    const password = String(body.password ?? '');
    if (!email || !email.includes('@')) throw new Error('A valid email address is required.');
    if (!displayName) throw new Error('Display name is required.');

    const passwordData = await hashPassword(password);
    const result = await runtime.DB.prepare(`
      INSERT INTO app_users (
        email, display_name, role, password_hash, password_salt, password_iterations,
        password_algorithm, active
      ) VALUES (?, ?, 'admin', ?, ?, ?, ?, 1)
    `).bind(
      email,
      displayName,
      passwordData.hash,
      passwordData.salt,
      passwordData.iterations,
      passwordData.algorithm,
    ).run();

    const userId = Number(result.meta.last_row_id);
    const token = await createSession(runtime.DB, userId);
    return Response.json(
      { ok: true, user: { id: userId, email, displayName, role: 'admin', active: true } },
      { headers: { 'set-cookie': sessionCookie(token, request.url), 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Administrator setup failed.' },
      { status: 400 },
    );
  }
}
