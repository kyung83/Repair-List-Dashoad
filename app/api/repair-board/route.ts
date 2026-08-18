import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { markGeotabDefectRepaired } from '@/lib/geotab';
import { getMaintenanceBoardItems } from '@/lib/maintenance-board';
import { normalizeYard, yardLabel } from '@/lib/yards';
import { GET as originalGET, POST as originalPOST } from './original';

type BoardRepair = {
  id:string; source:string; issue:string; status:string; technicianId:number|null; activeTimer:unknown;
  outOfService:boolean; equipmentType:string; equipmentId:number|null;
};
type OosUnit = { openWork?: Array<{status?:string}>; [key:string]: unknown };
type BoardUser = { id:number; displayName:string; role:string; technicianId:number|null };
type Technician = { id:number; name:string };

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
}

function completed(status: unknown) {
  return String(status ?? '').toLowerCase().includes('complete');
}

function conciseMaintenanceIssue(repair: BoardRepair) {
  if (repair.source === 'pm') return { ...repair, issue: 'PM' };
  if (repair.source === 'annual') return { ...repair, issue: 'Annual' };
  return repair;
}

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function maintenanceBoardId(value: unknown) {
  const match = String(value ?? '').match(/^(pm|annual)-(\d+)$/);
  return match ? { kind:match[1] as 'pm'|'annual', equipmentId:Number(match[2]), id:`${match[1]}-${match[2]}` } : null;
}

async function isDeferredRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(id).first<{status:string}>();
  return Boolean(row && deferred(row.status));
}

async function linkedTechnician(user: BoardUser) {
  if (!['mechanic','manager','admin'].includes(user.role)) throw new Error('This account cannot claim repair work.');
  if (!user.technicianId) throw new Error('Your login is not linked to a technician record. Ask an administrator to enable Works on repairs.');
  const technician = await env.DB.prepare(`SELECT id, name FROM technicians WHERE id = ? AND active = 1`)
    .bind(user.technicianId).first<Technician>();
  if (!technician) throw new Error('Your linked technician record is not active.');
  return technician;
}

async function enforceClaimYard(user: BoardUser, equipmentId: number|null, fallbackLocation = '') {
  if (user.role !== 'mechanic' && user.role !== 'manager') return;
  const account = await env.DB.prepare(`SELECT COALESCE(yard,'') AS yard FROM app_users WHERE id = ?`)
    .bind(user.id).first<{yard:string}>();
  const assigned = normalizeYard(account?.yard);
  if (!assigned) throw new Error('Your account needs a yard assignment before you can claim unassigned work.');

  const equipment = equipmentId ? await env.DB.prepare(`
    SELECT COALESCE(current_yard,'') AS current_yard, COALESCE(location,'') AS location
    FROM equipment WHERE id = ? AND active = 1
  `).bind(equipmentId).first<{current_yard:string;location:string}>() : null;
  const workYard = normalizeYard(equipment?.current_yard)
    || normalizeYard(equipment?.location)
    || normalizeYard(fallbackLocation);
  if (!workYard) throw new Error('This work does not have a yard assignment yet. Ask a manager to place the unit before claiming it.');
  if (workYard !== assigned) throw new Error(`This work is in the ${yardLabel(workYard)} yard. You can only claim work in your assigned ${yardLabel(assigned)} yard.`);
}

