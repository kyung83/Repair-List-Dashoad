import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { removePartFromRepair } from '@/lib/inventory-db';
import { applyPartToRepair, undoInventoryOperation } from '@/lib/inventory-operations';
import { getWorkOrderData, handleWorkOrderAction } from '@/lib/work-orders';
import { handleReviewCorrection } from './review-corrections';
import { addReviewPart } from './review-part-correction';

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^repair-(\d+)$/);
  if (!match) throw new Error('Repair row not found');
  return Number(match[1]);
}

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
}

function operationKey(request: Request, body: Record<string,unknown>, prefix: string) {
  return String(body.operationKey ?? request.headers.get('idempotency-key') ?? `${prefix}:${crypto.randomUUID()}`);
}

async function enforceTechnicianScope(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  const rawRepairId = body.id ?? body.repairId;
  const match = String(rawRepairId ?? '').match(/^repair-(\d+)$/);
  if (match) {
    const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(Number(match[1])).first<{status:string}>();
    if (row && deferred(row.status)) throw new Error('This repair is saved for a future PM/Annual and is not active work yet.');
  }
  if (user.role !== 'mechanic') return;
  if (!user.technicianId) throw new Error('This technician login is not linked to a technician record.');

  const action = String(body.action ?? '');
  if (!['usePart', 'completeRepair', 'addLabor'].includes(action)) {
    throw new Error('Technicians can only change their assigned repairs from the shop workspace.');
  }
  const repairId = repairNumber(action === 'completeRepair' ? (body.id ?? body.repairId) : body.repairId);
  const repair = await env.DB.prepare('SELECT technician_id, status FROM repairs WHERE id = ?')
    .bind(repairId)
    .first<{ technician_id: number | null; status: string }>();
  if (!repair) throw new Error('Repair was not found.');
  if (Number(repair.technician_id ?? 0) !== user.technicianId) throw new Error('This repair is not assigned to you.');
  if (String(repair.status ?? '').toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
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
  const rows = await env.DB.prepare(`SELECT id,COALESCE(status,'') AS status FROM repairs WHERE id IN (${placeholders})`).bind(...ids).all<{id:number;status:string}>();
  if (rows.results.length !== ids.length || rows.results.some((row) => !row.status.toLowerCase().includes('complete'))) {
    throw new Error('Only completed repairs can be approved from Work Order Review.');
  }

  const reviewNote = String(body.reviewNote ?? '').trim().slice(0,1000);
  const reviewer = user.displayName || user.username || `User ${user.id}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE repairs SET reviewed_at=CURRENT_TIMESTAMP,reviewed_by_user_id=?,review_note=? WHERE id IN (${placeholders})`).bind(user.id,reviewNote,...ids),
    ...ids.map((id)=>env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) SELECT r.id,?,r.technician_id,'work_order_reviewed',? FROM repairs r WHERE r.id=?`).bind(user.id,`${reviewer} approved the completed work order${reviewNote ? `: ${reviewNote}` : '.'}`.slice(0,500),id)),
  ]);
  return {ok:true,approved:true,repairIds:ids.map((id)=>`repair-${id}`),reviewedBy:reviewer};
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    const data = await getWorkOrderData(env.DB);
    data.repairs = data.repairs.filter((repair) => !deferred(repair.status));
    return Response.json({...data,user:{id:user.id,displayName:user.displayName,role:user.role},canApprove:user.role === 'manager' || user.role === 'admin'}, {headers:{'cache-control':'no-store'}});
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
    if (action === 'reviewAddPart') return Response.json(await addReviewPart(request, body));
    const correction = await handleReviewCorrection(request, body);
    if (correction) return Response.json(correction);
    if (action === 'approveWorkOrder') return Response.json(await approveWorkOrder(request, body));
    if (action === 'usePart') {
      const user = await getSessionUser(env.DB,request);
      if (!user) throw new Error('Authentication required.');
      return Response.json(await applyPartToRepair(env.DB,{
        operationKey:operationKey(request,body,'apply-part'),
        repairId:body.repairId,
        partId:body.partId,
        quantity:body.quantity,
        warehouseCode:body.warehouseCode,
        userId:user.id,
        source:'technician',
      }));
    }
    if (action === 'removePart') {
      const user = await getSessionUser(env.DB,request);
      if (!user || (user.role !== 'manager' && user.role !== 'admin')) throw new Error('Manager or administrator access is required to undo a posted part.');
      const usageId = Number(body.usageId ?? body.id ?? 0);
      const linked = usageId > 0 ? await env.DB.prepare('SELECT inventory_operation_id FROM repair_parts WHERE id = ?').bind(usageId).first<{inventory_operation_id:number|null}>() : null;
      if (linked?.inventory_operation_id) {
        return Response.json(await undoInventoryOperation(env.DB,{operationId:linked.inventory_operation_id,operationKey:operationKey(request,body,'undo-part'),userId:user.id,note:String(body.reason ?? '')}));
      }
      const result = await removePartFromRepair(env.DB,body);
      return Response.json({...result,legacy:true});
    }
    return Response.json(await handleWorkOrderAction(env.DB, body));
  } catch (error) {
    console.error(JSON.stringify({event:'work_orders_post_failed',error:String(error)}));
    return Response.json({error:error instanceof Error ? error.message : 'Work-order action failed'},{status:400});
  }
}
