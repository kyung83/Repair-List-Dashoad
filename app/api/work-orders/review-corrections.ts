import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { addRepairLabor } from '@/lib/billing';
import { removePartFromRepair, usePartOnRepair } from '@/lib/inventory-db';

type EditableRepair = {
  id:number;
  title:string;
  status:string;
  technician_id:number|null;
  reviewed_at:string|null;
  outside_cost:number|null;
};

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Repair was not found.');
  return id;
}

function positiveEntryId(value: unknown, label: string) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} was not found.`);
  return id;
}

function nonNegativeMoney(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) throw new Error(`${label} must be zero or greater.`);
  return Math.round(number * 100) / 100;
}

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required to correct completed work orders.');
  return user;
}

async function editableRepair(idValue: unknown) {
  const id = repairNumber(idValue);
  const repair = await env.DB.prepare(`
    SELECT id,title,COALESCE(status,'') AS status,technician_id,reviewed_at,outside_cost
    FROM repairs WHERE id = ?
  `).bind(id).first<EditableRepair>();
  if (!repair) throw new Error('Repair was not found.');
  if (!repair.status.toLowerCase().includes('complete')) throw new Error('Only completed repairs can be corrected from Work Order Review.');
  if (repair.reviewed_at) throw new Error('This work order is already approved. Reopen the review before making corrections.');
  return repair;
}

async function audit(user: AppUser, repairId: number, detail: string, action = 'work_order_corrected') {
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    SELECT r.id, ?, r.technician_id, ?, ?
    FROM repairs r WHERE r.id = ?
  `).bind(user.id, action, detail.slice(0,500), repairId).run();
}

