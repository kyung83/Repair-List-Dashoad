import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { markGeotabDefectRepaired } from '@/lib/geotab';
import { GET as originalGET, POST as originalPOST } from './original';
import { assignToMeFromBoard } from './self-assign';
import { createRepairForTechnician, setUnitOosByTechnician } from './technician-actions';

type BoardRepair = {
  id:string; source:string; issue:string; status:string; technicianId:number|null; activeTimer:unknown;
  outOfService:boolean; equipmentType:string; equipmentId:number|null;
};
type OosUnit = { openWork?: Array<{status?:string}>; [key:string]: unknown };
type AdminRepairRow = {
  id:number;
  equipment_id:number|null;
  unit:string;
  title:string;
  parts_text:string;
  priority:string;
  status:string;
  source:string;
  technician_id:number|null;
  opened_at:string;
};

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
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

async function managerUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') {
    throw new Error('Manager or administrator access is required for this change.');
  }
  return user;
}

async function manualOpenRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) throw new Error('Repair was not found.');
  const row = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, COALESCE(e.unit,'') AS unit,
           r.title, COALESCE(r.parts_text,'') AS parts_text,
           COALESCE(r.priority,'2') AS priority, COALESCE(r.status,'New') AS status,
           COALESCE(r.source,'manual') AS source, r.technician_id, r.opened_at
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<AdminRepairRow>();
  if (!row) throw new Error('Repair was not found.');
  if (String(row.status).toLowerCase().includes('complete')) {
    throw new Error('Completed repairs must be corrected from Work Order Review so completed history stays auditable.');
  }
  if (row.source !== 'manual') {
    throw new Error('Only manually entered repairs can be changed or deleted here. DVIR, PM, and Annual work stays tied to its source record.');
  }
  return row;
}

async function isDeferredRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(id).first<{status:string}>();
  return Boolean(row && deferred(row.status));
}

