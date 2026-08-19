import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { allocateWaitingForPart, normalizeWarehouseCode } from '@/lib/parts-lifecycle';

const EPSILON = 0.000001;

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function fallbackStockForRepair(partId:number, currentYard:string, repairLocation:string) {
  const warehouseCode = normalizeWarehouseCode(currentYard) || normalizeWarehouseCode(repairLocation);
  if (!warehouseCode) return null;
  const warehouse = await env.DB.prepare(`
    SELECT id, code FROM warehouses WHERE code = ? AND active = 1
  `).bind(warehouseCode).first<{ id:number; code:string }>();
  if (!warehouse) return null;

  let stock = await env.DB.prepare(`
    SELECT id, warehouse_id
    FROM part_warehouse_stock
    WHERE part_id = ? AND warehouse_id = ?
    ORDER BY CASE variant_key WHEN '' THEN 0 WHEN 'repair-lifecycle' THEN 1 WHEN 'repair-correction' THEN 2 ELSE 3 END,
             quantity_on_hand DESC, id
    LIMIT 1
  `).bind(partId, warehouse.id).first<{ id:number; warehouse_id:number }>();

  if (!stock) {
    await env.DB.prepare(`
      INSERT INTO part_warehouse_stock
        (part_id, warehouse_id, variant_key, quantity_on_hand, on_order, source_updated_at)
      VALUES (?, ?, 'repair-correction', 0, 0, NULL)
      ON CONFLICT(part_id, warehouse_id, variant_key) DO NOTHING
    `).bind(partId, warehouse.id).run();
    stock = await env.DB.prepare(`
      SELECT id, warehouse_id
      FROM part_warehouse_stock
      WHERE part_id = ? AND warehouse_id = ? AND variant_key = 'repair-correction'
      LIMIT 1
    `).bind(partId, warehouse.id).first<{ id:number; warehouse_id:number }>();
  }

  return stock ? { stockId:Number(stock.id), warehouseId:Number(stock.warehouse_id), warehouseCode:warehouse.code } : null;
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    if (!['mechanic', 'manager', 'admin'].includes(user.role)) {
      throw new Error('This account cannot change repair parts.');
    }

    const body = await request.json() as Record<string, unknown>;
    const repairId = numericRepairId(body.repairId);
    const partId = Number(body.partId ?? 0);
    if (!repairId || !Number.isInteger(partId) || partId <= 0) {
      throw new Error('Repair and part are required.');
    }

    const repair = await env.DB.prepare(`
      SELECT r.id, r.technician_id, COALESCE(r.status, '') AS status,
             COALESCE(r.location, '') AS repair_location,
             COALESCE(e.current_yard, '') AS current_yard
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      WHERE r.id = ?
    `).bind(repairId).first<{
      id:number;
      technician_id:number|null;
      status:string;
      repair_location:string;
      current_yard:string;
    }>();
    if (!repair) throw new Error('Repair was not found.');
    if (repair.status.toLowerCase().includes('complete')) {
      throw new Error('Completed repair parts must be corrected from Work Order Review.');
    }

    if (user.role === 'mechanic') {
      if (!user.technicianId) throw new Error('Your technician login is not linked to a technician record.');
      const assigned = Number(repair.technician_id ?? 0) === Number(user.technicianId);
      const active = assigned ? null : await env.DB.prepare(`
        SELECT repair_id FROM repair_labor_timers WHERE user_id = ? AND repair_id = ?
      `).bind(user.id, repairId).first<{ repair_id:number }>();
      if (!assigned && !active) {
        throw new Error('You can remove parts only from a repair assigned to you.');
      }
    }

    const part = await env.DB.prepare(`
      SELECT id, part_number, description
      FROM parts
      WHERE id = ?
    `).bind(partId).first<{ id:number; part_number:string; description:string }>();
    if (!part) throw new Error('Part was not found.');

    const applied = await env.DB.prepare(`
      SELECT rp.id, rp.quantity, rp.warehouse_stock_id,
             s.warehouse_id, COALESCE(w.code, '') AS warehouse_code
      FROM repair_parts rp
      LEFT JOIN part_warehouse_stock s ON s.id = rp.warehouse_stock_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      WHERE rp.repair_id = ? AND rp.part_id = ?
      ORDER BY rp.id
    `).bind(repairId, partId).all<{
      id:number;
      quantity:number;
      warehouse_stock_id:number|null;
      warehouse_id:number|null;
      warehouse_code:string;
    }>();
    if (!applied.results.length) throw new Error('That part is not currently applied to this repair.');

    const totalQuantity = applied.results.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    if (totalQuantity <= EPSILON) throw new Error('The applied quantity is already zero.');

    const legacyRows = applied.results.filter((row) => !row.warehouse_stock_id || !row.warehouse_id);
    const legacyFallback = legacyRows.length
      ? await fallbackStockForRepair(partId, repair.current_yard, repair.repair_location)
      : null;
    if (legacyRows.length && !legacyFallback) {
      throw new Error('This older part entry has no warehouse source and this repair has no recognized yard. Ask a manager to set the correct yard before removing it.');
    }

    const stockReturns = new Map<number, { quantity:number; warehouseId:number; warehouseCode:string; legacy:boolean }>();
    for (const row of applied.results) {
      const legacy = !row.warehouse_stock_id || !row.warehouse_id;
      const stockId = legacy ? Number(legacyFallback?.stockId ?? 0) : Number(row.warehouse_stock_id);
      const warehouseId = legacy ? Number(legacyFallback?.warehouseId ?? 0) : Number(row.warehouse_id);
      const warehouseCode = legacy ? String(legacyFallback?.warehouseCode ?? '') : row.warehouse_code;
      if (!stockId || !warehouseId) throw new Error('The warehouse stock record could not be resolved for this part.');
      const current = stockReturns.get(stockId) ?? { quantity:0, warehouseId, warehouseCode, legacy };
      current.quantity += Number(row.quantity ?? 0);
      current.legacy = current.legacy || legacy;
      stockReturns.set(stockId, current);
    }

    const requests = await env.DB.prepare(`
      SELECT id, warehouse_id, requested_quantity, reserved_quantity, used_quantity, status
      FROM repair_part_requests
      WHERE repair_id = ? AND part_id = ?
    `).bind(repairId, partId).all<{
      id:number;
      warehouse_id:number;
      requested_quantity:number;
      reserved_quantity:number;
      used_quantity:number;
      status:string;
    }>();

    const planned = await env.DB.prepare(`
      SELECT id, used_quantity
      FROM repair_planned_parts
      WHERE repair_id = ? AND part_id = ? AND removed_at IS NULL
      ORDER BY id DESC
    `).bind(repairId, partId).all<{ id:number; used_quantity:number }>();

    const statements:D1PreparedStatement[] = [];
    for (const [stockId, value] of stockReturns) {
      statements.push(
        env.DB.prepare(`
          UPDATE part_warehouse_stock
          SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND part_id = ?
        `).bind(value.quantity, stockId, partId),
        env.DB.prepare(`
          INSERT INTO part_lifecycle_events
            (part_id, repair_id, warehouse_id, user_id, event_type, quantity, detail)
          VALUES (?, ?, ?, ?, 'use_reversed', ?, ?)
        `).bind(
          partId,
          repairId,
          value.warehouseId,
          user.id,
          value.quantity,
          `${value.quantity} x ${part.part_number} returned to ${value.warehouseCode || 'warehouse'} after a mistaken applied part was removed${value.legacy ? ' (older entry assigned back to the repair yard)' : ''}.`.slice(0, 500),
        ),
      );
    }

    for (const row of applied.results) {
      statements.push(env.DB.prepare('DELETE FROM repair_parts WHERE id = ? AND repair_id = ?').bind(row.id, repairId));
    }

    for (const row of requests.results) {
      statements.push(env.DB.prepare(`
        UPDATE repair_part_requests
        SET requested_quantity = 0,
            reserved_quantity = 0,
            used_quantity = 0,
            status = 'closed',
            closed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(row.id));
    }

    let plannedToReverse = totalQuantity;
    for (const row of planned.results) {
      if (plannedToReverse <= EPSILON) break;
      const used = Math.max(0, Number(row.used_quantity ?? 0));
      const reverse = Math.min(used, plannedToReverse);
      if (reverse <= EPSILON) continue;
      statements.push(env.DB.prepare(`
        UPDATE repair_planned_parts
        SET used_quantity = MAX(0, used_quantity - ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(reverse, row.id));
      plannedToReverse -= reverse;
    }

    statements.push(
      env.DB.prepare(`
        UPDATE parts
        SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(partId, partId),
      env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'part_use_reversed', ?)
      `).bind(
        repairId,
        user.id,
        user.technicianId ?? repair.technician_id,
        `${user.displayName} removed ${totalQuantity} x ${part.part_number} from the repair and returned it to inventory.`.slice(0, 500),
      ),
    );

    await env.DB.batch(statements);

    const remaining = await env.DB.prepare(`
      SELECT p.part_number, SUM(rp.quantity) AS quantity
      FROM repair_parts rp
      JOIN parts p ON p.id = rp.part_id
      WHERE rp.repair_id = ?
      GROUP BY p.id, p.part_number
      ORDER BY p.part_number
    `).bind(repairId).all<{ part_number:string; quantity:number }>();
    const partsText = remaining.results.map((row) => `${row.part_number} x${Number(row.quantity)}`).join(', ');
    await env.DB.prepare('UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(partsText, repairId).run();

    const warehouses = new Set<number>();
    for (const value of stockReturns.values()) warehouses.add(value.warehouseId);
    for (const row of requests.results) warehouses.add(Number(row.warehouse_id));
    for (const warehouseId of warehouses) {
      if (warehouseId > 0) await allocateWaitingForPart(env.DB, partId, warehouseId, user.id);
    }

    return Response.json({
      ok:true,
      repairId:`repair-${repairId}`,
      partId,
      partNumber:part.part_number,
      quantity:totalQuantity,
    }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : 'Applied part could not be removed.' }, { status:400, headers:{ 'cache-control':'no-store' } });
  }
}
