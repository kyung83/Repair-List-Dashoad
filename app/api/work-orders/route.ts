import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { removePartFromRepair } from '@/lib/inventory-db';
import { applyPartToRepair, undoInventoryOperation } from '@/lib/inventory-operations';
import { getWorkOrderData, handleWorkOrderAction } from '@/lib/work-orders';
import { isRepairCompleted, isRepairDeferred } from '@/lib/status';
import { displayRepairType, listRepairTypes, requireRepairType } from '@/lib/repair-types';
import { handleReviewCorrection } from './review-corrections';
import { addReviewPart } from './review-part-correction';

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^repair-(\d+)$/);
  if (!match) throw new Error('Repair row not found');
  return Number(match[1]);
}
function operationKey(request: Request, body: Record<string,unknown>, prefix: string) {
  return String(body.operationKey ?? request.headers.get('idempotency-key') ?? `${prefix}:${crypto.randomUUID()}`);
}
function repairTypeRequired(source:string){return ['manual','geotab-dvir','repair-type-checklist'].includes(source)}

async function enforceTechnicianScope(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  const rawRepairId = body.id ?? body.repairId;
  const match = String(rawRepairId ?? '').match(/^repair-(\d+)$/);
  if (match) {
    const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(Number(match[1])).first<{status:string}>();
    if (row && isRepairDeferred(row.status)) throw new Error('This repair is saved for a future PM/Annual and is not active work yet.');
  }
  if (user.role !== 'mechanic') return;
  if (!user.technicianId) throw new Error('This technician login is not linked to a technician record.');
  const action = String(body.action ?? '');
  if (!['usePart', 'completeRepair', 'addLabor'].includes(action)) throw new Error('Technicians can only change their assigned repairs from the shop workspace.');
  const repairId = repairNumber(action === 'completeRepair' ? (body.id ?? body.repairId) : body.repairId);
  const repair = await env.DB.prepare('SELECT technician_id, status FROM repairs WHERE id = ?').bind(repairId).first<{ technician_id: number | null; status: string }>();
  if (!repair) throw new Error('Repair was not found.');
  if (Number(repair.technician_id ?? 0) !== user.technicianId) throw new Error('This repair is not assigned to you.');
  if (isRepairCompleted(repair.status)) throw new Error('That repair is already completed.');
}