async function claimExistingRepair(user: BoardUser, technician: Technician, id: number) {
  const repair = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.status,'') AS status,
           COALESCE(NULLIF(r.location,''), NULLIF(e.current_yard,''), NULLIF(e.location,''), '') AS location
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<{id:number;equipment_id:number|null;technician_id:number|null;status:string;location:string}>();
  if (!repair) throw new Error('Repair was not found.');
  if (completed(repair.status)) throw new Error('That repair is already completed.');
  if (deferred(repair.status)) throw new Error('That repair is intentionally saved for its next PM/Annual.');
  await enforceClaimYard(user, repair.equipment_id, repair.location);

  if (repair.technician_id !== null) {
    if (Number(repair.technician_id) === technician.id) return { ok:true, repairId:`repair-${id}`, technicianId:technician.id, existing:true };
    throw new Error('That repair is already assigned to another technician.');
  }
  const timer = await env.DB.prepare(`SELECT technician_id FROM repair_labor_timers WHERE repair_id = ?`).bind(id).first<{technician_id:number}>();
  if (timer && Number(timer.technician_id) !== technician.id) throw new Error('Another technician already has labor running on that repair.');

  const result = await env.DB.prepare(`
    UPDATE repairs
    SET technician_id = ?,
        status = CASE WHEN lower(trim(COALESCE(status,''))) = 'new' THEN 'Assigned' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND technician_id IS NULL
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
  `).bind(technician.id,id).run();
  if (Number(result.meta.changes ?? 0) === 0) {
    const latest = await env.DB.prepare(`SELECT technician_id FROM repairs WHERE id = ?`).bind(id).first<{technician_id:number|null}>();
    if (Number(latest?.technician_id ?? 0) === technician.id) return { ok:true, repairId:`repair-${id}`, technicianId:technician.id, existing:true };
    throw new Error('Someone else assigned that repair first. Refresh the board.');
  }
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'self_assigned',?)
  `).bind(id,user.id,technician.id,`${technician.name} claimed this repair from the Repair Board.`).run();
  return { ok:true, repairId:`repair-${id}`, technicianId:technician.id };
}

async function claimDvir(user: BoardUser, technician: Technician, value: string) {
  const defectId = value.startsWith('dvir-') ? value.slice(5) : value;
  if (!defectId) throw new Error('DVIR defect was not found.');
  const existing = await env.DB.prepare(`SELECT id FROM repairs WHERE geotab_defect_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(defectId).first<{id:number}>();
  if (existing) return claimExistingRepair(user,technician,existing.id);

  const defect = await env.DB.prepare(`
    SELECT d.geotab_defect_id, d.asset_unit, COALESCE(d.driver,'') AS driver,
           d.defect, COALESCE(d.comments,'') AS comments, e.id AS equipment_id,
           COALESCE(e.current_yard,'') AS current_yard, COALESCE(e.location,'') AS equipment_location
    FROM dvir_defects d
    LEFT JOIN equipment e
      ON lower(trim(e.unit)) = lower(trim(d.asset_unit))
     AND e.active = 1
     AND e.merged_into_equipment_id IS NULL
    WHERE d.geotab_defect_id = ? AND d.repaired = 0
    ORDER BY e.id
    LIMIT 1
  `).bind(defectId).first<{
    geotab_defect_id:string;asset_unit:string;driver:string;defect:string;comments:string;
    equipment_id:number|null;current_yard:string;equipment_location:string;
  }>();
  if (!defect) throw new Error('That DVIR is no longer open. Refresh the board.');
  if (!defect.equipment_id) throw new Error('This DVIR is not linked to an active Equipment record yet. Ask a manager to link/create the job before claiming it.');
  await enforceClaimYard(user,defect.equipment_id,defect.current_yard||defect.equipment_location);

  const inserted = await env.DB.prepare(`
    INSERT INTO repairs (equipment_id,title,description,status,priority,source,geotab_defect_id,driver,technician_id,updated_at)
    SELECT ?,?,?, 'Assigned','2','geotab-dvir',?,?,?,CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM repairs WHERE geotab_defect_id = ?)
  `).bind(defect.equipment_id,defect.defect,defect.comments,defect.geotab_defect_id,defect.driver,technician.id,defect.geotab_defect_id).run();
  const row = await env.DB.prepare(`SELECT id FROM repairs WHERE geotab_defect_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(defectId).first<{id:number}>();
  if (!row) throw new Error('DVIR repair could not be created.');
  if (Number(inserted.meta.changes ?? 0) === 0) return claimExistingRepair(user,technician,row.id);
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'dvir_self_assigned',?)
  `).bind(row.id,user.id,technician.id,`${technician.name} created and claimed this DVIR from the Repair Board.`).run();
  return { ok:true, repairId:`repair-${row.id}`, technicianId:technician.id, created:true };
}

async function claimMaintenance(user: BoardUser, technician: Technician, value: string) {
  const maintenance = maintenanceBoardId(value);
  if (!maintenance) throw new Error('Scheduled maintenance item was not found.');
  const dueItem = (await getMaintenanceBoardItems(env.DB)).find((item) => item.id === maintenance.id);
  if (!dueItem) throw new Error('That PM or annual is no longer due. Refresh the board.');
  await enforceClaimYard(user,maintenance.equipmentId,dueItem.location);
  const source = maintenance.kind === 'pm' ? 'scheduled-pm' : 'scheduled-annual';
  const existing = await env.DB.prepare(`
    SELECT id FROM repairs
    WHERE equipment_id = ? AND source = ?
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    ORDER BY id DESC LIMIT 1
  `).bind(maintenance.equipmentId,source).first<{id:number}>();
  if (existing) return claimExistingRepair(user,technician,existing.id);

  const priority = dueItem.status.toLowerCase().includes('overdue') ? '1' : '2';
  const result = await env.DB.prepare(`
    INSERT INTO repairs (equipment_id,title,description,status,priority,source,driver,location,technician_id,updated_at)
    VALUES (?,?,?,'Assigned',?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(
    maintenance.equipmentId,
    dueItem.issue,
    `Scheduled ${maintenance.kind === 'pm' ? 'PM' : 'annual inspection'} claimed from the Repair Board.`,
    priority,
    source,
    dueItem.driver,
    dueItem.location,
    technician.id,
  ).run();
  const id = Number(result.meta.last_row_id);
  if (!id) throw new Error('Scheduled maintenance repair could not be created.');
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'scheduled_maintenance_self_assigned',?)
  `).bind(id,user.id,technician.id,`${technician.name} claimed the scheduled ${maintenance.kind.toUpperCase()} from the Repair Board.`).run();
  return { ok:true, repairId:`repair-${id}`, technicianId:technician.id, created:true };
}

