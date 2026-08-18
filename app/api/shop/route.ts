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
import { normalizeYard, yardLabel, type YardSelection } from '@/lib/yards';

type Yard = YardSelection;
type ShopRepair = {
  id: string;
  equipmentId: number | null;
  technicianId: number | null;
  location?: string;
  status?: string;
  [key: string]: unknown;
};
type ShopPart = { id:number; partNumber:string; description:string; quantityOnHand:number; location:string; [key:string]:unknown };
type OriginalActionResult = {
  ok?: boolean;
  error?: string;
  repairId?: string;
  hours?: number;
  rate?: number;
  laborStarted?: boolean;
  completed?: boolean;
  claimed?: boolean;
  [key: string]: unknown;
};
type WorkflowRepair = {
  id: number;
  equipment_id: number | null;
  technician_id: number | null;
  status: string;
  title: string;
};

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
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
    const where = repairYard ? `${yardLabel(repairYard)} yard` : 'outside your assigned yard';
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

function originalActionRequest(request: Request, body: Record<string, unknown>) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function runOriginalAction(request: Request, body: Record<string, unknown>) {
  const response = await originalPOST(originalActionRequest(request, body));
  const payload = await response.json() as OriginalActionResult;
  return { status: response.status, payload };
}

function originalFailure(result: Awaited<ReturnType<typeof runOriginalAction>>, fallback: string) {
  return Response.json(
    { error: result.payload.error || fallback },
    { status: result.status >= 400 ? result.status : 400 },
  );
}

async function activeRepairForUser(userId: number) {
  return env.DB.prepare(`
    SELECT rt.repair_id, r.equipment_id
    FROM repair_labor_timers rt
    JOIN repairs r ON r.id = rt.repair_id
    WHERE rt.user_id = ?
  `).bind(userId).first<{ repair_id: number; equipment_id: number | null }>();
}

async function workflowRepair(id: number) {
  return env.DB.prepare(`
    SELECT id, equipment_id, technician_id, COALESCE(status,'') AS status, COALESCE(title,'') AS title
    FROM repairs
    WHERE id = ?
  `).bind(id).first<WorkflowRepair>();
}

function sameWorkflowUnit(left: WorkflowRepair, right: WorkflowRepair) {
  return left.equipment_id !== null && right.equipment_id !== null && Number(left.equipment_id) === Number(right.equipment_id);
}

async function repairHasPartShortage(repairId: number) {
  const row = await env.DB.prepare(`
    SELECT 1 AS waiting
    FROM repair_part_requests
    WHERE repair_id = ? AND status = 'open'
      AND requested_quantity > used_quantity + reserved_quantity + 0.000001
    LIMIT 1
  `).bind(repairId).first<{ waiting: number }>();
  return Boolean(row);
}

