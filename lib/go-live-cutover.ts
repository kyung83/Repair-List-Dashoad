const HISTORY_IMPORT_KEY = 'ro-history-9309499-v1';

const SANDBOX_REPAIR_WHERE = `
  lower(COALESCE(r.source, '')) <> 'roadside-breakdown'
  AND r.id NOT IN (SELECT repair_id FROM roadside_breakdowns)
  AND r.go_live_archived_at IS NULL
`;

const INVENTORY_AUDIT_LINK_WHERE = `
  (
    EXISTS (SELECT 1 FROM inventory_operations io WHERE io.repair_id=r.id)
    OR EXISTS (
      SELECT 1
      FROM inventory_operation_lines iol
      JOIN repair_parts rp ON rp.id=iol.repair_part_id
      WHERE rp.repair_id=r.id
    )
    OR EXISTS (SELECT 1 FROM part_lifecycle_events ple WHERE ple.repair_id=r.id)
    OR EXISTS (SELECT 1 FROM part_core_obligations pco WHERE pco.repair_id=r.id)
    OR EXISTS (SELECT 1 FROM recovered_used_tires rut WHERE rut.repair_id=r.id)
    OR EXISTS (SELECT 1 FROM recovered_used_tires rut WHERE rut.disposition_repair_id=r.id)
  )
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

type ProtectionSnapshot = {
  inventoryParts:number;
  inventoryStockRows:number;
  inventoryQuantity:number;
  inventoryOperations:number;
  inventoryOperationRepairLinks:number;
  inventoryOperationLineRepairPartLinks:number;
  partLifecycleRepairLinks:number;
  coreRepairLinks:number;
  recoveredTireRepairLinks:number;
  recoveredTireDispositionRepairLinks:number;
  breakdownRows:number;
  breakdownRepairRows:number;
  activeEquipment:number;
  totalEquipment:number;
};

async function scalar(db:D1Database, sql:string, ...bindings:unknown[]) {
  const row = await db.prepare(sql).bind(...bindings).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function setting(db:D1Database, key:string) {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<SettingRow>();
  return String(row?.value ?? '');
}

async function protectionSnapshot(db:D1Database):Promise<ProtectionSnapshot> {
  const [
    inventoryParts,
    inventoryStock,
    inventoryOperations,
    inventoryOperationRepairLinks,
    inventoryOperationLineRepairPartLinks,
    partLifecycleRepairLinks,
    coreRepairLinks,
    recoveredTireRepairLinks,
    recoveredTireDispositionRepairLinks,
    breakdownRows,
    breakdownRepairRows,
    activeEquipment,
    totalEquipment,
  ] = await Promise.all([
    scalar(db, `SELECT COUNT(*) count FROM parts WHERE active=1`),
    db.prepare(`SELECT COUNT(*) count, COALESCE(SUM(quantity_on_hand),0) quantity FROM part_warehouse_stock`).first<SumRow>(),
    scalar(db, `SELECT COUNT(*) count FROM inventory_operations`),
    scalar(db, `SELECT COUNT(*) count FROM inventory_operations WHERE repair_id IS NOT NULL`),
    scalar(db, `SELECT COUNT(*) count FROM inventory_operation_lines WHERE repair_part_id IS NOT NULL`),
    scalar(db, `SELECT COUNT(*) count FROM part_lifecycle_events WHERE repair_id IS NOT NULL`),
    scalar(db, `SELECT COUNT(*) count FROM part_core_obligations WHERE repair_id IS NOT NULL`),
    scalar(db, `SELECT COUNT(*) count FROM recovered_used_tires WHERE repair_id IS NOT NULL`),
    scalar(db, `SELECT COUNT(*) count FROM recovered_used_tires WHERE disposition_repair_id IS NOT NULL`),
    scalar(db, `SELECT COUNT(*) count FROM roadside_breakdowns`),
    scalar(db, `SELECT COUNT(*) count FROM repairs r WHERE lower(COALESCE(r.source,''))='roadside-breakdown' OR r.id IN (SELECT repair_id FROM roadside_breakdowns)`),
    scalar(db, `SELECT COUNT(*) count FROM equipment WHERE active=1 AND archived_at IS NULL AND merged_into_equipment_id IS NULL`),
    scalar(db, `SELECT COUNT(*) count FROM equipment`),
  ]);
  return {
    inventoryParts,
    inventoryStockRows:Number(inventoryStock?.count ?? 0),
    inventoryQuantity:Number(inventoryStock?.quantity ?? 0),
    inventoryOperations,
    inventoryOperationRepairLinks,
    inventoryOperationLineRepairPartLinks,
    partLifecycleRepairLinks,
    coreRepairLinks,
    recoveredTireRepairLinks,
    recoveredTireDispositionRepairLinks,
    breakdownRows,
    breakdownRepairRows,
    activeEquipment,
    totalEquipment,
  };
}

async function inventoryLinkSummary(db:D1Database) {
  const [
    linkedRepairs,
    operationHeaders,
    operationLines,
    lifecycleEvents,
    coreObligations,
    recoveredTireSources,
    recoveredTireDispositions,
  ] = await Promise.all([
    scalar(db, `SELECT COUNT(*) count FROM repairs r WHERE ${SANDBOX_REPAIR_WHERE} AND ${INVENTORY_AUDIT_LINK_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM inventory_operations io JOIN repairs r ON r.id=io.repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count
      FROM inventory_operation_lines iol
      JOIN repair_parts rp ON rp.id=iol.repair_part_id
      JOIN repairs r ON r.id=rp.repair_id
      WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM part_lifecycle_events ple JOIN repairs r ON r.id=ple.repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM part_core_obligations pco JOIN repairs r ON r.id=pco.repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM recovered_used_tires rut JOIN repairs r ON r.id=rut.repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
    scalar(db, `SELECT COUNT(*) count FROM recovered_used_tires rut JOIN repairs r ON r.id=rut.disposition_repair_id WHERE ${SANDBOX_REPAIR_WHERE}`),
  ]);
  const total=operationHeaders+operationLines+lifecycleEvents+coreObligations+recoveredTireSources+recoveredTireDispositions;
  return {linkedRepairs,total,operationHeaders,operationLines,lifecycleEvents,coreObligations,recoveredTireSources,recoveredTireDispositions};
}