async function editManualRepair(request: Request, body: Record<string, unknown>) {
  const user = await managerUser(request);
  const repair = await manualOpenRepair(body.repairId ?? body.id);
  const title = String(body.title ?? '').trim().slice(0, 500);
  if (!title) throw new Error('Repair description cannot be blank.');
  const equipmentId = Number(body.equipmentId ?? repair.equipment_id ?? 0);
  if (!Number.isInteger(equipmentId) || equipmentId <= 0) throw new Error('Choose an active unit.');
  const equipment = await env.DB.prepare(`
    SELECT id, unit
    FROM equipment
    WHERE id = ? AND active = 1 AND merged_into_equipment_id IS NULL
  `).bind(equipmentId).first<{id:number;unit:string}>();
  if (!equipment) throw new Error('That unit is not an active Equipment record.');

  const unitChanged = Number(repair.equipment_id ?? 0) !== equipmentId;
  if (unitChanged) {
    const activeTimer = await env.DB.prepare('SELECT user_id FROM repair_labor_timers WHERE repair_id = ? LIMIT 1')
      .bind(repair.id).first<{user_id:number}>();
    if (activeTimer) throw new Error('Stop active labor before moving this repair to another unit.');

    const openPartCommitment = await env.DB.prepare(`
      SELECT 1 AS found
      WHERE EXISTS (
        SELECT 1 FROM repair_part_requests
        WHERE repair_id = ? AND status = 'open'
      ) OR EXISTS (
        SELECT 1 FROM unmatched_part_requests
        WHERE repair_id = ? AND status = 'open'
      )
      LIMIT 1
    `).bind(repair.id, repair.id).first<{found:number}>();
    if (openPartCommitment) {
      throw new Error('This repair has an open parts request. Resolve or cancel the parts request before moving the repair to another unit.');
    }

    const maintenanceLink = await env.DB.prepare(`
      SELECT id
      FROM pm_next_repairs
      WHERE status IN ('pending','attached')
        AND (repair_id = ? OR origin_repair_id = ? OR queued_from_repair_id = ? OR target_repair_id = ?)
      LIMIT 1
    `).bind(repair.id, repair.id, repair.id, repair.id).first<{id:number}>();
    if (maintenanceLink) {
      throw new Error('This repair is linked to a PM/Annual action. Remove that maintenance link before moving it to another unit.');
    }
  }

  const details:string[] = [];
  if (repair.title !== title) details.push(`description from “${repair.title}” to “${title}”`);
  if (unitChanged) details.push(`unit from ${repair.unit || 'unknown'} to ${equipment.unit}`);
  if (!details.length) return { ok:true, repairId:`repair-${repair.id}`, equipmentId, unit:equipment.unit, title };

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE repairs
      SET title = ?, equipment_id = ?, location = CASE WHEN ? = 1 THEN '' ELSE location END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(title, equipmentId, unitChanged ? 1 : 0, repair.id),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'repair_corrected',?)
    `).bind(repair.id, user.id, repair.technician_id, `${user.displayName} corrected ${details.join(' and ')}.`.slice(0,500)),
  ]);

  return { ok:true, repairId:`repair-${repair.id}`, equipmentId, unit:equipment.unit, title };
}

async function deleteManualRepair(request: Request, body: Record<string, unknown>) {
  const user = await managerUser(request);
  const repair = await manualOpenRepair(body.repairId ?? body.id);
  const reason = String(body.reason ?? '').trim().slice(0, 500);
  if (!reason) throw new Error('Enter a reason for deleting the mistaken repair.');

  const activity = await env.DB.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM repair_labor_timers WHERE repair_id = ?) AS active_timer,
      EXISTS(SELECT 1 FROM repair_labor_entries WHERE repair_id = ?) AS labor,
      EXISTS(SELECT 1 FROM repair_parts WHERE repair_id = ?) AS used_parts,
      EXISTS(SELECT 1 FROM repair_planned_parts WHERE repair_id = ?) AS planned_parts,
      EXISTS(SELECT 1 FROM repair_part_requests WHERE repair_id = ?) AS part_requests,
      EXISTS(SELECT 1 FROM unmatched_part_requests WHERE repair_id = ?) AS unmatched_parts,
      EXISTS(SELECT 1 FROM attachments WHERE repair_id = ?) AS attachments,
      EXISTS(SELECT 1 FROM invoices WHERE repair_id = ?) AS invoices,
      EXISTS(SELECT 1 FROM maintenance_checklist_runs WHERE repair_id = ?) AS checklist,
      EXISTS(
        SELECT 1 FROM pm_next_repairs
        WHERE repair_id = ? OR origin_repair_id = ? OR queued_from_repair_id = ? OR target_repair_id = ?
      ) AS maintenance_links
  `).bind(
    repair.id, repair.id, repair.id, repair.id, repair.id, repair.id, repair.id, repair.id, repair.id,
    repair.id, repair.id, repair.id, repair.id,
  ).first<Record<string,number>>();
  const hasActivity = Object.values(activity ?? {}).some((value) => Number(value) > 0);
  if (hasActivity) {
    throw new Error('This repair already has recorded activity, so it cannot be deleted safely. Correct the unit or repair description instead so labor, parts, photos, and billing history are not lost.');
  }

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO repair_admin_deletions (
        repair_id, equipment_id, unit, title, parts_text, priority, status, source,
        technician_id, opened_at, deleted_by_user_id, deleted_by_name, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      repair.id, repair.equipment_id, repair.unit, repair.title, repair.parts_text, repair.priority,
      repair.status, repair.source, repair.technician_id, repair.opened_at,
      user.id, user.displayName, reason,
    ),
    env.DB.prepare('DELETE FROM repairs WHERE id = ?').bind(repair.id),
  ]);

  return { ok:true, deleted:true, repairId:`repair-${repair.id}` };
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
  return Response.json(payload, { status: response.status, headers: { 'cache-control':'no-store' } });
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
      const result = await assignToMeFromBoard(request, body);
      return Response.json(result, { headers:{ 'cache-control':'no-store' } });
    } catch (error) {
      console.error(JSON.stringify({ event:'repair_board_self_assign_failed', error:String(error) }));
      return Response.json({ error:error instanceof Error ? error.message : 'Work could not be assigned.' }, { status:400 });
    }
  }

  if (body && String(body.action ?? '') === 'createRepairForMe') {
    try {
      const result = await createRepairForTechnician(request, body);
      return Response.json(result, { headers:{ 'cache-control':'no-store' } });
    } catch (error) {
      console.error(JSON.stringify({ event:'repair_board_technician_create_failed', error:String(error) }));
      return Response.json({ error:error instanceof Error ? error.message : 'Repair could not be added.' }, { status:400 });
    }
  }

  if (body && String(body.action ?? '') === 'setUnitOos') {
    const user = await getSessionUser(env.DB,request);
    if (user?.role === 'mechanic') {
      try {
        const result = await setUnitOosByTechnician(request, body);
        return Response.json(result, { headers:{ 'cache-control':'no-store' } });
      } catch (error) {
        console.error(JSON.stringify({ event:'repair_board_technician_oos_failed', error:String(error) }));
        return Response.json({ error:error instanceof Error ? error.message : 'Unit could not be placed out of service.' }, { status:400 });
      }
    }
  }

  if (body && String(body.action ?? '') === 'editRepair') {
    try {
      const result = await editManualRepair(request, body);
      return Response.json(result, { headers:{ 'cache-control':'no-store' } });
    } catch (error) {
      console.error(JSON.stringify({ event:'repair_board_admin_edit_failed', error:String(error) }));
      return Response.json({ error:error instanceof Error ? error.message : 'Repair could not be corrected.' }, { status:400 });
    }
  }

  if (body && String(body.action ?? '') === 'deleteRepair') {
    try {
      const result = await deleteManualRepair(request, body);
      return Response.json(result, { headers:{ 'cache-control':'no-store' } });
    } catch (error) {
      console.error(JSON.stringify({ event:'repair_board_admin_delete_failed', error:String(error) }));
      return Response.json({ error:error instanceof Error ? error.message : 'Repair could not be deleted.' }, { status:400 });
    }
  }

  if (body && await isDeferredRepair(body.repairId ?? body.id)) {
    return Response.json({ error: 'This repair is intentionally saved for its next PM/Annual.' }, { status:400 });
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
