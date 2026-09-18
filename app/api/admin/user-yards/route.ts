import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { isYardKey, normalizeYard } from '@/lib/yards';

function yardValue(value: unknown) {
  return normalizeYard(value);
}

export async function GET(request: Request) {
  const current = await getSessionUser(env.DB, request);
  if (!current) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  if (current.role !== 'admin') return Response.json({ error: 'Administrator access is required.' }, { status: 403 });
  const [rows,warehouses] = await Promise.all([
    env.DB.prepare("SELECT id,username,display_name,role,active,COALESCE(yard,'') AS yard,parts_warehouse_id FROM app_users WHERE role IN ('mechanic','manager') AND COALESCE(dispatch_access,0)=0 ORDER BY active DESC,role,display_name COLLATE NOCASE")
      .all<{id:number;username:string|null;display_name:string;role:string;active:number;yard:string;parts_warehouse_id:number|null}>(),
    env.DB.prepare('SELECT id,code,name FROM warehouses WHERE active=1 ORDER BY name COLLATE NOCASE')
      .all<{id:number;code:string;name:string}>(),
  ]);
  return Response.json({
    users: rows.results.map(row => ({
      id:Number(row.id),
      username:row.username ?? '',
      displayName:row.display_name,
      role:row.role,
      active:Boolean(row.active),
      yard:yardValue(row.yard),
      partsWarehouseId:row.parts_warehouse_id==null?null:Number(row.parts_warehouse_id),
    })),
    warehouses:warehouses.results.map(row=>({id:Number(row.id),code:row.code,name:row.name})),
  }, { headers:{'cache-control':'no-store'} });
}

export async function POST(request: Request) {
  try {
    const current = await getSessionUser(env.DB, request);
    if (!current) return Response.json({ error: 'Not signed in.' }, { status: 401 });
    if (current.role !== 'admin') return Response.json({ error: 'Administrator access is required.' }, { status: 403 });
    const body = await request.json() as Record<string,unknown>;
    const id = Number(body.id);
    const raw = String(body.yard ?? '').trim().toLowerCase();
    if (!Number.isInteger(id) || id <= 0) throw new Error('User could not be resolved.');
    if (raw && !isYardKey(raw)) throw new Error('Yard must be Clare, Cadillac, GR, Taylor, or Boyne.');
    const user = await env.DB.prepare('SELECT role,COALESCE(dispatch_access,0) AS dispatch_access FROM app_users WHERE id=?').bind(id).first<{role:string;dispatch_access:number}>();
    if (!user) throw new Error('User not found.');
    if (user.dispatch_access) throw new Error('Dispatch users do not use shop yard assignments.');
    if (user.role !== 'mechanic' && user.role !== 'manager') throw new Error('Yards are assigned to technicians and managers.');
    const yard = yardValue(raw);
    const warehouseValue=body.partsWarehouseId;
    let partsWarehouseId:number|null=null;
    if (warehouseValue!==undefined && warehouseValue!==null && String(warehouseValue).trim()!=='') {
      const requested=Number(warehouseValue);
      if (!Number.isInteger(requested)||requested<=0) throw new Error('Choose a valid parts warehouse.');
      const warehouse=await env.DB.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').bind(requested).first<{id:number}>();
      if (!warehouse) throw new Error('Choose an active parts warehouse.');
      partsWarehouseId=Number(warehouse.id);
    } else if (warehouseValue===undefined) {
      const existing=await env.DB.prepare('SELECT parts_warehouse_id FROM app_users WHERE id=?').bind(id).first<{parts_warehouse_id:number|null}>();
      partsWarehouseId=existing?.parts_warehouse_id==null?null:Number(existing.parts_warehouse_id);
    }
    await env.DB.prepare('UPDATE app_users SET yard=?,parts_warehouse_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(yard,partsWarehouseId,id).run();
    return Response.json({ok:true,id,yard,partsWarehouseId});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Yard assignment could not be saved.'},{status:400});
  }
}
