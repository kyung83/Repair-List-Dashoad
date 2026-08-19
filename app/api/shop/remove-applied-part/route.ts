import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { allocateWaitingForPart } from '@/lib/parts-lifecycle';

const EPSILON = 0.000001;

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
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
      SELECT id, technician_id, COALESCE(status, '') AS status
      FROM repairs
      WHERE id = ?
    `).bind(repairId).first<{ id:number; technician_id:number|null; status:string }>();
    if (!repair) throw new Error('Repair was not found.');
    if (repair.status.toLowerCase().includes('complete')) {
      throw new Error('Completed repair parts must be corrected from Work Order Review.');
    }
    if (user.role === 'mechanic') {
      if (!user.technicianId || Number(repair.technician_id ?? 0) !== Number(user.technicianId)) {
        throw new Error('This repair is not assigned to you.');
      }
    }

    const part = await env.DB.prepare(`
      SELECT id, part_number, description
      FROM parts
      WHERE id = ? AND active = 1
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

    const unsafe = applied.results.find((row) => !row.warehouse_stock_id || !row.warehouse_id);
    if (unsafe) {
      throw new Error('This older part entry does not have a warehouse stock link, so the technician screen cannot safely return it to inventory. Ask a manager to correct it from Work Order Review.');
    }

    const totalQuantity = applied.results.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
    if (totalQuantity <= EPSILON) throw new Error('The applied quantity is already zero.');

    const stockReturns = new Map<number, { quantity:number; warehouseId:number; warehouseCode:string }>();
    for (const row of applied.results) {
      const stockId = Number(row.warehouse_stock_id);
      const warehouseId = Number(row.warehouse_id);
      const current = stockReturns.get(stockId) ?? { quantity:0, warehouseId, warehouseCode:row.warehouse_code };
      current.quantity += Number(row.quantity ?? 0);
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
          `${value.quantity} x ${part.part_number} returned to ${value.warehouseCode || 'warehouse'} after technician removed a mistaken applied part.`.slice(0, 500),
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
    return Response.json({ error:error instanceof Error ? error.message : 'Applied part could not be removed.' }, { status:400 });
  }
}