async function assignToMeFromBoard(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB,request) as BoardUser|null;
  if (!user) throw new Error('Authentication required.');
  const technician = await linkedTechnician(user);
  const value = String(body.repairId ?? body.id ?? '').trim();
  const repairId = numericRepairId(value);
  if (repairId) return claimExistingRepair(user,technician,repairId);
  if (value.startsWith('dvir-')) return claimDvir(user,technician,value);
  if (maintenanceBoardId(value)) return claimMaintenance(user,technician,value);
  throw new Error('That Repair Board item cannot be claimed. Refresh the board and try again.');
}

async function markDvirRepairedFromBoard(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required for this change.');

  const defectId = String(body.defectId ?? '').trim();
  if (!defectId) throw new Error('DVIR defect was not found.');
  const row = await env.DB.prepare(`
    SELECT geotab_log_id
    FROM dvir_defects
    WHERE geotab_defect_id = ?
  `).bind(defectId).first<{geotab_log_id:string}>();
  if (!row) throw new Error('DVIR defect was not found.');
  const logId = String(body.logId ?? row.geotab_log_id ?? '').trim();
  if (!logId) throw new Error('The Geotab DVIR log could not be found.');

  const local = await env.DB.prepare(`
    UPDATE dvir_defects
    SET repaired = 1,
        local_repaired = 1,
        repair_date = COALESCE(repair_date, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE geotab_defect_id = ?
  `).bind(defectId).run();
  if (Number(local.meta.changes ?? 0) === 0) throw new Error('DVIR defect could not be marked repaired.');

  let geotabSynced = false;
  let warning = '';
  try {
    await markGeotabDefectRepaired(env, logId, defectId);
    await env.DB.prepare(`
      UPDATE dvir_defects
      SET local_repaired = 0, updated_at = CURRENT_TIMESTAMP
      WHERE geotab_defect_id = ?
    `).bind(defectId).run();
    geotabSynced = true;
  } catch (error) {
    warning = 'Marked repaired on the Repair Board. Geotab writeback is pending because Geotab could not accept the update.';
    console.warn(JSON.stringify({
      event:'repair_board_dvir_geotab_writeback_pending',
      defectId,
      logId,
      userId:user.id,
      error:String(error),
    }));
  }

  return Response.json({
    ok:true,
    defectId,
    logId,
    localRepaired:true,
    geotabSynced,
    warning:warning || undefined,
  }, { headers:{ 'cache-control':'no-store' } });
}

export async function GET(request: Request) {
  const response = await originalGET(request);
  if (!response.ok) return response;
  const payload = await response.json() as {
    repairs?: BoardRepair[];
    oosUnits?: OosUnit[];
    summary?: Record<string, number>;
    [key:string]: unknown;
  };
  const repairs = (payload.repairs ?? [])
    .filter((repair) => !deferred(repair.status))
    .map(conciseMaintenanceIssue);
  payload.repairs = repairs;
  if (Array.isArray(payload.oosUnits)) {
    payload.oosUnits = payload.oosUnits.map((unit) => ({
      ...unit,
      openWork: Array.isArray(unit.openWork)
        ? unit.openWork.filter((work) => !deferred(work.status))
        : unit.openWork,
    }));
  }
  payload.summary = {
    ...(payload.summary ?? {}),
    total: repairs.length,
    trucks: repairs.filter((row) => !row.outOfService && /truck|tractor|vehicle/i.test(row.equipmentType)).length,
    trailers: repairs.filter((row) => !row.outOfService && /trailer/i.test(row.equipmentType)).length,
    dvirOpen: repairs.filter((row) => row.source === 'dvir' || row.source === 'dvir-repair').length,
    maintenanceDue: repairs.filter((row) => ['pm','annual','pm-repair','annual-repair'].includes(row.source)).length,
    unassigned: repairs.filter((row) => row.technicianId === null).length,
    activeLabor: repairs.filter((row) => row.activeTimer !== null).length,
  };
  return Response.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const clone = request.clone();
  let body: Record<string, unknown> | null = null;
  try {
    body = await clone.json() as Record<string, unknown>;
  } catch {
    // The original handler owns validation for malformed/non-JSON requests.
  }

  if (body && String(body.action ?? '') === 'assignToMe') {
    try {
      const result = await assignToMeFromBoard(request,body);
      return Response.json(result,{headers:{'cache-control':'no-store'}});
    } catch (error) {
      console.error(JSON.stringify({event:'repair_board_self_assign_failed',error:String(error)}));
      return Response.json({error:error instanceof Error?error.message:'Work could not be assigned.'},{status:400});
    }
  }

  if (body && await isDeferredRepair(body.repairId ?? body.id)) {
    return Response.json({ error: 'This repair is intentionally saved for its next PM/Annual.' }, { status: 400 });
  }

  if (body && String(body.action ?? '') === 'markDvirRepaired') {
    try {
      return await markDvirRepairedFromBoard(request, body);
    } catch (error) {
      console.error(JSON.stringify({ event:'repair_board_mark_dvir_repaired_failed', error:String(error) }));
      return Response.json({ error:error instanceof Error ? error.message : 'DVIR defect could not be marked repaired.' }, { status:400 });
    }
  }

  return originalPOST(request);
}