function protectionMismatch(before:ProtectionSnapshot,after:ProtectionSnapshot) {
  const keys=(Object.keys(before) as (keyof ProtectionSnapshot)[]);
  return keys.filter((key)=>Number(before[key])!==Number(after[key]));
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
    historicalRos,
    maintenanceEvents,
    historyImport,
    dvirCutoffAt,
    goLiveCompletedAt,
    protectedSnapshot,
    inventoryLinks,
    deletableSandboxRepairs,
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
    scalar(db, `SELECT COUNT(*) count FROM historical_repairs`),
    scalar(db, `SELECT COUNT(*) count FROM maintenance_events`),
    db.prepare(`SELECT status,source_name,source_ro_count,imported_ro_count,unmatched_ro_count,completed_at
      FROM data_imports WHERE import_key=?`).bind(HISTORY_IMPORT_KEY).first<HistoryRow>(),
    setting(db, 'dvir_go_live_cutoff_at'),
    setting(db, 'shop_go_live_completed_at'),
    protectionSnapshot(db),
    inventoryLinkSummary(db),
    scalar(db, `SELECT COUNT(*) count FROM repairs r WHERE ${SANDBOX_REPAIR_WHERE} AND NOT ${INVENTORY_AUDIT_LINK_WHERE}`),
  ]);

  return {
    mode:'armed' as const,
    destructiveActionsEnabled:true,
    goLiveCompletedAt,
    dvirCutoffAt,
    confirmationPhrase:'GO LIVE',
    canExecute:!goLiveCompletedAt,
    blockers:{
      inventoryLinkedSandboxRows:0,
      inventoryLinkedSandboxRepairs:inventoryLinks.linkedRepairs,
      inventoryAuditLinksPreserved:inventoryLinks.total,
      detail:inventoryLinks,
      alreadyCompleted:Boolean(goLiveCompletedAt),
    },
    willClear:{
      repairs:sandboxRepairs,
      repairsToDelete:deletableSandboxRepairs,
      repairsToArchive:inventoryLinks.linkedRepairs,
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
      breakdownRepairRows:protectedSnapshot.breakdownRepairRows,
      breakdownRows:protectedSnapshot.breakdownRows,
      activeBreakdowns:await scalar(db, `SELECT COUNT(*) count FROM roadside_breakdowns WHERE stage < 5`),
      historicalRos,
      equipmentRows:protectedSnapshot.activeEquipment,
      totalEquipmentRows:protectedSnapshot.totalEquipment,
      maintenanceEvents,
      inventoryParts:protectedSnapshot.inventoryParts,
      inventoryStockRows:protectedSnapshot.inventoryStockRows,
      inventoryQuantity:protectedSnapshot.inventoryQuantity,
      inventoryOperations:protectedSnapshot.inventoryOperations,
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
      'Delete sandbox non-Breakdown repairs that never touched inventory; archive inventory-linked sandbox repairs so audit history stays intact.',
      'Set the DVIR go-live cutoff and clear the local DVIR staging rows.',
      'Clear sandbox OOS flags only when the unit has no active Breakdown.',
      'Allow Geotab DVIR synchronization to repopulate only fresh DVIRs after the cutoff.',
      'Manually enter the small list of real open repairs from the current repair sheet.',
    ],
  };
}

