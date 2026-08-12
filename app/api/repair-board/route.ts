import { env } from 'cloudflare:workers';
import { GET as originalGET, POST as originalPOST } from './original';

type BoardRepair = {
  id:string; source:string; status:string; technicianId:number|null; activeTimer:unknown;
  outOfService:boolean; equipmentType:string; equipmentId:number|null;
};
type OosUnit = { openWork?: Array<{status?:string}>; [key:string]: unknown };

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
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

export async function GET(request: Request) {
  const response = await originalGET(request);
  if (!response.ok) return response;
  const payload = await response.json() as {
    repairs?: BoardRepair[];
    oosUnits?: OosUnit[];
    summary?: Record<string, number>;
    [key:string]: unknown;
  };
  const repairs = (payload.repairs ?? []).filter((repair) => !deferred(repair.status));
  payload.repairs = repairs;
  if (Array.isArray(payload.oosUnits)) {
    payload.oosUnits = payload.oosUnits.map((unit) => ({
      ...unit,
      openWork: Array.isArray(unit.openWork) ? unit.openWork.filter((work) => !deferred(work.status)) : unit.openWork,
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
  try {
    const body = await clone.json() as Record<string, unknown>;
    if (await isDeferredRepair(body.repairId ?? body.id)) {
      return Response.json({ error: 'This repair is intentionally saved for its next PM/Annual.' }, { status: 400 });
    }
  } catch {
    // The original handler owns validation for malformed/non-JSON requests.
  }
  return originalPOST(request);
}
