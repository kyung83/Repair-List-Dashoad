import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { GET as originalGET, POST as originalPOST } from './original';
import {
  consumeReservedPart,
  decorateShopParts,
  getRepairPartRequests,
  releaseRepairPartRequests,
  requestPartForRepair,
} from '@/lib/parts-lifecycle';

type Yard = '' | 'clare' | 'cadillac';
type ShopRepair = {
  id: string;
  equipmentId: number | null;
  technicianId: number | null;
  location?: string;
  status?: string;
  [key: string]: unknown;
};
type ShopPart = { id:number; partNumber:string; description:string; quantityOnHand:number; location:string; [key:string]:unknown };

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function normalizeYard(value: unknown): Yard {
  const yard = String(value ?? '').trim().toLowerCase();
  return yard === 'clare' || yard === 'cadillac' ? yard : '';
}

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
}

async function assignedYard(userId: number): Promise<Yard> {
  const row = await env.DB.prepare("SELECT COALESCE(yard, '') AS yard FROM app_users WHERE id = ?")
    .bind(userId)
    .first<{ yard: string }>();
  return normalizeYard(row?.yard);
}

async function isDeferredRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();
  return Boolean(row && deferred(row.status));
}

async function equipmentYards() {
  const rows = await env.DB.prepare(`
    SELECT id, COALESCE(current_yard, '') AS current_yard
    FROM equipment
    WHERE active = 1
  `).all<{ id: number; current_yard: string }>();
  return new Map(rows.results.map((row) => [Number(row.id), normalizeYard(row.current_yard)]));
}

function physicalYard(repair: ShopRepair, yards: Map<number, Yard>) {
  if (repair.equipmentId !== null) return yards.get(Number(repair.equipmentId)) ?? '';
  return normalizeYard(repair.location);
}

