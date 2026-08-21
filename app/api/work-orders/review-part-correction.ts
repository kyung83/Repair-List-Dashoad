import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { applyPartToRepair } from '@/lib/inventory-operations';

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Repair was not found.');
  return id;
}

export async function addReviewPart(request: Request, body: Record<string,unknown>) {
  const user = await getSessionUser(env.DB,request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required to correct completed work orders.');

  const repairId = repairNumber(body.repairId);
  const repair = await env.DB.prepare(`
    SELECT id,COALESCE(status,'') AS status,reviewed_at,technician_id
    FROM repairs WHERE id = ?
  `).bind(repairId).first<{id:number;status:string;reviewed_at:string|null;technician_id:number|null}>();
  if (!repair) throw new Error('Repair was not found.');
  if (!repair.status.toLowerCase().includes('complete')) throw new Error('Only completed repairs can be corrected from Work Order Review.');
  if (repair.reviewed_at) throw new Error('This work order is already approved. Reopen the review before making corrections.');

  const operationKey = String(body.operationKey ?? request.headers.get('idempotency-key') ?? `review-part:${crypto.randomUUID()}`);
  const result = await applyPartToRepair(env.DB,{
    operationKey,
    repairId,
    partId:body.partId,
    quantity:body.quantity,
    warehouseCode:body.warehouseCode,
    unitCost:body.unitCost,
    userId:user.id,
    source:'work_order_review',
    note:`${user.displayName || user.username} added a part during manager review.`,
  });

  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'work_order_corrected',?)
  `).bind(
    repairId,user.id,repair.technician_id,
    `${user.displayName || user.username} applied part ${result.partId} x${result.quantity} during manager review (inventory operation ${result.operationId}).`.slice(0,500),
  ).run();
  return result;
}
