import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { applyPartToRepair } from '@/lib/inventory-operations';
import { getDerivedPartAvailability, requestPartDerived } from '@/lib/derived-reservations';
import { getRepairPartRequests } from '@/lib/parts-lifecycle';
import { markGeotabDefectRepaired } from '@/lib/geotab';
import { normalizeYard, yardWarehouseCode } from '@/lib/yards';
import { completeRepairTypeChecklist, validateRepairTypeChecklistBeforeClose } from '@/lib/repair-types';
import { GET as originalGET } from './original';
import { GET as legacyGET, POST as legacyPOST } from './route-legacy';

type ShopRepair = {
  id:string;
  equipmentId:number|null;
  technicianId:number|null;
  location?:string;
  yard?:string;
  [key:string]:unknown;
};

type DvirRepairLink = {
  id:number;
  technician_id:number|null;
  status:string;
  geotab_defect_id:string|null;
  geotab_log_id:string|null;
  dvir_repaired:number|null;
};

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function assignedPartWarehouse(user:{id:number;role:string}) {
  if (user.role !== 'mechanic' && user.role !== 'manager') return null;
  const row=await env.DB.prepare("SELECT COALESCE(yard,'') AS yard FROM app_users WHERE id=?")
    .bind(user.id)
    .first<{yard:string}>();
  const code=yardWarehouseCode(row?.yard);
  if (!code) throw new Error('Your account needs an assigned yard/parts warehouse before you can use or request parts.');
  const warehouse=await env.DB.prepare('SELECT id,code,name FROM warehouses WHERE code=? AND active=1')
    .bind(code)
    .first<{id:number;code:string;name:string}>();
  if (!warehouse) throw new Error(`${code} is not configured as an active parts warehouse.`);
  return warehouse;
}

async function requirePartAccess(request: Request, repairId: number) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!['mechanic','manager','admin'].includes(user.role)) throw new Error('This account cannot use repair parts.');
  const repair = await env.DB.prepare(`
    SELECT id,technician_id,COALESCE(status,'') AS status
    FROM repairs WHERE id = ?
  `).bind(repairId).first<{id:number;technician_id:number|null;status:string}>();
  if (!repair) throw new Error('Repair was not found.');
  if (repair.status.toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  if (user.role === 'mechanic' && (!user.technicianId || Number(repair.technician_id ?? 0) !== Number(user.technicianId))) {
    throw new Error('This repair is not assigned to you.');
  }
  return {user,repair};
}