async function reviewUpdateRepairType(request:Request,body:Record<string,unknown>){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required to correct repair types.');
  const id=repairNumber(body.repairId);
  const repair=await env.DB.prepare(`SELECT id,equipment_id,repair_type_id,COALESCE(status,'') AS status,COALESCE(source,'manual') AS source,reviewed_at FROM repairs WHERE id=?`).bind(id).first<{id:number;equipment_id:number|null;repair_type_id:number|null;status:string;source:string;reviewed_at:string|null}>();
  if(!repair)throw new Error('Repair was not found.');
  if(!isRepairCompleted(repair.status))throw new Error('Repair type corrections are made here after the repair is completed.');
  if(repair.reviewed_at)throw new Error('This work order is already approved. Reopen it before changing the repair type.');
  if(!repairTypeRequired(repair.source))throw new Error(`${displayRepairType(repair.source,null)} is controlled by its dedicated workflow.`);
  const type=await requireRepairType(env.DB,body.repairTypeId);
  if(type.unitRule==='required'&&repair.equipment_id===null)throw new Error(`${type.name} must be attached to a unit.`);
  const run=await env.DB.prepare('SELECT repair_type_id FROM repair_type_checklist_runs WHERE repair_id=?').bind(id).first<{repair_type_id:number}>();
  if(run&&Number(run.repair_type_id)!==type.id)throw new Error('This repair already used a checklist from a different repair type.');
  await env.DB.batch([
    env.DB.prepare('UPDATE repairs SET repair_type_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(type.id,id),
    env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) SELECT id,?,technician_id,'repair_type_review_corrected',? FROM repairs WHERE id=?`).bind(user.id,`${user.displayName} set repair type to ${type.name} during work-order review.`.slice(0,500),id),
  ]);
  return {ok:true,repairId:`repair-${id}`,repairType:type.name,repairTypeId:type.id};
}

async function approveWorkOrder(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required to approve work orders.');
  const rawIds = Array.isArray(body.repairIds) ? body.repairIds : [];
  const ids = [...new Set(rawIds.map((value) => repairNumber(value)))];
  if (!ids.length) throw new Error('Choose a completed work order to approve.');
  if (ids.length > 100) throw new Error('Too many repairs were included in one work order review.');
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id,COALESCE(status,'') AS status,COALESCE(source,'manual') AS source,repair_type_id FROM repairs WHERE id IN (${placeholders})`).bind(...ids).all<{id:number;status:string;source:string;repair_type_id:number|null}>();
  if (rows.results.length !== ids.length || rows.results.some((row) => !isRepairCompleted(row.status))) throw new Error('Only completed repairs can be approved from Work Order Review.');
  if(rows.results.some(row=>repairTypeRequired(row.source)&&!row.repair_type_id))throw new Error('Choose a Repair Type for every completed repair before approving this work order.');

  const reviewNote = String(body.reviewNote ?? '').trim().slice(0,1000);
  const reviewer = user.displayName || user.username || `User ${user.id}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE repairs SET reviewed_at=CURRENT_TIMESTAMP,reviewed_by_user_id=?,review_note=? WHERE id IN (${placeholders})`).bind(user.id,reviewNote,...ids),
    ...ids.map((id)=>env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) SELECT r.id,?,r.technician_id,'work_order_reviewed',? FROM repairs r WHERE r.id=?`).bind(user.id,`${reviewer} approved the completed work order${reviewNote ? `: ${reviewNote}` : '.'}`.slice(0,500),id)),
  ]);
  return {ok:true,approved:true,repairIds:ids.map((id)=>`repair-${id}`),reviewedBy:reviewer};
}

type TypeMeta={id:number;repair_type_id:number|null;source:string;repair_type_name:string|null;checklist_type_id:number|null};

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    const data = await getWorkOrderData(env.DB);
    const filtered=data.repairs.filter((repair) => !isRepairDeferred(repair.status));
    const metaResult=await env.DB.prepare(`
      SELECT r.id,r.repair_type_id,COALESCE(r.source,'manual') AS source,rt.name AS repair_type_name,cr.repair_type_id AS checklist_type_id
      FROM repairs r LEFT JOIN repair_types rt ON rt.id=r.repair_type_id LEFT JOIN repair_type_checklist_runs cr ON cr.repair_id=r.id
    `).all<TypeMeta>();
    const meta=new Map(metaResult.results.map(row=>[Number(row.id),row]));
    const decorate=<T extends {numericId:number}>(repair:T)=>{
      const row=meta.get(Number(repair.numericId));
      const source=row?.source??'manual';
      return {...repair,repairTypeId:row?.repair_type_id??null,repairType:displayRepairType(source,row?.repair_type_name),repairTypeRequired:repairTypeRequired(source),repairTypeEditable:repairTypeRequired(source)&&!row?.checklist_type_id};
    };
    const repairs=filtered.map(decorate);
    const reviewPackages=data.reviewPackages.map(pkg=>({...pkg,unit:pkg.unit||'SHOP / NO UNIT',repairs:pkg.repairs.map(decorate)}));
    return Response.json({...data,repairs,reviewPackages,repairTypes:await listRepairTypes(env.DB,false),user:{id:user.id,displayName:user.displayName,role:user.role},canApprove:user.role === 'manager' || user.role === 'admin'}, {headers:{'cache-control':'no-store'}});
  } catch (error) {
    console.error(JSON.stringify({event:'work_orders_get_failed',error:String(error)}));
    return Response.json({error:error instanceof Error ? error.message : 'Work orders could not be loaded.'},{status:500});
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    await enforceTechnicianScope(request, body);
    const action = String(body.action ?? '');
    if(action==='reviewUpdateRepairType')return Response.json(await reviewUpdateRepairType(request,body));
    if (action === 'reviewAddPart') return Response.json(await addReviewPart(request, body));
    const correction = await handleReviewCorrection(request, body);
    if (correction) return Response.json(correction);
    if (action === 'approveWorkOrder') return Response.json(await approveWorkOrder(request, body));
    if (action === 'usePart') {
      const user = await getSessionUser(env.DB,request);
      if (!user) throw new Error('Authentication required.');
      return Response.json(await applyPartToRepair(env.DB,{operationKey:operationKey(request,body,'apply-part'),repairId:body.repairId,partId:body.partId,quantity:body.quantity,warehouseCode:body.warehouseCode,userId:user.id,source:'technician'}));
    }
    if (action === 'removePart') {
      const user = await getSessionUser(env.DB,request);
      if (!user || (user.role !== 'manager' && user.role !== 'admin')) throw new Error('Manager or administrator access is required to undo a posted part.');
      const usageId = Number(body.usageId ?? body.id ?? 0);
      const linked = usageId > 0 ? await env.DB.prepare('SELECT inventory_operation_id FROM repair_parts WHERE id = ?').bind(usageId).first<{inventory_operation_id:number|null}>() : null;
      if (linked?.inventory_operation_id) return Response.json(await undoInventoryOperation(env.DB,{operationId:linked.inventory_operation_id,operationKey:operationKey(request,body,'undo-part'),userId:user.id,note:String(body.reason ?? '')}));
      const result = await removePartFromRepair(env.DB,body);
      return Response.json({...result,legacy:true});
    }
    return Response.json(await handleWorkOrderAction(env.DB, body));
  } catch (error) {
    console.error(JSON.stringify({event:'work_orders_post_failed',error:String(error)}));
    return Response.json({error:error instanceof Error ? error.message : 'Work-order action failed'},{status:400});
  }
}
