import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { resolvePhysicalCountIssue } from '@/lib/inventory-operations';

function positiveId(value: unknown, label: string) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is required.`);
  return id;
}

function positiveNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function operationKey(request: Request, body: Record<string,unknown>, prefix: string) {
  return String(body.operationKey ?? request.headers.get('idempotency-key') ?? `${prefix}:${crypto.randomUUID()}`).trim().slice(0,160);
}

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB,request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required.');
  return user;
}

async function warehouseId(code: unknown) {
  const value = String(code ?? '').trim().toUpperCase();
  const row = await env.DB.prepare('SELECT id,code,name FROM warehouses WHERE code=? AND active=1').bind(value).first<{id:number;code:string;name:string}>();
  if (!row) throw new Error('Choose an active warehouse.');
  return row;
}

async function existingOperation(key: string) {
  return env.DB.prepare('SELECT id,operation_type,status FROM inventory_operations WHERE operation_key=?').bind(key).first<{id:number;operation_type:string;status:string}>();
}

export async function GET(request: Request) {
  try {
    await requireManager(request);
    const [issues,cores,tires,parts,warehouses] = await Promise.all([
      env.DB.prepare(`
        SELECT i.id,i.part_id,i.warehouse_id,i.expected_quantity,i.counted_quantity,i.difference_quantity,i.reason,i.stock_version,i.created_at,
               p.part_number,p.description,w.code AS warehouse_code,w.name AS warehouse_name
        FROM inventory_discrepancy_issues i
        JOIN parts p ON p.id=i.part_id JOIN warehouses w ON w.id=i.warehouse_id
        WHERE i.status='open' ORDER BY i.created_at,i.id
      `).all<any>(),
      env.DB.prepare(`
        SELECT c.id,c.source_operation_id,c.repair_id,c.issued_part_id,c.core_part_id,c.quantity,c.status,c.opened_at,
               issued.part_number AS issued_part_number,issued.description AS issued_description,
               core.part_number AS core_part_number,core.description AS core_description,
               COALESCE(e.unit,'') AS unit
        FROM part_core_obligations c
        JOIN parts issued ON issued.id=c.issued_part_id
        LEFT JOIN parts core ON core.id=c.core_part_id
        LEFT JOIN repairs r ON r.id=c.repair_id LEFT JOIN equipment e ON e.id=r.equipment_id
        WHERE c.status='open' ORDER BY c.opened_at,c.id
      `).all<any>(),
      env.DB.prepare(`
        SELECT t.id,t.source_operation_id,t.repair_id,t.part_id,t.warehouse_id,t.position_code,t.condition_note,t.status,t.recovered_at,
               t.disposition_at,t.disposition_repair_id,p.part_number,p.description,w.code AS warehouse_code,w.name AS warehouse_name,
               COALESCE(e.unit,'') AS source_unit
        FROM recovered_used_tires t
        LEFT JOIN parts p ON p.id=t.part_id JOIN warehouses w ON w.id=t.warehouse_id
        LEFT JOIN repairs r ON r.id=t.repair_id LEFT JOIN equipment e ON e.id=r.equipment_id
        WHERE t.status='available' ORDER BY t.recovered_at,t.id
      `).all<any>(),
      env.DB.prepare(`
        SELECT id,part_number,description,core_return_part_id,core_return_quantity
        FROM parts WHERE active=1 ORDER BY description,part_number
      `).all<any>(),
      env.DB.prepare('SELECT id,code,name FROM warehouses WHERE active=1 ORDER BY name').all<any>(),
    ]);
    return Response.json({ok:true,issues:issues.results,coreObligations:cores.results,recoveredTires:tires.results,parts:parts.results,warehouses:warehouses.results},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Inventory controls could not be loaded.'},{status:403,headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireManager(request);
    const body = await request.json() as Record<string,unknown>;
    const action = String(body.action ?? '');

    if (action === 'resolvePhysicalCount') {
      return Response.json(await resolvePhysicalCountIssue(env.DB,{
        issueId:body.issueId,
        operationKey:operationKey(request,body,'count-resolution'),
        userId:user.id,
        note:body.note,
      }));
    }

    if (action === 'configureCore') {
      const partId = positiveId(body.partId,'Part');
      const corePartId = body.corePartId == null || body.corePartId === '' ? null : positiveId(body.corePartId,'Core part');
      const quantity = corePartId == null ? 0 : positiveNumber(body.coreReturnQuantity,'Core quantity');
      if (corePartId === partId) throw new Error('The issued part and returned-core part must be different catalog items.');
      await env.DB.prepare('UPDATE parts SET core_return_part_id=?,core_return_quantity=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND active=1')
        .bind(corePartId,quantity,partId).run();
      return Response.json({ok:true,partId,corePartId,coreReturnQuantity:quantity});
    }

    if (action === 'closeCore') {
      const obligationId = positiveId(body.obligationId,'Core obligation');
      const disposition = String(body.disposition ?? '').toLowerCase();
      if (disposition !== 'returned' && disposition !== 'waived') throw new Error('Core disposition must be returned or waived.');
      const key = operationKey(request,body,`core-${disposition}`);
      const prior = await existingOperation(key);
      if (prior) return Response.json({ok:true,idempotent:true,operationId:prior.id,obligationId,disposition});
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,user_id,note) VALUES (?,?,?,?)`)
          .bind(key,`core_${disposition}`,user.id,String(body.note ?? '').trim().slice(0,500)),
        env.DB.prepare(`
          UPDATE part_core_obligations
          SET status=?,closed_at=CURRENT_TIMESTAMP,closed_by_user_id=?
          WHERE id=? AND status='open'
        `).bind(disposition,user.id,obligationId),
        env.DB.prepare(`
          INSERT INTO inventory_operation_commits (operation_id,applied)
          SELECT id,CASE WHEN (SELECT status FROM part_core_obligations WHERE id=?)=? THEN 1 ELSE 0 END
          FROM inventory_operations WHERE operation_key=?
        `).bind(obligationId,disposition,key),
      ]);
      const operation = await existingOperation(key);
      return Response.json({ok:true,idempotent:false,operationId:operation?.id,obligationId,disposition});
    }

    if (action === 'recoverUsedTire') {
      const repairId = positiveId(body.repairId,'Source repair');
      const warehouse = await warehouseId(body.warehouseCode);
      const positionCode = String(body.positionCode ?? '').trim().toUpperCase().slice(0,40);
      if (!positionCode) throw new Error('Tire position is required.');
      const partId = body.partId == null || body.partId === '' ? null : positiveId(body.partId,'Tire catalog part');
      const repair = await env.DB.prepare('SELECT id FROM repairs WHERE id=?').bind(repairId).first<{id:number}>();
      if (!repair) throw new Error('Source repair was not found.');
      const key = operationKey(request,body,'recover-used-tire');
      const prior = await existingOperation(key);
      if (prior) return Response.json({ok:true,idempotent:true,operationId:prior.id});
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note) VALUES (?,'recover_used_tire',?,?,?)`)
          .bind(key,repairId,user.id,String(body.conditionNote ?? '').trim().slice(0,500)),
        env.DB.prepare(`
          INSERT INTO recovered_used_tires (source_operation_id,repair_id,part_id,warehouse_id,position_code,condition_note,status)
          SELECT id,?,?,?,?,?,'available' FROM inventory_operations WHERE operation_key=?
        `).bind(repairId,partId,warehouse.id,positionCode,String(body.conditionNote ?? '').trim().slice(0,500),key),
        env.DB.prepare(`
          INSERT INTO inventory_operation_commits (operation_id,applied)
          SELECT id,CASE WHEN EXISTS(SELECT 1 FROM recovered_used_tires t WHERE t.source_operation_id=id) THEN 1 ELSE 0 END
          FROM inventory_operations WHERE operation_key=?
        `).bind(key),
      ]);
      const operation = await existingOperation(key);
      return Response.json({ok:true,idempotent:false,operationId:operation?.id});
    }

    if (action === 'disposeUsedTire') {
      const tireId = positiveId(body.tireId,'Recovered tire');
      const disposition = String(body.disposition ?? '').toLowerCase();
      if (disposition !== 'reused' && disposition !== 'scrapped') throw new Error('Tire disposition must be reused or scrapped.');
      const destinationRepairId = disposition === 'reused' ? positiveId(body.destinationRepairId,'Destination repair') : null;
      if (destinationRepairId) {
        const repair = await env.DB.prepare('SELECT id FROM repairs WHERE id=?').bind(destinationRepairId).first<{id:number}>();
        if (!repair) throw new Error('Destination repair was not found.');
      }
      const key = operationKey(request,body,`used-tire-${disposition}`);
      const prior = await existingOperation(key);
      if (prior) return Response.json({ok:true,idempotent:true,operationId:prior.id,tireId,disposition});
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note) VALUES (?,?,?,?,?)`)
          .bind(key,`used_tire_${disposition}`,destinationRepairId,user.id,String(body.note ?? '').trim().slice(0,500)),
        env.DB.prepare(`
          UPDATE recovered_used_tires
          SET status=?,disposition_at=CURRENT_TIMESTAMP,disposition_operation_id=(SELECT id FROM inventory_operations WHERE operation_key=?),disposition_repair_id=?
          WHERE id=? AND status='available'
        `).bind(disposition,key,destinationRepairId,tireId),
        env.DB.prepare(`
          INSERT INTO inventory_operation_commits (operation_id,applied)
          SELECT id,CASE WHEN (SELECT status FROM recovered_used_tires WHERE id=?)=? THEN 1 ELSE 0 END
          FROM inventory_operations WHERE operation_key=?
        `).bind(tireId,disposition,key),
      ]);
      const operation = await existingOperation(key);
      return Response.json({ok:true,idempotent:false,operationId:operation?.id,tireId,disposition,destinationRepairId});
    }

    return Response.json({error:'Unknown inventory-control action.'},{status:400});
  } catch (error) {
    console.error(JSON.stringify({event:'inventory_controls_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Inventory control action failed.'},{status:400});
  }
}
