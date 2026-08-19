import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Repair was not found.');
  return id;
}

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) throw new Error('Part unit cost must be zero or greater.');
  return Math.round(number * 100) / 100;
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

  const partId = Number(body.partId ?? 0);
  const quantity = Number(body.quantity ?? 0);
  if (!Number.isInteger(partId) || partId <= 0) throw new Error('Choose a catalog part.');
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) throw new Error('Part quantity must be greater than zero.');
  const warehouseCode = String(body.warehouseCode ?? '').trim().toUpperCase();
  const part = await env.DB.prepare('SELECT id,part_number,unit_cost FROM parts WHERE id = ? AND active = 1')
    .bind(partId).first<{id:number;part_number:string;unit_cost:number|null}>();
  if (!part) throw new Error('Part was not found.');
  const stock = await env.DB.prepare(`
    SELECT s.id,s.quantity_on_hand,s.unit_cost,w.code AS warehouse_code
    FROM part_warehouse_stock s
    JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.part_id = ?
      AND (? = '' OR w.code = ?)
      AND s.quantity_on_hand >= ?
    ORDER BY s.quantity_on_hand DESC, CASE w.code WHEN 'CLARE' THEN 0 ELSE 1 END, s.id
    LIMIT 1
  `).bind(partId,warehouseCode,warehouseCode,quantity).first<{id:number;quantity_on_hand:number;unit_cost:number|null;warehouse_code:string}>();
  if (!stock) throw new Error(warehouseCode ? `Not enough stock available in ${warehouseCode}.` : 'Not enough stock available for this part.');

  const unitCost = body.unitCost === undefined || body.unitCost === null || String(body.unitCost).trim() === ''
    ? Number(stock.unit_cost ?? part.unit_cost ?? 0)
    : money(body.unitCost);

  // Re-check stock inside the D1 batch transaction. The insert is conditional, so a
  // stale preflight can never create a repair-part row without a matching stock debit.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO repair_parts (repair_id,part_id,quantity,unit_cost,warehouse_stock_id)
      SELECT ?,?,?,?,?
      WHERE EXISTS (
        SELECT 1 FROM part_warehouse_stock
        WHERE id = ? AND part_id = ? AND quantity_on_hand >= ?
      )
    `).bind(repairId,partId,quantity,unitCost,stock.id,stock.id,partId,quantity),
    env.DB.prepare(`
      UPDATE part_warehouse_stock
      SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND part_id = ? AND quantity_on_hand >= ?
    `).bind(quantity,stock.id,partId,quantity),
    env.DB.prepare(`
      UPDATE parts
      SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(partId,partId),
  ]);
  const usageId = Number(results[0]?.meta?.last_row_id ?? 0);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1 || !usageId || Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw new Error('Stock changed before the correction could be saved. Refresh and try again.');
  }

  const rows = await env.DB.prepare(`
    SELECT p.part_number,SUM(rp.quantity) AS quantity
    FROM repair_parts rp JOIN parts p ON p.id = rp.part_id
    WHERE rp.repair_id = ? GROUP BY p.id,p.part_number ORDER BY p.part_number
  `).bind(repairId).all<{part_number:string;quantity:number}>();
  const text = rows.results.map((row)=>`${row.part_number} x${Number(row.quantity)}`).join(', ');
  await env.DB.batch([
    env.DB.prepare('UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(text,repairId),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'work_order_corrected',?)
    `).bind(repairId,user.id,repair.technician_id,`${user.displayName} added forgotten part ${part.part_number} x${quantity} at $${unitCost.toFixed(2)} each during manager review.`.slice(0,500)),
  ]);
  return {ok:true,repairId:`repair-${repairId}`,usageId,partId,quantity,unitCost,warehouseCode:stock.warehouse_code};
}
