import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getShopLaborRate } from '@/lib/billing';
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
type SessionUser = {
  id:number;
  role:string;
  technicianId:number|null;
};
type Technician = { id:number; name:string };
type LaborStop = { repairId:number; hours:number; rate:number };

type RepairUnit = {
  id:number;
  equipment_id:number|null;
  technician_id:number|null;
  status:string;
  title:string;
  unit:string;
};

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
}

function completed(status: unknown) {
  return String(status ?? '').toLowerCase().includes('complete');
}

function waitingOnPart(status: unknown) {
  return String(status ?? '').trim().toLowerCase() === 'waiting on part';
}

function timestampMs(value: string) {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error('Labor timer start time is invalid.');
  return parsed;
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
  if (!['openRepair','claimRepair','startUnit','switchRepair'].includes(action)) return null;

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
  if (completed(repair.status)) throw new Error('That repair is already completed.');
  if (user.role === 'mechanic') {
    if (!user.technicianId || Number(repair.technician_id ?? 0) !== Number(user.technicianId)) {
      throw new Error('This repair is not assigned to you.');
    }
  }
  return { user, repair };
}

async function requireTechnician(user: SessionUser): Promise<Technician> {
  if (!user.technicianId) throw new Error('This account is not linked to a technician. Ask an administrator to update the account.');
  const technician = await env.DB.prepare('SELECT id, name FROM technicians WHERE id = ? AND active = 1')
    .bind(user.technicianId)
    .first<Technician>();
  if (!technician) throw new Error('The linked technician record is not active.');
  return technician;
}

async function repairJobEvent(repairId:number,userId:number,technicianId:number|null,action:string,detail:string){
  await env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,?,?)`)
    .bind(repairId,userId,technicianId,action,detail.slice(0,500)).run();
}

async function loadRepairUnit(id:number): Promise<RepairUnit> {
  const row = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.status,'') AS status,
           COALESCE(r.title,'') AS title, COALESCE(e.unit,'') AS unit
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<RepairUnit>();
  if (!row) throw new Error('Repair was not found.');
  return row;
}

function isSameUnit(left: RepairUnit, right: RepairUnit) {
  if (left.equipment_id !== null || right.equipment_id !== null) {
    return left.equipment_id !== null && right.equipment_id !== null && Number(left.equipment_id) === Number(right.equipment_id);
  }
  return left.id === right.id;
}

async function activeTimer(userId:number) {
  return env.DB.prepare(`
    SELECT user_id, repair_id, technician_id, started_at, COALESCE(notes,'') AS notes
    FROM repair_labor_timers WHERE user_id = ?
  `).bind(userId).first<{
    user_id:number; repair_id:number; technician_id:number; started_at:string; notes:string;
  }>();
}

async function stopLaborSession(
  user: SessionUser,
  technician: Technician,
  expectedRepairId?: number,
  requireTimer = true,
  stopNotesValue: unknown = '',
): Promise<LaborStop|null> {
  const timer = await activeTimer(user.id);
  if (!timer) {
    if (requireTimer) throw new Error('You do not have an active labor timer.');
    return null;
  }
  if (expectedRepairId && expectedRepairId !== Number(timer.repair_id)) {
    throw new Error('That repair is not the repair you are working on now.');
  }

  const elapsedHours = Math.max(0.01, Math.round(((Date.now() - timestampMs(timer.started_at)) / 3600000) * 100) / 100);
  const rate = await getShopLaborRate(env.DB);
  const laborDate = new Date().toISOString().slice(0, 10);
  const stopNotes = String(stopNotesValue ?? '').trim().slice(0, 500);
  const notes = [timer.notes, stopNotes].filter(Boolean).join(' — ').slice(0, 500);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO repair_labor_entries (repair_id, technician_id, labor_date, hours, rate, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(timer.repair_id, timer.technician_id, laborDate, elapsedHours, rate, notes),
    env.DB.prepare('DELETE FROM repair_labor_timers WHERE user_id = ?').bind(user.id),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      VALUES (?, ?, ?, 'labor_stopped', ?)
    `).bind(timer.repair_id, user.id, timer.technician_id, `${technician.name} labor segment saved at ${elapsedHours.toFixed(2)} hours.`),
    env.DB.prepare(`
      UPDATE repairs
      SET labor_hours = (SELECT COALESCE(SUM(hours), 0) FROM repair_labor_entries WHERE repair_id = ?),
          labor_rate = COALESCE((SELECT SUM(hours * rate) / NULLIF(SUM(hours), 0) FROM repair_labor_entries WHERE repair_id = ?), ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(timer.repair_id, timer.repair_id, rate, timer.repair_id),
  ]);

  return { repairId:Number(timer.repair_id), hours:elapsedHours, rate };
}

async function startLaborSession(user:SessionUser, technician:Technician, id:number, notesValue:unknown='') {
  const repair = await loadRepairUnit(id);
  if (completed(repair.status)) throw new Error('Completed repairs cannot be opened for labor.');
  if (repair.technician_id !== null && Number(repair.technician_id) !== technician.id) {
    throw new Error('That repair is assigned to another technician.');
  }
  const existing = await activeTimer(user.id);
  if (existing) {
    if (Number(existing.repair_id) === id) return { repair, alreadyRunning:true };
    throw new Error('Labor is already running. The software must save that repair before switching.');
  }

  const notes = String(notesValue ?? '').trim().slice(0,500);
  const wasUnassigned = repair.technician_id === null;
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE repairs
      SET technician_id = ?, driver = ?,
          status = CASE WHEN lower(trim(COALESCE(status,''))) = 'waiting on part' THEN 'Open' ELSE status END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (technician_id IS NULL OR technician_id = ?)
        AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    `).bind(technician.id, technician.name, id, technician.id),
    env.DB.prepare(`
      INSERT INTO repair_labor_timers (user_id, repair_id, technician_id, notes)
      SELECT ?, r.id, ?, ? FROM repairs r
      WHERE r.id = ? AND r.technician_id = ?
        AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
    `).bind(user.id, technician.id, notes, id, technician.id),
  ]);
  if (Number(results[1]?.meta.changes ?? 0) === 0) throw new Error('Labor could not be started for that repair.');
  if (wasUnassigned) await repairJobEvent(id,user.id,technician.id,'claimed',`${technician.name} claimed the repair while opening the unit workspace.`);
  await repairJobEvent(id,user.id,technician.id,'labor_started',`${technician.name} began working on this repair.`);
  return { repair:await loadRepairUnit(id), alreadyRunning:false };
}

