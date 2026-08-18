import { env } from 'cloudflare:workers';

const RELEASE = '2026-08-18-work-order-review-0062';

export async function GET() {
  try {
    const [repairColumns, dvirColumns, objects] = await Promise.all([
      env.DB.prepare(`SELECT name FROM pragma_table_info('repairs')`).all<{ name: string }>(),
      env.DB.prepare(`SELECT name FROM pragma_table_info('dvir_defects')`).all<{ name: string }>(),
      env.DB.prepare(`
        SELECT type, name
        FROM sqlite_master
        WHERE name IN (
          'unmatched_part_requests',
          'trg_geotab_truck_require_archive_state',
          'trg_dvir_keep_local_repair',
          'trg_dvir_keep_local_repair_row'
        )
      `).all<{ type: string; name: string }>(),
    ]);

    const repairNames = new Set(repairColumns.results.map((row) => row.name));
    const dvirNames = new Set(dvirColumns.results.map((row) => row.name));
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
    };

    const ok = Object.values(migrations).every(Boolean);
    return Response.json(
      { ok, release: RELEASE, migrations, checkedAt: new Date().toISOString() },
      { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'deploy_status_failed', error: String(error) }));
    return Response.json(
      { ok: false, release: RELEASE, error: 'schema_check_failed', checkedAt: new Date().toISOString() },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