async function repairJobEvent(repairId:number,userId:number,technicianId:number|null,action:string,detail:string) {
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,?,?)
  `).bind(repairId,userId,technicianId,action,detail.slice(0,500)).run();
}

async function hasOpenPartNeed(repairId:number) {
  const row = await env.DB.prepare(`
    SELECT 1 AS found
    WHERE EXISTS (
      SELECT 1
      FROM repair_part_requests
      WHERE repair_id=?
        AND status='open'
        AND requested_quantity > used_quantity + 0.000001
    ) OR EXISTS (
      SELECT 1
      FROM unmatched_part_requests
      WHERE repair_id=?
        AND status='open'
    )
    LIMIT 1
  `).bind(repairId,repairId).first<{found:number}>();
  return Boolean(row?.found);
}

function alreadyWaitingForParts(status:unknown) {
  const normalized=String(status??'').trim().toLowerCase().replace(/\s+/g,' ');
  return normalized.includes('waiting for part')||normalized.includes('waiting on part');
}

async function reconcileDoneUnitWaiting(request:Request,response:Response) {
  if (!response.ok) return response;
  const payload = await response.json() as Record<string,unknown>;
  const repairId = numericRepairId(payload.repairId);
  if (!repairId || payload.unitDone !== true || !(await hasOpenPartNeed(repairId))) {
    return Response.json(payload,{status:response.status,headers:{'cache-control':'no-store'}});
  }

  const repair = await env.DB.prepare(`
    SELECT id,technician_id,COALESCE(status,'') AS status
    FROM repairs
    WHERE id=?
  `).bind(repairId).first<{id:number;technician_id:number|null;status:string}>();
  if (!repair || repair.status.toLowerCase().includes('complete')) {
    return Response.json(payload,{status:response.status,headers:{'cache-control':'no-store'}});
  }

  const wasWaiting = alreadyWaitingForParts(repair.status);
  await env.DB.prepare(`
    UPDATE repairs
    SET status='Waiting on Part',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
  `).bind(repairId).run();

  if (!wasWaiting) {
    const user = await getSessionUser(env.DB,request);
    if (user) {
      await repairJobEvent(
        repairId,
        user.id,
        repair.technician_id,
        'waiting_on_parts_reconciled',
        'Done Working found an outstanding parts request and kept this repair queued as Waiting on Parts.',
      );
    }
  }

  return Response.json({...payload,waitingOnPart:true},{status:response.status,headers:{'cache-control':'no-store'}});
}

async function markLinkedDvirRepairedBeforeShopCompletion(request:Request,repairId:number) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!user.technicianId) throw new Error('This account is not linked to a technician.');

  const repair = await env.DB.prepare(`
    SELECT r.id,r.technician_id,COALESCE(r.status,'') AS status,r.geotab_defect_id,
           d.geotab_log_id,d.repaired AS dvir_repaired
    FROM repairs r
    LEFT JOIN dvir_defects d ON d.geotab_defect_id = r.geotab_defect_id
    WHERE r.id = ?
  `).bind(repairId).first<DvirRepairLink>();
  if (!repair) throw new Error('Repair was not found.');
  if (repair.status.toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  if (Number(repair.technician_id ?? 0) !== Number(user.technicianId)) throw new Error('This repair is not assigned to you.');

  const timer = await env.DB.prepare(`
    SELECT repair_id FROM repair_labor_timers WHERE user_id = ?
  `).bind(user.id).first<{repair_id:number}>();
  if (!timer || Number(timer.repair_id) !== repairId) throw new Error('That repair is not WORKING NOW.');

  const defectId = String(repair.geotab_defect_id ?? '').trim();
  if (!defectId) return { linked:false, geotabRepaired:false };
  if (Number(repair.dvir_repaired ?? 0) === 1) return { linked:true, geotabRepaired:true };

  const logId = String(repair.geotab_log_id ?? '').trim();
  if (!logId) {
    throw new Error('This DVIR is missing its Geotab log link. The repair is still open and your labor timer is still running. Tell a manager.');
  }

  try {
    await markGeotabDefectRepaired(env,logId,defectId);
    await repairJobEvent(repairId,user.id,user.technicianId,'geotab_dvir_repaired','Mechanic REPAIRED action marked the linked DVIR defect repaired in Geotab.');
    return { linked:true, geotabRepaired:true };
  } catch (error) {
    console.error(JSON.stringify({event:'shop_geotab_dvir_repair_failed',repairId,defectId,error:String(error)}));
    await repairJobEvent(repairId,user.id,user.technicianId,'geotab_dvir_repair_failed','Geotab rejected or failed the linked DVIR repair update. Shop repair remained open.');
    throw new Error('Geotab could not mark this DVIR repaired. The shop repair is still open and your labor timer is still running. Try again or tell a manager.');
  }
}

async function autoWaitAfterPartShortage(
  request:Request,
  repairId:number,
  user:{id:number;technicianId:number|null},
  repairTechnicianId:number|null,
  detail:string,
) {
  const ownTimer = await env.DB.prepare('SELECT repair_id FROM repair_labor_timers WHERE user_id = ?')
    .bind(user.id).first<{repair_id:number}>();

  if (Number(ownTimer?.repair_id ?? 0) === repairId) {
    const headers = new Headers(request.headers);
    headers.set('content-type','application/json');
    headers.delete('content-length');
    const waitingRequest = new Request(request.url,{
      method:'POST',
      headers,
      body:JSON.stringify({
        action:'repairOutcome',
        repairId:`repair-${repairId}`,
        outcome:'waiting_part',
        notes:detail,
      }),
    });
    const response = await legacyPOST(waitingRequest);
    const payload = await response.json() as Record<string,unknown>;
    if (!response.ok || payload.ok === false) {
      throw new Error(String(payload.error ?? 'The part request was saved, but the repair could not move to Waiting on Part.'));
    }
    return payload;
  }

  const anyTimer = await env.DB.prepare('SELECT user_id FROM repair_labor_timers WHERE repair_id = ? LIMIT 1')
    .bind(repairId).first<{user_id:number}>();
  if (anyTimer) {
    return { waitingOnPart:false, activeLaborContinues:true };
  }

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE repairs
      SET status='Waiting on Part', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    `).bind(repairId),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'waiting_on_part',?)
    `).bind(repairId,user.id,repairTechnicianId,detail.slice(0,500)),
  ]);
  return { waitingOnPart:true, nextRepairId:null, laborStarted:false };
}

async function restoreWorkingManagerAssignments(request:Request,response:Response) {
  const user = await getSessionUser(env.DB, request);
  if (!response.ok || user?.role !== 'manager' || !user.technicianId) return response;

  const payload = await response.json() as {
    repairs?:ShopRepair[];
    user?:{assignedWarehouseCode?:string;[key:string]:unknown};
    partRequests?:Array<{repairNumericId:number;reservedQuantity:number;warehouseCode?:string;[key:string]:unknown}>;
    partsReadyCount?:number;
    [key:string]:unknown;
  };
  const fullResponse = await originalGET(request);
  if (!fullResponse.ok) return Response.json(payload,{status:response.status,headers:{'cache-control':'no-store'}});
  const full = await fullResponse.json() as {repairs?:ShopRepair[]};
  const technicianId = Number(user.technicianId);
  const assigned = (full.repairs ?? []).filter((repair)=>Number(repair.technicianId ?? 0) === technicianId);
  const visible = payload.repairs ?? [];
  const visibleIds = new Set(visible.map((repair)=>repair.id));
  const missing = assigned.filter((repair)=>!visibleIds.has(repair.id));
  if (!missing.length) return Response.json(payload,{status:response.status,headers:{'cache-control':'no-store'}});

  const equipment = await env.DB.prepare(`
    SELECT id,COALESCE(current_yard,'') AS current_yard
    FROM equipment
    WHERE active = 1
  `).all<{id:number;current_yard:string}>();
  const yards = new Map(equipment.results.map((row)=>[Number(row.id),normalizeYard(row.current_yard)]));
  const restored = missing.map((repair)=>({
    ...repair,
    yard:repair.equipmentId === null
      ? normalizeYard(repair.location)
      : yards.get(Number(repair.equipmentId)) ?? '',
  }));
  payload.repairs = [...visible,...restored];

  const repairIds = new Set(payload.repairs.map((repair)=>numericRepairId(repair.id)).filter(Boolean));
  const assignedWarehouseCode=String(payload.user?.assignedWarehouseCode??'');
  const requests = (await getRepairPartRequests(env.DB)).filter((partRequest)=>
    repairIds.has(partRequest.repairNumericId)
    && Boolean(assignedWarehouseCode)
    && partRequest.warehouseCode===assignedWarehouseCode
  );
  payload.partRequests = requests;
  payload.partsReadyCount = requests.filter((partRequest)=>partRequest.reservedQuantity > 0).length;
  return Response.json(payload,{status:response.status,headers:{'cache-control':'no-store'}});
}

export async function GET(request: Request) {
  return restoreWorkingManagerAssignments(request,await legacyGET(request));
}

export async function POST(request: Request) {
  const clone = request.clone();
  let body: Record<string,unknown>;
  try {
    body = await clone.json() as Record<string,unknown>;
  } catch {
    return legacyPOST(request);
  }

  const action = String(body.action ?? '');
  if (action === 'repairOutcome' && String(body.outcome ?? '') === 'repaired') {
    try {
      const repairId = numericRepairId(body.repairId);
      if (!repairId) throw new Error('Repair was not found.');
      await validateRepairTypeChecklistBeforeClose(env.DB,repairId);
      const dvir = await markLinkedDvirRepairedBeforeShopCompletion(request.clone(),repairId);
      const response = await legacyPOST(request);
      if (response.ok) await completeRepairTypeChecklist(env.DB,repairId);
      if (!response.ok || !dvir.linked) return response;
      const payload = await response.json() as Record<string,unknown>;
      return Response.json({...payload,geotabRepaired:dvir.geotabRepaired},{status:response.status,headers:{'cache-control':'no-store'}});
    } catch (error) {
      return Response.json({error:error instanceof Error?error.message:'Repair could not be completed.'},{status:409});
    }
  }

  if (action === 'doneUnit') {
    const sessionRequest = request.clone();
    return reconcileDoneUnitWaiting(sessionRequest,await legacyPOST(request));
  }

  if (action !== 'usePart') return legacyPOST(request);

  try {
    const repairId = numericRepairId(body.repairId);
    const partId = Number(body.partId ?? 0);
    const quantity = Number(body.quantity ?? 0);
    const requestedWarehouseCode = String(body.warehouseCode ?? '').trim().toUpperCase();
    if (!repairId) throw new Error('Repair was not found.');
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Choose a catalog part.');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a positive quantity.');

    const {user,repair} = await requirePartAccess(request.clone(),repairId);
    const assignedWarehouse = await assignedPartWarehouse(user);
    const warehouseCode = assignedWarehouse?.code ?? requestedWarehouseCode;
    if (!warehouseCode) throw new Error('Choose the warehouse that will supply this part.');

    const availability = await getDerivedPartAvailability(env.DB);
    const stock = availability.find((row)=>row.partId === partId && row.warehouseCode === warehouseCode);
    const part = stock
      ? {partNumber:stock.partNumber}
      : await env.DB.prepare('SELECT part_number AS partNumber FROM parts WHERE id=? AND active=1')
          .bind(partId)
          .first<{partNumber:string}>();
    if (!part) throw new Error('Part was not found.');

    if ((stock?.available ?? 0) + 0.000001 >= quantity) {
      const operationKey = String(body.operationKey ?? request.headers.get('idempotency-key') ?? `shop-apply:${crypto.randomUUID()}`);
      const result = await applyPartToRepair(env.DB,{
        operationKey,
        repairId,
        partId,
        quantity,
        warehouseCode,
        userId:user.id,
        source:'technician',
        note:`Applied from technician repair tools by ${user.displayName || user.username}.`,
      });
      await repairJobEvent(repairId,user.id,repair.technician_id,'part_used',`${quantity} x ${part.partNumber} applied from ${warehouseCode} (inventory operation ${result.operationId}).`);
      return Response.json({...result,partNumber:part.partNumber,warehouseCode,usedImmediately:quantity,awaitingParts:false});
    }

    const requestResult = await requestPartDerived(env.DB,{
      repairId,
      partId,
      quantity,
      warehouseCode,
      userId:user.id,
    });
    const shortageDetail = `${part.partNumber}: ${quantity} requested from ${warehouseCode}; ${requestResult.shortageQuantity} currently short.`;
    await repairJobEvent(repairId,user.id,repair.technician_id,'part_requested_awaiting',shortageDetail);
    const waitingResult = await autoWaitAfterPartShortage(
      request.clone(),
      repairId,
      {id:user.id,technicianId:user.technicianId ?? null},
      repair.technician_id,
      `Part shortage requested from Part Lookup. ${shortageDetail}`,
    );
    return Response.json({...requestResult,...waitingResult,awaitingParts:true},{status:200});
  } catch (error) {
    console.error(JSON.stringify({event:'shop_inventory_v2_action_failed',error:String(error)}));
    return Response.json({error:error instanceof Error ? error.message : 'Part action failed.'},{status:400});
  }
}