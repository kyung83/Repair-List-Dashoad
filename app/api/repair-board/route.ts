import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { markGeotabDefectRepaired } from '@/lib/geotab';
import { GET as originalGET, POST as originalPOST } from './original';

type BoardRepair = {
  id:string; source:string; issue:string; status:string; technicianId:number|null; activeTimer:unknown;
  outOfService:boolean; equipmentType:string; equipmentId:number|null;
};
type OosUnit = { openWork?: Array<{status?:string}>; [key:string]: unknown };

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

async function isDeferredRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(id).first<{status:string}>();
  return Boolean(row && deferred(row.status));
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
