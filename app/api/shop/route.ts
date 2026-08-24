import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { applyPartToRepair } from '@/lib/inventory-operations';
import { getDerivedPartAvailability, requestPartDerived } from '@/lib/derived-reservations';
import { getRepairPartRequests } from '@/lib/parts-lifecycle';
import { normalizeYard } from '@/lib/yards';
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

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
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

async function restoreWorkingManagerAssignments(request:Request,response:Response) {
  const user = await getSessionUser(env.DB, request);
  if (!response.ok || user?.role !== 'manager' || !user.technicianId) return response;

  const payload = await response.json() as {
    repairs?:ShopRepair[];
    partRequests?:Array<{repairNumericId:number;reservedQuantity:number;[key:string]:unknown}>;
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
  const requests = (await getRepairPartRequests(env.DB)).filter((partRequest)=>repairIds.has(partRequest.repairNumericId));
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
  if (String(body.action ?? '') !== 'usePart') return legacyPOST(request);

  try {
    const repairId = numericRepairId(body.repairId);
    const partId = Number(body.partId ?? 0);
    const quantity = Number(body.quantity ?? 0);
    const warehouseCode = String(body.warehouseCode ?? '').trim().toUpperCase();
    if (!repairId) throw new Error('Repair was not found.');
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Choose a catalog part.');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a positive quantity.');
    if (!warehouseCode) throw new Error('Choose the warehouse that will supply this part.');

    const {user,repair} = await requirePartAccess(request.clone(),repairId);
    const availability = await getDerivedPartAvailability(env.DB);
    const stock = availability.find((row)=>row.partId === partId && row.warehouseCode === warehouseCode);
    if (!stock) throw new Error('That part is not stocked in the selected warehouse.');

    if (stock.available + 0.000001 >= quantity) {
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
      await repairJobEvent(repairId,user.id,repair.technician_id,'part_used',`${quantity} x ${stock.partNumber} applied from ${warehouseCode} (inventory operation ${result.operationId}).`);
      return Response.json({...result,partNumber:stock.partNumber,usedImmediately:quantity,awaitingParts:false});
    }

    const requestResult = await requestPartDerived(env.DB,{
      repairId,
      partId,
      quantity,
      warehouseCode,
      userId:user.id,
    });
    await repairJobEvent(repairId,user.id,repair.technician_id,'part_requested_awaiting',`${stock.partNumber}: ${quantity} requested from ${warehouseCode}; ${requestResult.shortageQuantity} currently short.`);
    return Response.json(requestResult,{status:200});
  } catch (error) {
    console.error(JSON.stringify({event:'shop_inventory_v2_action_failed',error:String(error)}));
    return Response.json({error:error instanceof Error ? error.message : 'Part action failed.'},{status:400});
  }
}