async function nextActionableRepair(current: WorkflowRepair, technicianId: number, userId: number) {
  if (current.equipment_id === null) return null;
  return env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.status,'') AS status, COALESCE(r.title,'') AS title
    FROM repairs r
    WHERE r.equipment_id = ?
      AND r.id <> ?
      AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      AND lower(COALESCE(r.status,'')) NOT LIKE 'deferred to next%'
      AND (r.technician_id IS NULL OR r.technician_id = ?)
      AND NOT EXISTS (
        SELECT 1
        FROM repair_part_requests q
        WHERE q.repair_id = r.id AND q.status = 'open'
          AND q.requested_quantity > q.used_quantity + q.reserved_quantity + 0.000001
      )
      AND NOT EXISTS (
        SELECT 1
        FROM repair_job_events skipped
        WHERE skipped.repair_id = r.id
          AND skipped.user_id = ?
          AND skipped.action = 'skipped_for_now'
          AND skipped.id > (
            SELECT MAX(started.id)
            FROM repair_job_events started
            JOIN repairs started_repair ON started_repair.id = started.repair_id
            WHERE started.user_id = ?
              AND started.action = 'unit_work_started'
              AND started_repair.equipment_id = r.equipment_id
          )
      )
    ORDER BY CASE WHEN r.technician_id = ? THEN 0 ELSE 1 END,
             CASE trim(COALESCE(r.priority,'2')) WHEN '1' THEN 0 WHEN '2' THEN 1 WHEN '3' THEN 2 ELSE 1 END,
             r.opened_at ASC, r.id ASC
    LIMIT 1
  `).bind(current.equipment_id, current.id, technicianId, userId, userId, technicianId).first<WorkflowRepair>();
}

async function handleTechnicianWorkflow(request: Request, body: Record<string, unknown>) {
  const action = String(body.action ?? '');
  if (!['startUnit','switchRepair','advanceRepair','doneUnit'].includes(action)) return null;

  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (!user.technicianId) {
    return Response.json({ error: 'This account is not linked to a technician.' }, { status: 409 });
  }

  if (action === 'startUnit') {
    const targetId = numericRepairId(body.repairId ?? body.id);
    if (!targetId) return Response.json({ error: 'Choose a repair on the unit to begin.' }, { status: 400 });
    if (await activeRepairForUser(user.id)) {
      return Response.json({ error: 'You are already working on a unit. Finish that unit first.' }, { status: 409 });
    }
    const target = await workflowRepair(targetId);
    if (!target) return Response.json({ error: 'Repair was not found.' }, { status: 404 });
    if (deferred(target.status) || target.status.toLowerCase().includes('complete')) {
      return Response.json({ error: 'That repair is not active shop work.' }, { status: 400 });
    }
    if (target.technician_id !== null && Number(target.technician_id) !== Number(user.technicianId)) {
      return Response.json({ error: 'That repair is assigned to another technician.' }, { status: 403 });
    }
    if (await repairHasPartShortage(targetId)) {
      return Response.json({ error: 'That repair is waiting on a short part. Choose another repair on the unit.' }, { status: 409 });
    }
    const yardError = await validateYardPickup(request.clone(), { action: 'openRepair', repairId: `repair-${targetId}` });
    if (yardError) return yardError;
    const opened = await runOriginalAction(request, { action: 'openRepair', repairId: `repair-${targetId}` });
    if (!opened.payload.ok) return originalFailure(opened, 'Unit work could not be started.');
    await repairJobEvent(
      targetId,
      user.id,
      user.technicianId,
      'unit_work_started',
      'Technician started a unit work session. Repair handoffs will save separate labor entries automatically.',
    );
    return Response.json({ ...opened.payload, unitStarted: true });
  }

  if (action === 'doneUnit') {
    const active = await activeRepairForUser(user.id);
    if (!active) return Response.json({ ok: true, unitStopped: true });
    const stopped = await runOriginalAction(request, { action: 'stopLabor', repairId: `repair-${active.repair_id}` });
    if (!stopped.payload.ok) return originalFailure(stopped, 'Labor could not be stopped.');
    await repairJobEvent(
      active.repair_id,
      user.id,
      user.technicianId,
      'unit_work_paused',
      'Technician finished working on the unit for now. Remaining repairs stay open.',
    );
    return Response.json({
      ok: true,
      repairId: `repair-${active.repair_id}`,
      hours: stopped.payload.hours,
      rate: stopped.payload.rate,
      unitStopped: true,
    });
  }

  if (action === 'switchRepair') {
    const targetId = numericRepairId(body.repairId ?? body.id);
    if (!targetId) return Response.json({ error: 'Choose a repair to work on.' }, { status: 400 });
    const target = await workflowRepair(targetId);
    if (!target) return Response.json({ error: 'Repair was not found.' }, { status: 404 });
    if (deferred(target.status) || target.status.toLowerCase().includes('complete')) {
      return Response.json({ error: 'That repair is not active shop work.' }, { status: 400 });
    }
    if (target.technician_id !== null && Number(target.technician_id) !== Number(user.technicianId)) {
      return Response.json({ error: 'That repair is assigned to another technician.' }, { status: 403 });
    }

    const yardError = await validateYardPickup(request.clone(), { action: 'openRepair', repairId: `repair-${targetId}` });
    if (yardError) return yardError;

    const active = await activeRepairForUser(user.id);
    if (!active) {
      const opened = await runOriginalAction(request, { action: 'openRepair', repairId: `repair-${targetId}` });
      if (!opened.payload.ok) return originalFailure(opened, 'Repair could not be opened.');
      await repairJobEvent(
        targetId,
        user.id,
        user.technicianId,
        'unit_work_started',
        'Technician started a unit work session from a repair selection.',
      );
      return Response.json({ ...opened.payload, switched: false, unitStarted: true });
    }
    if (Number(active.repair_id) === targetId) {
      return Response.json({ ok: true, repairId: `repair-${targetId}`, alreadyRunning: true });
    }

    const current = await workflowRepair(Number(active.repair_id));
    if (!current || !sameWorkflowUnit(current, target)) {
      return Response.json({ error: 'Finish the current unit before starting work on a different unit.' }, { status: 409 });
    }

    const stopped = await runOriginalAction(request, { action: 'stopLabor', repairId: `repair-${current.id}` });
    if (!stopped.payload.ok) return originalFailure(stopped, 'Current labor could not be saved.');

    const opened = await runOriginalAction(request, { action: 'openRepair', repairId: `repair-${targetId}` });
    if (!opened.payload.ok) {
      await runOriginalAction(request, { action: 'openRepair', repairId: `repair-${current.id}` });
      return originalFailure(opened, 'The next repair could not be opened.');
    }
    await repairJobEvent(
      current.id,
      user.id,
      user.technicianId,
      'repair_handoff',
      `Labor moved directly to repair #${targetId}.`,
    );
    return Response.json({
      ok: true,
      repairId: `repair-${targetId}`,
      previousRepairId: `repair-${current.id}`,
      hours: stopped.payload.hours,
      laborStarted: true,
      switched: true,
    });
  }

  const currentId = numericRepairId(body.repairId ?? body.id);
  const mode = String(body.mode ?? '').toLowerCase();
  if (!currentId || !['repaired','waiting_parts','skipped'].includes(mode)) {
    return Response.json({ error: 'Repair and workflow action are required.' }, { status: 400 });
  }

  const current = await workflowRepair(currentId);
  if (!current) return Response.json({ error: 'Repair was not found.' }, { status: 404 });
  if (Number(current.technician_id ?? 0) !== Number(user.technicianId)) {
    return Response.json({ error: 'This repair is not assigned to you.' }, { status: 403 });
  }
  const active = await activeRepairForUser(user.id);
  if (!active || Number(active.repair_id) !== currentId) {
    return Response.json({ error: 'Work on this repair first so labor is recorded against the right job.' }, { status: 409 });
  }
  if (mode === 'waiting_parts' && !(await repairHasPartShortage(currentId))) {
    return Response.json({
      error: 'Request the needed part first. Waiting on Part becomes available when the repair has an actual part shortage.',
    }, { status: 409 });
  }

  let hours: number | undefined;
  if (mode === 'repaired') {
    const completed = await runOriginalAction(request, { action: 'completeRepair', repairId: `repair-${currentId}` });
    if (!completed.payload.ok) return originalFailure(completed, 'Repair could not be completed.');
    hours = typeof completed.payload.hours === 'number' ? completed.payload.hours : undefined;
    await releaseRepairPartRequests(env.DB, currentId, user.id);
  } else {
    const stopped = await runOriginalAction(request, { action: 'stopLabor', repairId: `repair-${currentId}` });
    if (!stopped.payload.ok) return originalFailure(stopped, 'Labor could not be saved.');
    hours = typeof stopped.payload.hours === 'number' ? stopped.payload.hours : undefined;
    if (mode === 'waiting_parts') {
      await repairJobEvent(
        currentId,
        user.id,
        user.technicianId,
        'waiting_on_part',
        'Technician paused this repair for an unresolved part shortage and moved on.',
      );
    } else {
      await repairJobEvent(
        currentId,
        user.id,
        user.technicianId,
        'skipped_for_now',
        'Technician skipped this repair for now. The repair remains open.',
      );
    }
  }

  const next = await nextActionableRepair(current, user.technicianId, user.id);
  if (next) {
    const nextYardError = await validateYardPickup(request.clone(), { action: 'openRepair', repairId: `repair-${next.id}` });
    if (!nextYardError) {
      const opened = await runOriginalAction(request, { action: 'openRepair', repairId: `repair-${next.id}` });
      if (opened.payload.ok) {
        return Response.json({
          ok: true,
          repairId: `repair-${next.id}`,
          previousRepairId: `repair-${currentId}`,
          nextRepairId: `repair-${next.id}`,
          completed: mode === 'repaired',
          waitingOnPart: mode === 'waiting_parts',
          skipped: mode === 'skipped',
          advanced: true,
          laborStarted: true,
          hours,
        });
      }
    }
  }

  return Response.json({
    ok: true,
    ...(mode === 'repaired' ? {} : { repairId: `repair-${currentId}` }),
    previousRepairId: `repair-${currentId}`,
    completed: mode === 'repaired',
    waitingOnPart: mode === 'waiting_parts',
    skipped: mode === 'skipped',
    advanced: false,
    hours,
  });
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

    const workflowResponse = await handleTechnicianWorkflow(request.clone(), body);
    if (workflowResponse) return workflowResponse;

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
    if (body && ['usePart','useReservedPart','startUnit','switchRepair','advanceRepair','doneUnit'].includes(String(body.action ?? ''))) {
      return Response.json({ error: error instanceof Error ? error.message : 'Shop action failed.' }, { status: 400 });
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
