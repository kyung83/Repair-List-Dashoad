import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type WarehouseRow = {
  id:number;
  code:string;
  name:string;
  active:number;
  assigned_users:number;
  stock_rows:number;
  stock_units:number;
  on_order_units:number;
  minimum_rows:number;
  open_repair_requests:number;
  repair_request_rows:number;
  lifecycle_rows:number;
  legacy_transfer_rows:number;
  open_legacy_transfers:number;
  operation_line_rows:number;
  discrepancy_rows:number;
  used_tire_rows:number;
  inventory_transfer_rows:number;
  receipt_rows:number;
};

function cleanCode(value:unknown) {
  return String(value??'').trim().toUpperCase().replace(/\s+/g,'_');
}

function cleanName(value:unknown) {
  return String(value??'').trim().replace(/\s+/g,' ').slice(0,80);
}

async function requireAdmin(request:Request) {
  const user=await getSessionUser(env.DB,request);
  if (!user) throw new Error('Authentication required.');
  if (user.role!=='admin') throw new Error('Administrator access is required.');
  return user;
}

async function loadWarehouses() {
  const rows=await env.DB.prepare(`
    SELECT w.id,w.code,w.name,w.active,
      (SELECT COUNT(*) FROM app_users u WHERE u.parts_warehouse_id=w.id) AS assigned_users,
      (SELECT COUNT(*) FROM part_warehouse_stock s WHERE s.warehouse_id=w.id) AS stock_rows,
      (SELECT COALESCE(SUM(ABS(s.quantity_on_hand)),0) FROM part_warehouse_stock s WHERE s.warehouse_id=w.id) AS stock_units,
      (SELECT COALESCE(SUM(ABS(s.on_order)),0) FROM part_warehouse_stock s WHERE s.warehouse_id=w.id) AS on_order_units,
      (SELECT COUNT(*) FROM part_warehouse_minimums m WHERE m.warehouse_id=w.id) AS minimum_rows,
      (SELECT COUNT(*) FROM repair_part_requests q WHERE q.warehouse_id=w.id AND q.status='open') AS open_repair_requests,
      (SELECT COUNT(*) FROM repair_part_requests q WHERE q.warehouse_id=w.id) AS repair_request_rows,
      (
        SELECT COUNT(*) FROM part_lifecycle_events e
        WHERE e.warehouse_id=w.id OR e.from_warehouse_id=w.id OR e.to_warehouse_id=w.id
      ) AS lifecycle_rows,
      (
        SELECT COUNT(*) FROM part_transfers t
        WHERE t.from_warehouse_id=w.id OR t.to_warehouse_id=w.id
      ) AS legacy_transfer_rows,
      (
        SELECT COUNT(*) FROM part_transfers t
        WHERE (t.from_warehouse_id=w.id OR t.to_warehouse_id=w.id)
          AND t.status IN ('requested','in_transit')
      ) AS open_legacy_transfers,
      (SELECT COUNT(*) FROM inventory_operation_lines l WHERE l.warehouse_id=w.id) AS operation_line_rows,
      (SELECT COUNT(*) FROM inventory_discrepancy_issues d WHERE d.warehouse_id=w.id) AS discrepancy_rows,
      (SELECT COUNT(*) FROM recovered_used_tires t WHERE t.warehouse_id=w.id) AS used_tire_rows,
      (
        SELECT COUNT(*) FROM inventory_transfers t
        WHERE t.source_warehouse_id=w.id OR t.destination_warehouse_id=w.id
      ) AS inventory_transfer_rows,
      (SELECT COUNT(*) FROM parts_receipts r WHERE r.warehouse_id=w.id) AS receipt_rows
    FROM warehouses w
    ORDER BY w.active DESC,w.name COLLATE NOCASE,w.code
  `).all<WarehouseRow>();
  return rows.results.map(row=>{
    const historicalReferences=
      Number(row.repair_request_rows??0)+
      Number(row.lifecycle_rows??0)+
      Number(row.legacy_transfer_rows??0)+
      Number(row.operation_line_rows??0)+
      Number(row.discrepancy_rows??0)+
      Number(row.used_tire_rows??0)+
      Number(row.inventory_transfer_rows??0)+
      Number(row.receipt_rows??0);
    const canArchive=
      Number(row.assigned_users??0)===0 &&
      Number(row.stock_units??0)<0.000001 &&
      Number(row.on_order_units??0)<0.000001 &&
      Number(row.open_repair_requests??0)===0 &&
      Number(row.open_legacy_transfers??0)===0;
    const canDelete=
      canArchive &&
      Number(row.stock_rows??0)===0 &&
      Number(row.minimum_rows??0)===0 &&
      historicalReferences===0;
    return {
      id:Number(row.id),
      code:row.code,
      name:row.name,
      active:Boolean(row.active),
      assignedUsers:Number(row.assigned_users??0),
      stockRows:Number(row.stock_rows??0),
      stockUnits:Number(row.stock_units??0),
      onOrderUnits:Number(row.on_order_units??0),
      openRepairRequests:Number(row.open_repair_requests??0),
      historicalReferences,
      canArchive,
      canDelete,
    };
  });
}