async function validateYardPickup(request: Request, body: Record<string, unknown>) {
  const action = String(body.action ?? '');
  if (action !== 'openRepair' && action !== 'claimRepair') return null;

  const user = await getSessionUser(env.DB, request);
  if (!user || user.role !== 'mechanic' || !user.technicianId) return null;

  const id = numericRepairId(body.repairId ?? body.id);
  if (!id) return null;
  const repair = await env.DB.prepare(`
    SELECT r.technician_id, r.equipment_id,
           COALESCE(e.current_yard, '') AS current_yard,
           COALESCE(r.location, '') AS repair_location
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<{
    technician_id: number | null;
    equipment_id: number | null;
    current_yard: string;
    repair_location: string;
  }>();
  if (!repair || repair.technician_id !== null) return null;

  const yard = await assignedYard(user.id);
  if (!yard) {
    return Response.json({ error: 'Your user account needs a yard assignment before you can pick up unassigned work.' }, { status: 409 });
  }
  const repairYard = repair.equipment_id !== null ? normalizeYard(repair.current_yard) : normalizeYard(repair.repair_location);
  if (repairYard !== yard) {
    const where = repairYard ? `${repairYard[0].toUpperCase()}${repairYard.slice(1)} yard` : 'outside your assigned yard';
    return Response.json({ error: `This repair is ${where}. You can only pick up unassigned work in your assigned yard.` }, { status: 403 });
  }
  return null;
}

async function requirePartAccess(request: Request, repairId: number) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!['mechanic','manager','admin'].includes(user.role)) throw new Error('This account cannot use repair parts.');
  const repair = await env.DB.prepare(`
    SELECT id, technician_id, COALESCE(status,'') AS status FROM repairs WHERE id = ?
  `).bind(repairId).first<{ id:number; technician_id:number|null; status:string }>();
  if (!repair) throw new Error('Repair was not found.');
  if (String(repair.status).toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  if (user.role === 'mechanic') {
    if (!user.technicianId || Number(repair.technician_id ?? 0) !== Number(user.technicianId)) {
      throw new Error('This repair is not assigned to you.');
    }
  }
  return { user, repair };
}

async function repairJobEvent(repairId:number,userId:number,technicianId:number|null,action:string,detail:string){
  await env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,?,?)`)
    .bind(repairId,userId,technicianId,action,detail.slice(0,500)).run();
}

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  const response = await originalGET(request);
  if (!response.ok) return response;

  const payload = await response.json() as {
    user?: Record<string, unknown>;
    activeTimer?: { repairId?: string } | null;
    repairs?: ShopRepair[];
    parts?: ShopPart[];
    [key: string]: unknown;
  };
  const activeRepairId = String(payload.activeTimer?.repairId ?? '');
  const yards = await equipmentYards();
  let repairs = (payload.repairs ?? []).filter((repair) => !deferred(repair.status));

  if (user && (user.role === 'mechanic' || user.role === 'manager')) {
    const yard = await assignedYard(user.id);
    if (yard) {
      repairs = repairs.filter((repair) => physicalYard(repair, yards) === yard || repair.id === activeRepairId);
    } else if (user.role === 'mechanic' && user.technicianId) {
      repairs = repairs.filter((repair) => Number(repair.technicianId ?? 0) === Number(user.technicianId) || repair.id === activeRepairId);
    } else {
      repairs = [];
    }
    payload.user = { ...(payload.user ?? {}), yard, yardAssigned: Boolean(yard) };
    payload.yardScope = { yard, yardAssigned: Boolean(yard) };
  }

  repairs = repairs.map((repair) => ({ ...repair, yard: physicalYard(repair, yards) }));
  payload.repairs = repairs;
  payload.parts = await decorateShopParts(env.DB, payload.parts ?? []);
  const visibleIds = new Set(repairs.map((repair) => numericRepairId(repair.id)).filter(Boolean));
  const requests = (await getRepairPartRequests(env.DB)).filter((partRequest) => visibleIds.has(partRequest.repairNumericId));
  payload.partRequests = requests;
  payload.partsReadyCount = requests.filter((partRequest) => partRequest.reservedQuantity > 0).length;
  return Response.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const clone = request.clone();
  let body: Record<string, unknown> | null = null;
  try {
    body = await clone.json() as Record<string, unknown>;
    if (await isDeferredRepair(body.repairId ?? body.id)) {
      return Response.json({ error: 'This repair is saved for a future PM/Annual and is not active shop work yet.' }, { status: 400 });
    }
    const yardError = await validateYardPickup(request.clone(), body);
    if (yardError) return yardError;

    const action = String(body.action ?? '');
    if (action === 'usePart') {
      const id = numericRepairId(body.repairId);
      if (!id) throw new Error('Repair was not found.');
      const { user } = await requirePartAccess(request.clone(), id);
      const yard = await assignedYard(user.id);
      const result = await requestPartForRepair(env.DB, {
        repairId: id,
        partId: Number(body.partId ?? 0),
        quantity: Number(body.quantity ?? 0),
        fallbackYard: yard,
        userId: user.id,
      });
      await repairJobEvent(
        id, user.id, user.technicianId ?? null,
        result.awaitingParts ? 'part_requested_awaiting' : 'part_used',
        result.awaitingParts
          ? `${result.partNumber}: ${result.reservedQuantity} reserved, ${result.shortageQuantity} awaiting in ${result.warehouseCode}.`
          : `${result.usedImmediately} x ${result.partNumber} used from ${result.warehouseCode}.`,
      );
      return Response.json({ ...result, repairId: `repair-${id}` });
    }

    if (action === 'useReservedPart') {
      const requestId = Number(body.requestId ?? 0);
      const requestRow = await env.DB.prepare('SELECT repair_id FROM repair_part_requests WHERE id = ?')
        .bind(requestId).first<{repair_id:number}>();
      if (!requestRow) throw new Error('Part request was not found.');
      const { user } = await requirePartAccess(request.clone(), Number(requestRow.repair_id));
      const result = await consumeReservedPart(env.DB, { requestId, quantity: body.quantity == null ? undefined : Number(body.quantity), userId: user.id });
      await repairJobEvent(result.repairId,user.id,user.technicianId??null,'reserved_part_used',`${result.quantity} reserved part unit(s) used.`);
      return Response.json({ ...result, repairId: `repair-${result.repairId}` });
    }
  } catch (error) {
    if (body && ['usePart','useReservedPart'].includes(String(body.action ?? ''))) {
      return Response.json({ error: error instanceof Error ? error.message : 'Part action failed.' }, { status: 400 });
    }
    // The original handler owns validation for other malformed/non-JSON requests.
  }

  const completionUser = body && String(body.action ?? '') === 'completeRepair' ? await getSessionUser(env.DB, request.clone()) : null;
  const response = await originalPOST(request);
  if (body && String(body.action ?? '') === 'completeRepair' && response.ok) {
    const payload = await response.json() as { completed?: boolean; repairId?: string; [key:string]:unknown };
    if (payload.completed) {
      const id = numericRepairId(payload.repairId ?? body.repairId);
      if (id) await releaseRepairPartRequests(env.DB, id, completionUser?.id ?? null);
    }
    return Response.json(payload, { status: response.status, headers: response.headers });
  }
  return response;
}
