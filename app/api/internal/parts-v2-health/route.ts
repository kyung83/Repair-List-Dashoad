import { env } from 'cloudflare:workers';

const RELEASE = '2026-08-24-parts-inventory-v2-0094';

export async function GET() {
  try {
    const [objects, repairPartColumns, vendorColumns, partColumns, recoveredTireColumns] = await Promise.all([
      env.DB.prepare(`
        SELECT type,name
        FROM sqlite_master
        WHERE name IN (
          'inventory_operations',
          'inventory_operation_lines',
          'inventory_operation_dependencies',
          'inventory_operation_commits',
          'inventory_discrepancy_issues',
          'part_core_obligations',
          'recovered_used_tires',
          'derived_repair_part_reservations',
          'idx_vendors_normalized_name',
          'idx_core_obligation_source_operation',
          'idx_recovered_tire_source_position',
          'trg_inventory_part_issue_open_core',
          'trg_inventory_operation_undo_core_guard'
        )
      `).all<{type:string;name:string}>(),
      env.DB.prepare(`SELECT name FROM pragma_table_info('repair_parts')`).all<{name:string}>(),
      env.DB.prepare(`SELECT name FROM pragma_table_info('vendors')`).all<{name:string}>(),
      env.DB.prepare(`SELECT name FROM pragma_table_info('parts')`).all<{name:string}>(),
      env.DB.prepare(`SELECT name FROM pragma_table_info('recovered_used_tires')`).all<{name:string}>(),
    ]);

    const names = new Set(objects.results.map((row)=>row.name));
    const repairPartNames = new Set(repairPartColumns.results.map((row)=>row.name));
    const vendorNames = new Set(vendorColumns.results.map((row)=>row.name));
    const partNames = new Set(partColumns.results.map((row)=>row.name));
    const recoveredTireNames = new Set(recoveredTireColumns.results.map((row)=>row.name));
    const checks = {
      operations: names.has('inventory_operations') && names.has('inventory_operation_lines'),
      dependencies: names.has('inventory_operation_dependencies'),
      d1CommitGuard: names.has('inventory_operation_commits'),
      discrepancyIssues: names.has('inventory_discrepancy_issues'),
      coreObligations: names.has('part_core_obligations'),
      recoveredUsedTires: names.has('recovered_used_tires'),
      derivedReservations: names.has('derived_repair_part_reservations'),
      repairPartOperationLink: repairPartNames.has('inventory_operation_id'),
      normalizedVendors: vendorNames.has('normalized_name') && names.has('idx_vendors_normalized_name'),
      coreConfiguration: partNames.has('core_return_part_id') && partNames.has('core_return_quantity'),
      automaticCoreOpen: names.has('trg_inventory_part_issue_open_core') && names.has('idx_core_obligation_source_operation'),
      coreUndoGuard: names.has('trg_inventory_operation_undo_core_guard'),
      recoveredTireTrace: recoveredTireNames.has('disposition_repair_id')
        && recoveredTireNames.has('disposition_position_code')
        && names.has('idx_recovered_tire_source_position'),
    };

    return Response.json({
      ok:Object.values(checks).every(Boolean),
      release:RELEASE,
      checks,
      checkedAt:new Date().toISOString(),
    },{headers:{'cache-control':'no-store'}});
  } catch (error) {
    console.error(JSON.stringify({event:'parts_v2_health_failed',error:String(error)}));
    return Response.json({ok:false,release:RELEASE,error:'schema_check_failed',checkedAt:new Date().toISOString()},{status:500,headers:{'cache-control':'no-store'}});
  }
}
