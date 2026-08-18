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

const RELEASE = '2026-08-18-geotab-review-0064';

async function deploymentHealth(db: D1Database) {
  const empty = { '0059': false, '0060': false, '0061': false, '0062': false, '0063': false, '0064': false };
  try {
    const [repairColumns, dvirColumns, assignmentColumns, reconciliationColumns, anomalyColumns, objects] = await Promise.all([
      db.prepare(`SELECT name FROM pragma_table_info('repairs')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('dvir_defects')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('equipment_geotab_devices')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('geotab_reconciliation_queue')`).all<{ name: string }>(),
      db.prepare(`SELECT name FROM pragma_table_info('geotab_mileage_anomalies')`).all<{ name: string }>(),
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
          'idx_geotab_mileage_reviewed_by'
        )
      `).all<{ type: string; name: string }>(),
    ]);

    const repairNames = new Set(repairColumns.results.map((row) => row.name));
    const dvirNames = new Set(dvirColumns.results.map((row) => row.name));
    const assignmentNames = new Set(assignmentColumns.results.map((row) => row.name));
    const reconciliationNames = new Set(reconciliationColumns.results.map((row) => row.name));
    const anomalyNames = new Set(anomalyColumns.results.map((row) => row.name));
    const objectNames = new Set(objects.results.map((row) => row.name));
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
    };
    return {
      ok: Object.values(migrations).every(Boolean),
      release: RELEASE,
      migrations,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(JSON.stringify({ event: 'deployment_health_failed', error: String(error) }));
    return {
      ok: false,
      release: RELEASE,
      migrations: empty,
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
