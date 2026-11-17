/** Validate the same invariant as the D1 completion trigger before any labor is stopped. */
export async function requireReadyMaintenanceChecklist(db:D1Database,repairId:number){
  const row=await db.prepare(
    "SELECT source FROM repairs WHERE id=?"
  ).bind(repairId).first<{source:string|null}>();
  if(!row)throw new Error('The work order could not be found.');
  if(row.source!=='scheduled-pm'&&row.source!=='scheduled-annual')return;
  const checklist=await db.prepare(
    "SELECT status FROM maintenance_checklist_runs WHERE repair_id=? ORDER BY id DESC LIMIT 1"
  ).bind(repairId).first<{status:string}>();
  if(checklist?.status==='ready')return;
  const type=row.source==='scheduled-pm'?'PM':'annual';
  throw new Error(
    checklist
      ? `This is a ${type} work order. Its inspection checklist is still ${checklist.status.replaceAll('_',' ')}. Open the ${type} checklist, complete the required steps and finalize it before selecting Repaired. Labor has not been stopped.`
      : `This is a ${type} work order. Open and complete its inspection checklist before selecting Repaired. Labor has not been stopped.`
  );
}