async function refreshLaborTotals(repairId: number) {
  const totals = await env.DB.prepare(`
    SELECT COALESCE(SUM(hours),0) AS hours,
           CASE WHEN SUM(hours) > 0 THEN SUM(hours * rate) / SUM(hours) ELSE NULL END AS blended_rate
    FROM repair_labor_entries WHERE repair_id = ?
  `).bind(repairId).first<{hours:number;blended_rate:number|null}>();
  const hours = Number(totals?.hours ?? 0);
  await env.DB.prepare(`
    UPDATE repairs
    SET labor_hours = ?,
        labor_rate = CASE WHEN ? IS NULL THEN labor_rate ELSE ? END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(hours, totals?.blended_rate ?? null, totals?.blended_rate ?? null, repairId).run();
}

async function refreshRepairPartsText(repairId: number) {
  const rows = await env.DB.prepare(`
    SELECT p.part_number, SUM(rp.quantity) AS quantity
    FROM repair_parts rp
    JOIN parts p ON p.id = rp.part_id
    WHERE rp.repair_id = ?
    GROUP BY p.id,p.part_number
    ORDER BY p.part_number
  `).bind(repairId).all<{part_number:string;quantity:number}>();
  const text = rows.results.map((row) => `${row.part_number} x${Number(row.quantity)}`).join(', ');
  await env.DB.prepare('UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(text,repairId).run();
}

async function refreshFlatPartTotal(partId: number) {
  await env.DB.prepare(`
    UPDATE parts
    SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(partId,partId).run();
}

async function addLabor(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const repair = await editableRepair(body.repairId);
  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Labor hours must be greater than zero and no more than 24 per entry.');
  const rate = nonNegativeMoney(body.rate, 'Labor rate');
  const technicianId = body.technicianId ?? repair.technician_id ?? undefined;
  const result = await addRepairLabor(env.DB,{...body,repairId:`repair-${repair.id}`,hours,rate,technicianId});
  await audit(user,repair.id,`${user.displayName} added a manager labor correction: ${hours} hr at $${rate.toFixed(2)}/hr.`);
  return result;
}

async function updateLabor(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const entryId = positiveEntryId(body.entryId,'Labor entry');
  const entry = await env.DB.prepare(`
    SELECT id,repair_id,hours,rate,COALESCE(notes,'') AS notes
    FROM repair_labor_entries WHERE id = ?
  `).bind(entryId).first<{id:number;repair_id:number;hours:number;rate:number;notes:string}>();
  if (!entry) throw new Error('Labor entry was not found.');
  await editableRepair(entry.repair_id);
  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Labor hours must be greater than zero and no more than 24 per entry.');
  const rate = nonNegativeMoney(body.rate,'Labor rate');
  const notes = String(body.notes ?? '').trim().slice(0,500);
  await env.DB.prepare(`
    UPDATE repair_labor_entries
    SET hours = ?, rate = ?, notes = ?
    WHERE id = ?
  `).bind(hours,rate,notes,entryId).run();
  await refreshLaborTotals(entry.repair_id);
  await audit(user,entry.repair_id,`${user.displayName} corrected labor entry ${entryId}: ${Number(entry.hours)} hr @ $${Number(entry.rate).toFixed(2)} to ${hours} hr @ $${rate.toFixed(2)}.`);
  return {ok:true,entryId,repairId:`repair-${entry.repair_id}`};
}

async function deleteLabor(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const entryId = positiveEntryId(body.entryId,'Labor entry');
  const entry = await env.DB.prepare(`SELECT id,repair_id,hours,rate FROM repair_labor_entries WHERE id = ?`)
    .bind(entryId).first<{id:number;repair_id:number;hours:number;rate:number}>();
  if (!entry) throw new Error('Labor entry was not found.');
  await editableRepair(entry.repair_id);
  await env.DB.prepare('DELETE FROM repair_labor_entries WHERE id = ?').bind(entryId).run();
  await refreshLaborTotals(entry.repair_id);
  await audit(user,entry.repair_id,`${user.displayName} removed labor entry ${entryId} (${Number(entry.hours)} hr @ $${Number(entry.rate).toFixed(2)}).`);
  return {ok:true,entryId,repairId:`repair-${entry.repair_id}`};
}

async function setOutsideCost(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const repair = await editableRepair(body.repairId);
  const amount = nonNegativeMoney(body.amount,'Outside/vendor cost');
  await env.DB.prepare('UPDATE repairs SET outside_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(amount,repair.id).run();
  await audit(user,repair.id,`${user.displayName} corrected outside/vendor cost from $${Number(repair.outside_cost ?? 0).toFixed(2)} to $${amount.toFixed(2)}.`);
  return {ok:true,repairId:`repair-${repair.id}`,outsideCost:amount};
}

async function updateRepairTitle(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const repair = await editableRepair(body.repairId);
  const title = String(body.title ?? '').trim().slice(0,500);
  if (!title) throw new Error('Repair description cannot be blank.');
  await env.DB.prepare('UPDATE repairs SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(title,repair.id).run();
  await audit(user,repair.id,`${user.displayName} corrected repair description from "${repair.title}" to "${title}".`);
  return {ok:true,repairId:`repair-${repair.id}`,title};
}

async function addPart(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const repair = await editableRepair(body.repairId);
  const partId = Number(body.partId ?? 0);
  const quantity = Number(body.quantity ?? 0);
  if (!Number.isInteger(partId) || partId <= 0) throw new Error('Choose a catalog part.');
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) throw new Error('Part quantity must be greater than zero.');
  const result = await usePartOnRepair(env.DB,{repairId:`repair-${repair.id}`,partId,quantity,warehouseCode:body.warehouseCode});
  const usageId = Number((result as {usageId?:number}).usageId ?? 0);
  if (!usageId) throw new Error('The part was applied but its usage row could not be identified. Refresh before making another correction.');
  if (body.unitCost !== undefined && body.unitCost !== null && String(body.unitCost).trim() !== '') {
    const unitCost = nonNegativeMoney(body.unitCost,'Part unit cost');
    await env.DB.prepare('UPDATE repair_parts SET unit_cost = ? WHERE id = ? AND repair_id = ?').bind(unitCost,usageId,repair.id).run();
  }
  await refreshRepairPartsText(repair.id);
  const part = await env.DB.prepare('SELECT part_number FROM parts WHERE id = ?').bind(partId).first<{part_number:string}>();
  await audit(user,repair.id,`${user.displayName} added forgotten part ${part?.part_number ?? partId} x${quantity} during manager review.`);
  return {ok:true,repairId:`repair-${repair.id}`,usageId};
}

async function updatePart(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const usageId = positiveEntryId(body.usageId,'Part line');
  const usage = await env.DB.prepare(`
    SELECT rp.id,rp.repair_id,rp.part_id,rp.quantity,rp.unit_cost,rp.warehouse_stock_id,p.part_number
    FROM repair_parts rp JOIN parts p ON p.id = rp.part_id
    WHERE rp.id = ?
  `).bind(usageId).first<{id:number;repair_id:number;part_id:number;quantity:number;unit_cost:number|null;warehouse_stock_id:number|null;part_number:string}>();
  if (!usage) throw new Error('Part line was not found.');
  await editableRepair(usage.repair_id);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) throw new Error('Part quantity must be greater than zero.');
  const unitCost = nonNegativeMoney(body.unitCost,'Part unit cost');
  const delta = quantity - Number(usage.quantity);
  if (delta !== 0) {
    if (usage.warehouse_stock_id == null) throw new Error('This legacy part line has no source warehouse. Its cost can be corrected, but quantity cannot be changed safely.');
    if (delta > 0) {
      const stock = await env.DB.prepare('SELECT quantity_on_hand FROM part_warehouse_stock WHERE id = ? AND part_id = ?')
        .bind(usage.warehouse_stock_id,usage.part_id).first<{quantity_on_hand:number}>();
      if (!stock || Number(stock.quantity_on_hand) < delta) throw new Error('Not enough stock remains in the original warehouse to increase this quantity.');
    }
    await env.DB.prepare(`
      UPDATE part_warehouse_stock
      SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND part_id = ?
    `).bind(delta,usage.warehouse_stock_id,usage.part_id).run();
  }
  await env.DB.prepare('UPDATE repair_parts SET quantity = ?, unit_cost = ? WHERE id = ?').bind(quantity,unitCost,usageId).run();
  await refreshFlatPartTotal(usage.part_id);
  await refreshRepairPartsText(usage.repair_id);
  await audit(user,usage.repair_id,`${user.displayName} corrected part ${usage.part_number}: qty ${Number(usage.quantity)} to ${quantity}, unit cost ${usage.unit_cost == null ? 'missing' : `$${Number(usage.unit_cost).toFixed(2)}`} to $${unitCost.toFixed(2)}.`);
  return {ok:true,usageId,repairId:`repair-${usage.repair_id}`};
}

async function removePart(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const usageId = positiveEntryId(body.usageId,'Part line');
  const usage = await env.DB.prepare(`
    SELECT rp.repair_id,p.part_number,rp.quantity
    FROM repair_parts rp JOIN parts p ON p.id = rp.part_id
    WHERE rp.id = ?
  `).bind(usageId).first<{repair_id:number;part_number:string;quantity:number}>();
  if (!usage) throw new Error('Part line was not found.');
  await editableRepair(usage.repair_id);
  const result = await removePartFromRepair(env.DB,{usageId,repairId:`repair-${usage.repair_id}`});
  await refreshRepairPartsText(usage.repair_id);
  await audit(user,usage.repair_id,`${user.displayName} removed part ${usage.part_number} x${Number(usage.quantity)} during manager review.`);
  return result;
}

async function reopenWorkOrder(request: Request, body: Record<string,unknown>) {
  const user = await requireManager(request);
  const rawIds = Array.isArray(body.repairIds) ? body.repairIds : [];
  const ids = [...new Set(rawIds.map(repairNumber))];
  if (!ids.length || ids.length > 100) throw new Error('Choose one reviewed work order to reopen.');
  const reason = String(body.reason ?? '').trim().slice(0,500);
  if (!reason) throw new Error('Enter why this approved work order needs to be reopened.');
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id,COALESCE(status,'') AS status,reviewed_at FROM repairs WHERE id IN (${placeholders})`)
    .bind(...ids).all<{id:number;status:string;reviewed_at:string|null}>();
  if (rows.results.length !== ids.length || rows.results.some((row) => !row.status.toLowerCase().includes('complete'))) throw new Error('Only completed work orders can be reopened for review.');
  if (rows.results.some((row) => !row.reviewed_at)) throw new Error('This work order is already waiting for review.');
  const reviewer = user.displayName || user.username || `User ${user.id}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE repairs SET reviewed_at = NULL, reviewed_by_user_id = NULL, review_note = NULL WHERE id IN (${placeholders})`).bind(...ids),
    ...ids.map((id) => env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      SELECT r.id, ?, r.technician_id, 'work_order_review_reopened', ? FROM repairs r WHERE r.id = ?
    `).bind(user.id,`${reviewer} reopened Work Order Review: ${reason}`.slice(0,500),id)),
  ]);
  return {ok:true,reopened:true,repairIds:ids.map((id)=>`repair-${id}`)};
}

export async function handleReviewCorrection(request: Request, body: Record<string,unknown>) {
  const action = String(body.action ?? '');
  if (action === 'reviewAddLabor') return addLabor(request,body);
  if (action === 'reviewUpdateLabor') return updateLabor(request,body);
  if (action === 'reviewDeleteLabor') return deleteLabor(request,body);
  if (action === 'reviewSetOutsideCost') return setOutsideCost(request,body);
  if (action === 'reviewUpdateRepairTitle') return updateRepairTitle(request,body);
  if (action === 'reviewAddPart') return addPart(request,body);
  if (action === 'reviewUpdatePart') return updatePart(request,body);
  if (action === 'reviewRemovePart') return removePart(request,body);
  if (action === 'reopenWorkOrderReview') return reopenWorkOrder(request,body);
  return null;
}