export async function executeGoLiveCutover(db:D1Database,input:{userId:number;userName:string;confirmation:string}) {
  if(String(input.confirmation??'').trim()!=='GO LIVE')throw new Error('Type GO LIVE exactly to run the one-time cutover.');
  const completed=await setting(db,'shop_go_live_completed_at');
  if(completed)throw new Error(`The one-time shop cutover already completed at ${completed}.`);

  const preview=await getGoLiveCutoverPreview(db);
  const before=await protectionSnapshot(db);
  const cutoffAt=new Date().toISOString();

  const auditInsert=db.prepare(`
    INSERT INTO repair_admin_deletions(
      repair_id,equipment_id,unit,title,parts_text,priority,status,source,technician_id,opened_at,
      deleted_by_user_id,deleted_by_name,reason
    )
    SELECT r.id,r.equipment_id,COALESCE(e.unit,''),r.title,COALESCE(r.parts_text,''),COALESCE(r.priority,'2'),
           COALESCE(r.status,'New'),COALESCE(r.source,'manual'),r.technician_id,r.opened_at,
           ?,?,'Go-live cutover: sandbox shop repair removed before production launch.'
    FROM repairs r
    LEFT JOIN equipment e ON e.id=r.equipment_id
    WHERE ${SANDBOX_REPAIR_WHERE}
      AND NOT ${INVENTORY_AUDIT_LINK_WHERE}
  `).bind(input.userId,input.userName);

  const archiveEvent=db.prepare(`
    INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
    SELECT r.id,?,r.technician_id,'go_live_archived',
           'Go-live cutover archived this sandbox repair because inventory audit history is linked to it.'
    FROM repairs r
    WHERE ${SANDBOX_REPAIR_WHERE}
      AND ${INVENTORY_AUDIT_LINK_WHERE}
  `).bind(input.userId);

  await db.batch([
    db.prepare(`
      INSERT INTO app_settings(key,value) VALUES('dvir_go_live_cutoff_at',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).bind(cutoffAt),
    auditInsert,
    archiveEvent,
    db.prepare(`DELETE FROM technician_alerts WHERE repair_id IN (SELECT r.id FROM repairs r WHERE ${SANDBOX_REPAIR_WHERE})`),
    db.prepare(`DELETE FROM repair_labor_timers WHERE repair_id IN (SELECT r.id FROM repairs r WHERE ${SANDBOX_REPAIR_WHERE})`),
    db.prepare(`
      UPDATE repairs AS r
      SET status='Completed - Cutover Archive',
          source='cutover-archive',
          completed_at=COALESCE(completed_at,?),
          go_live_archived_at=?,
          go_live_archived_by_user_id=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE ${SANDBOX_REPAIR_WHERE}
        AND ${INVENTORY_AUDIT_LINK_WHERE}
    `).bind(cutoffAt,cutoffAt,input.userId),
    db.prepare(`
      DELETE FROM repairs
      WHERE id IN (
        SELECT r.id
        FROM repairs r
        WHERE ${SANDBOX_REPAIR_WHERE}
          AND NOT ${INVENTORY_AUDIT_LINK_WHERE}
      )
    `),
    db.prepare(`DELETE FROM dvir_defects`),
    db.prepare(`
      UPDATE equipment
      SET out_of_service=0,
          out_of_service_reason=NULL,
          out_of_service_at=NULL,
          out_of_service_by_user_id=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE COALESCE(out_of_service,0)=1
        AND NOT EXISTS (
          SELECT 1 FROM roadside_breakdowns b
          WHERE b.stage < 5
            AND (b.equipment_id=equipment.id OR b.trailer_equipment_id=equipment.id)
        )
    `),
  ]);

  const after=await protectionSnapshot(db);
  const mismatches=protectionMismatch(before,after);
  if(mismatches.length){
    throw new Error(`Cutover protection check failed after reset: ${mismatches.join(', ')} changed unexpectedly. The cutover has NOT been marked complete; administrator review is required.`);
  }

  await db.batch([
    db.prepare(`
      INSERT INTO go_live_cutover_runs(
        executed_by_user_id,dvir_cutoff_at,non_breakdown_repairs_deleted,sandbox_repairs_archived,dvir_defects_deleted,oos_units_cleared,
        breakdown_repairs_protected,historical_ros_protected,inventory_parts_protected,inventory_stock_rows_protected,
        inventory_quantity_before,inventory_quantity_after,inventory_operations_before,inventory_operations_after,
        breakdown_rows_before,breakdown_rows_after,active_equipment_before,active_equipment_after,inventory_link_blockers,note
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      input.userId,cutoffAt,preview.willClear.repairsToDelete,preview.willClear.repairsToArchive,preview.willClear.dvirDefects,preview.willClear.oosUnitsWithoutActiveBreakdown,
      before.breakdownRepairRows,preview.protected.historicalRos,before.inventoryParts,before.inventoryStockRows,
      before.inventoryQuantity,after.inventoryQuantity,before.inventoryOperations,after.inventoryOperations,
      before.breakdownRows,after.breakdownRows,before.activeEquipment,after.activeEquipment,preview.blockers.inventoryAuditLinksPreserved,
      'One-time shop go-live cutover completed. Inventory-linked sandbox repairs were archived rather than deleted. Breakdowns, active equipment identity, maintenance history, and inventory were protected.'
    ),
    db.prepare(`
      INSERT INTO app_settings(key,value) VALUES('shop_go_live_completed_at',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).bind(cutoffAt),
  ]);

  return {
    ok:true,
    completedAt:cutoffAt,
    deleted:{
      repairs:preview.willClear.repairsToDelete,
      dvirDefects:preview.willClear.dvirDefects,
      oosUnitsCleared:preview.willClear.oosUnitsWithoutActiveBreakdown,
    },
    archived:{
      repairs:preview.willClear.repairsToArchive,
      inventoryAuditLinksPreserved:preview.blockers.inventoryAuditLinksPreserved,
    },
    protected:{
      breakdowns:after.breakdownRows,
      breakdownRepairs:after.breakdownRepairRows,
      activeEquipment:after.activeEquipment,
      inventoryParts:after.inventoryParts,
      inventoryStockRows:after.inventoryStockRows,
      inventoryQuantity:after.inventoryQuantity,
      inventoryOperations:after.inventoryOperations,
    },
  };
}