async function nextSensibleRepair(currentId:number, technicianId:number) {
  const current = await loadRepairUnit(currentId);
  if (current.equipment_id === null) return null;
  return env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.status,'') AS status,
           COALESCE(r.title,'') AS title, COALESCE(e.unit,'') AS unit
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.equipment_id = ? AND r.id <> ?
      AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      AND lower(trim(COALESCE(r.status,''))) <> 'waiting on part'
      AND (r.technician_id IS NULL OR r.technician_id = ?)
    ORDER BY CASE WHEN r.technician_id = ? THEN 0 ELSE 1 END,
             CASE trim(COALESCE(r.priority,'2')) WHEN '1' THEN 0 WHEN '2' THEN 1 WHEN '3' THEN 2 ELSE 1 END,
             r.id ASC
    LIMIT 1
  `).bind(current.equipment_id,currentId,technicianId,technicianId).first<RepairUnit>();
}

async function startNextIfAvailable(user:SessionUser, technician:Technician, currentId:number) {
  const next = await nextSensibleRepair(currentId, technician.id);
  if (!next) return null;
  await startLaborSession(user,technician,next.id);
  return next;
}

async function hasOpenPartShortage(repairId:number) {
  const row = await env.DB.prepare(`
    SELECT id FROM repair_part_requests
    WHERE repair_id = ? AND status = 'open'
      AND requested_quantity > used_quantity + reserved_quantity + 0.000001
    LIMIT 1
  `).bind(repairId).first<{id:number}>();
  return Boolean(row);
}

async function handleStartUnit(request:Request, body:Record<string,unknown>) {
  const user = await getSessionUser(env.DB, request) as SessionUser|null;
  if (!user) throw new Error('Authentication required.');
  const technician = await requireTechnician(user);
  const id = numericRepairId(body.repairId);
  if (!id) throw new Error('Choose a repair to start this unit.');
  const existing = await activeTimer(user.id);
  if (existing) {
    const activeRepair = await loadRepairUnit(Number(existing.repair_id));
    const target = await loadRepairUnit(id);
    if (!isSameUnit(activeRepair,target)) throw new Error('Finish working on the current unit before opening a different unit.');
    if (Number(existing.repair_id) !== id) {
      const stopped = await stopLaborSession(user,technician,Number(existing.repair_id),true,'Switched repairs on the same unit.');
      await startLaborSession(user,technician,id);
      return { ok:true, repairId:`repair-${id}`, previousRepairId:`repair-${stopped!.repairId}`, hours:stopped!.hours, laborStarted:true, switched:true };
    }
    return { ok:true, repairId:`repair-${id}`, alreadyRunning:true };
  }
  await startLaborSession(user,technician,id);
  return { ok:true, repairId:`repair-${id}`, laborStarted:true };
}

async function handleSwitchRepair(request:Request, body:Record<string,unknown>) {
  const user = await getSessionUser(env.DB, request) as SessionUser|null;
  if (!user) throw new Error('Authentication required.');
  const technician = await requireTechnician(user);
  const id = numericRepairId(body.repairId);
  if (!id) throw new Error('Choose a repair.');
  const timer = await activeTimer(user.id);
  if (!timer) {
    await startLaborSession(user,technician,id);
    return { ok:true, repairId:`repair-${id}`, laborStarted:true };
  }
  if (Number(timer.repair_id) === id) return { ok:true, repairId:`repair-${id}`, alreadyRunning:true };
  const current = await loadRepairUnit(Number(timer.repair_id));
  const target = await loadRepairUnit(id);
  if (!isSameUnit(current,target)) throw new Error('Use Done Working on Unit before moving to another unit.');
  const stopped = await stopLaborSession(user,technician,Number(timer.repair_id),true,'Switched repairs on the same unit.');
  await startLaborSession(user,technician,id);
  return { ok:true, repairId:`repair-${id}`, previousRepairId:`repair-${stopped!.repairId}`, hours:stopped!.hours, laborStarted:true, switched:true };
}

async function handleDoneUnit(request:Request, body:Record<string,unknown>) {
  const user = await getSessionUser(env.DB, request) as SessionUser|null;
  if (!user) throw new Error('Authentication required.');
  const technician = await requireTechnician(user);
  const stopped = await stopLaborSession(user,technician,undefined,true,body.notes);
  await repairJobEvent(stopped!.repairId,user.id,technician.id,'unit_session_ended',`${technician.name} finished working on the unit for now. Open repairs were left open.`);
  return { ok:true, repairId:`repair-${stopped!.repairId}`, hours:stopped!.hours, unitDone:true };
}

async function handleRepairOutcome(request:Request, body:Record<string,unknown>) {
  const user = await getSessionUser(env.DB, request) as SessionUser|null;
  if (!user) throw new Error('Authentication required.');
  const technician = await requireTechnician(user);
  const id = numericRepairId(body.repairId);
  if (!id) throw new Error('Repair was not found.');
  const outcome = String(body.outcome ?? '');
  if (!['repaired','waiting_part','skip'].includes(outcome)) throw new Error('Unknown repair outcome.');
  const timer = await activeTimer(user.id);
  if (!timer || Number(timer.repair_id) !== id) throw new Error('That repair is not WORKING NOW.');

  let partResult: Record<string,unknown>|null = null;
  if (outcome === 'waiting_part') {
    let shortage = await hasOpenPartShortage(id);
    if (!shortage) {
      const partId = Number(body.partId ?? 0);
      const quantity = Number(body.quantity ?? 0);
      if (!Number.isInteger(partId) || partId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
        return { ok:false, needsPart:true, error:'Select the needed part and quantity.' };
      }
      const yard = await assignedYard(user.id);
      partResult = await requestPartForRepair(env.DB,{ repairId:id, partId, quantity, fallbackYard:yard, userId:user.id });
      shortage = Boolean(partResult.awaitingParts);
      if (!shortage) {
        await repairJobEvent(id,user.id,technician.id,'part_available',`${String(partResult.partNumber ?? 'Part')} was available and applied; labor kept running.`);
        return { ok:true, repairId:`repair-${id}`, partAvailable:true, ...partResult };
      }
    }
  }

  const stopped = await stopLaborSession(user,technician,id,true,body.notes);
  if (outcome === 'repaired') {
    const result = await env.DB.prepare(`
      UPDATE repairs
      SET status='Completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND technician_id=? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    `).bind(id,technician.id).run();
    if (Number(result.meta.changes ?? 0) === 0) throw new Error('Repair could not be completed.');
    await releaseRepairPartRequests(env.DB,id,user.id);
    await repairJobEvent(id,user.id,technician.id,'completed',`${technician.name} reported Repaired.`);
  } else if (outcome === 'waiting_part') {
    await env.DB.prepare(`UPDATE repairs SET status='Waiting on Part', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
    await repairJobEvent(id,user.id,technician.id,'waiting_on_part',`${technician.name} reported Waiting on Part. Parts Desk is already updated.`);
  } else {
    await env.DB.prepare(`UPDATE repairs SET status='Open', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
    await repairJobEvent(id,user.id,technician.id,'skipped_for_now',`${technician.name} skipped this repair for now.`);
  }

  const next = await startNextIfAvailable(user,technician,id);
  return {
    ok:true,
    repairId:`repair-${id}`,
    hours:stopped!.hours,
    completed:outcome==='repaired',
    waitingOnPart:outcome==='waiting_part',
    skipped:outcome==='skip',
    nextRepairId:next?`repair-${next.id}`:null,
    laborStarted:Boolean(next),
    ...(partResult ?? {}),
  };
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
    if (action === 'startUnit') return Response.json(await handleStartUnit(request.clone(),body));
    if (action === 'switchRepair') return Response.json(await handleSwitchRepair(request.clone(),body));
    if (action === 'repairOutcome') {
      const result = await handleRepairOutcome(request.clone(),body);
      return Response.json(result,{status:result.ok===false?409:200});
    }
    if (action === 'doneUnit') return Response.json(await handleDoneUnit(request.clone(),body));

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
    if (body && ['usePart','useReservedPart','startUnit','switchRepair','repairOutcome','doneUnit'].includes(String(body.action ?? ''))) {
      return Response.json({ error: error instanceof Error ? error.message : 'Shop action failed.' }, { status: 400 });
    }
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