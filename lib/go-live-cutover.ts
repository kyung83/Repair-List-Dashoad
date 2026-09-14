const HISTORY_IMPORT_KEY = 'ro-history-9309499-v1';

const SANDBOX_REPAIR_WHERE = `
  lower(COALESCE(r.source, '')) <> 'roadside-breakdown'
  AND r.id NOT IN (SELECT repair_id FROM roadside_breakdowns)
`;

type CountRow = { count:number };
type SumRow = { count:number; quantity:number|null };
type SettingRow = { value:string };
type HistoryRow = {
  status:string;
  source_name:string;
  source_ro_count:number;
  imported_ro_count:number;
  unmatched_ro_count:number;
  completed_at:string|null;
};

async function scalar(db:D1Database, sql:string, ...bindings:unknown[]) {
  const row = await db.prepare(sql).bind(...bindings).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function setting(db:D1Database, key:string) {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<SettingRow>();
  return String(row?.value ?? '');
}

export async function getGoLiveCutoverPreview(db:D1Database) {
  const [
    sandboxRepairs,
    openSandboxRepairs,
    completedSandboxRepairs,
    sandboxLaborEntries,
    sandboxActiveTimers,
    sandboxRepairParts,
    dvirDefects,
    unrepairedDvirDefects,
    oosUnitsWithoutBreakdown,
    breakdownRepairRows,
    breakdownRows,
    activeBreakdowns,
    historicalRos,
    equipmentRows,
    maintenanceEvents,
    inventoryParts,
    inventoryStock,
    inventoryOperations,
    historyImport,
    dvirCutoffAt,
    goLiveCompletedAt,
  ] = await Promise.all([
    scalar(db, `SELECT COUNT(*) count FROM repairs r WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM repairs r WHERE ${SANDBOX_REPAIR_WHERE} AND r.completed_at IS NULL AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'`),
    scalar(db, `SELECT COUNT(*) count FROM repairs r WHERE ${SANDBOX_REPAIR_WHERE} AND (r.completed_at IS NOT NULL OR lower(COALESCE(r.status,'')) LIKE '%complete%')`),
    scalar(db, `SELECT COUNT(*) count FROM repair_labor_entries l JOIN repairs r ON r.id=l.repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM repair_labor_timers t JOIN repairs r ON r.id=t.repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM repair_parts p JOIN repairs r ON r.id=p.repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM dvir_defects`),
    scalar(db, `SELECT COUNT(*) count FROM dvir_defects WHERE repaired=0`),
    scalar(db, `SELECT COUNT(*) count FROM equipment e
      WHERE COALESCE(e.out_of_service,0)=1
        AND NOT EXISTS (
          SELECT 1 FROM roadside_breakdowns b
          WHERE b.stage < 5
            AND (b.equipment_id=e.id OR b.trailer_equipment_id=e.id)
        )`),
    scalar(db, `SELECT COUNT(*) count FROM repairs r WHERE lower(COALESCE(r.source,''))='roadside-breakdown' OR r.id IN (SELECT repair_id FROM roadside_breakdowns)`),
    scalar(db, `SELECT COUNT(*) count FROM roadside_breakdowns`),
    scalar(db, `SELECT COUNT(*) count FROM roadside_breakdowns WHERE stage < 5`),
    scalar(db, `SELECT COUNT(*) count FROM historical_repairs`),
    scalar(db, `SELECT COUNT(*) count FROM equipment WHERE active=1 AND archived_at IS NULL AND merged_into_equipment_id IS NULL`),
    scalar(db, `SELECT COUNT(*) count FROM maintenance_events`),
    scalar(db, `SELECT COUNT(*) count FROM parts WHERE active=1`),
    db.prepare(`SELECT COUNT(*) count, COALESCE(SUM(quantity_on_hand),0) quantity FROM part_warehouse_stock`).first<SumRow>(),
    scalar(db, `SELECT COUNT(*) count FROM inventory_operations`),
    db.prepare(`SELECT status,source_name,source_ro_count,imported_ro_count,unmatched_ro_count,completed_at
      FROM data_imports WHERE import_key=?`).bind(HISTORY_IMPORT_KEY).first<HistoryRow>(),
    setting(db, 'dvir_go_live_cutoff_at'),
    setting(db, 'shop_go_live_completed_at'),
  ]);

  return {
    mode:'dry-run' as const,
    destructiveActionsEnabled:false,
    goLiveCompletedAt,
    dvirCutoffAt,
    willClear:{
      repairs:sandboxRepairs,
      openRepairs:openSandboxRepairs,
      completedRepairs:completedSandboxRepairs,
      laborEntries:sandboxLaborEntries,
      activeLaborTimers:sandboxActiveTimers,
      repairPartLines:sandboxRepairParts,
      dvirDefects,
      unrepairedDvirDefects,
      oosUnitsWithoutActiveBreakdown:oosUnitsWithoutBreakdown,
    },
    protected:{
      breakdownRepairRows,
      breakdownRows,
      activeBreakdowns,
      historicalRos,
      equipmentRows,
      maintenanceEvents,
      inventoryParts,
      inventoryStockRows:Number(inventoryStock?.count ?? 0),
      inventoryQuantity:Number(inventoryStock?.quantity ?? 0),
      inventoryOperations,
    },
    historyImport:historyImport ? {
      status:historyImport.status,
      sourceName:historyImport.source_name,
      sourceRoCount:Number(historyImport.source_ro_count ?? 0),
      importedRoCount:Number(historyImport.imported_ro_count ?? 0),
      unmatchedRoCount:Number(historyImport.unmatched_ro_count ?? 0),
      completedAt:historyImport.completed_at ?? '',
    } : null,
    plan:[
      'Import the final cumulative EMDECS repair-history export and verify totals.',
      'Import the final EMDECS inventory snapshot as the production opening balance.',
      'Protect every roadside-breakdown repair and all Breakdown-specific records.',
      'Clear sandbox non-Breakdown shop repairs and their attached shop activity.',
      'Set the DVIR go-live cutoff and clear the local DVIR staging rows.',
      'Clear sandbox OOS flags only when the unit has no active Breakdown.',
      'Allow Geotab DVIR synchronization to repopulate only fresh DVIRs after the cutoff.',
      'Manually enter the small list of real open repairs from the current repair sheet.',
    ],
  };
}