async function warehouseById(id:number) {
  return env.DB.prepare('SELECT id,code,name,active FROM warehouses WHERE id=?')
    .bind(id)
    .first<{id:number;code:string;name:string;active:number}>();
}

export async function GET(request:Request) {
  try {
    await requireAdmin(request);
    return Response.json({warehouses:await loadWarehouses()},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    const message=error instanceof Error?error.message:'Warehouses could not be loaded.';
    return Response.json({error:message},{status:message.includes('Authentication')?401:message.includes('Administrator')?403:400});
  }
}

export async function POST(request:Request) {
  try {
    await requireAdmin(request);
    const body=await request.json() as Record<string,unknown>;
    const action=String(body.action??'');

    if (action==='create') {
      const code=cleanCode(body.code);
      const name=cleanName(body.name);
      if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) throw new Error('Warehouse code must be 2–20 letters/numbers and may include - or _.');
      if (!name) throw new Error('Warehouse name is required.');
      const exists=await env.DB.prepare('SELECT id,active FROM warehouses WHERE code=?').bind(code).first<{id:number;active:number}>();
      if (exists) throw new Error(`${code} already exists. Restore or rename the existing warehouse instead.`);
      const result=await env.DB.prepare('INSERT INTO warehouses (code,name,active) VALUES (?,?,1)')
        .bind(code,name).run();
      return Response.json({ok:true,id:Number(result.meta.last_row_id),code,name});
    }

    const id=Number(body.id??0);
    if (!Number.isInteger(id)||id<=0) throw new Error('Warehouse was not found.');
    const warehouse=await warehouseById(id);
    if (!warehouse) throw new Error('Warehouse was not found.');

    if (action==='rename') {
      const name=cleanName(body.name);
      if (!name) throw new Error('Warehouse name is required.');
      await env.DB.prepare('UPDATE warehouses SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,id).run();
      return Response.json({ok:true,id,name});
    }

    if (action==='restore') {
      await env.DB.prepare('UPDATE warehouses SET active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
      return Response.json({ok:true,id,restored:true});
    }

    const current=(await loadWarehouses()).find(row=>row.id===id);
    if (!current) throw new Error('Warehouse was not found.');

    if (action==='archive') {
      if (!current.canArchive) {
        if (current.assignedUsers>0) throw new Error('Reassign all users from this warehouse before archiving it.');
        if (current.stockUnits>0.000001||current.onOrderUnits>0.000001) throw new Error('Move or count this warehouse inventory to zero before archiving it.');
        if (current.openRepairRequests>0) throw new Error('Close or move open repair part requests before archiving this warehouse.');
        throw new Error('Open warehouse activity must be completed before this warehouse can be archived.');
      }
      await env.DB.prepare('UPDATE warehouses SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
      return Response.json({ok:true,id,archived:true});
    }

    if (action==='delete') {
      if (!current.canDelete) {
        throw new Error('This warehouse has inventory setup or history, so it cannot be permanently deleted. Archive it instead.');
      }
      const result=await env.DB.prepare('DELETE FROM warehouses WHERE id=?').bind(id).run();
      if (Number(result.meta.changes??0)===0) throw new Error('Warehouse could not be deleted.');
      return Response.json({ok:true,id,deleted:true});
    }

    throw new Error('Unknown warehouse action.');
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Warehouse action failed.'},{status:400});
  }
}
