import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

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

async function activePart(id: number) {
  return env.DB.prepare('SELECT id,part_number,description FROM parts WHERE id=? AND active=1').bind(id).first<{id:number;part_number:string;description:string}>();
}

async function existingOperation(key: string) {
  return env.DB.prepare('SELECT id,operation_type,status FROM inventory_operations WHERE operation_key=?').bind(key).first<{id:number;operation_type:string;status:string}>();
}

export async function GET(request: Request) {
  try {
    await requireManager(request);
    const [cores,parts] = await Promise.all([
      env.DB.prepare(`
        SELECT c.id,c.source_operation_id,c.repair_id,c.issued_part_id,c.core_part_id,c.quantity,c.status,c.opened_at,
               issued.part_number AS issued_part_number,issued.description AS issued_description,
               core.part_number AS core_part_number,core.description AS core_description,
               COALESCE(e.unit,'') AS unit
        FROM part_core_obligations c
        JOIN parts issued ON issued.id=c.issued_part_id
        LEFT JOIN parts core ON core.id=c.core_part_id
        LEFT JOIN repairs r ON r.id=c.repair_id
        LEFT JOIN equipment e ON e.id=r.equipment_id
        WHERE c.status='open'
        ORDER BY c.opened_at,c.id
      `).all<any>(),
      env.DB.prepare(`
        SELECT id,part_number,description,core_return_part_id,core_return_quantity
        FROM parts
        WHERE active=1
        ORDER BY description,part_number
      `).all<any>(),
    ]);
    return Response.json({ok:true,coreObligations:cores.results,parts:parts.results},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Core information could not be loaded.'},{status:403,headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireManager(request);
    const body = await request.json() as Record<string,unknown>;
    const action = String(body.action ?? '');

    if (action === 'configureCore') {
      const partId = positiveId(body.partId,'Issued part');
      const corePartId = body.corePartId == null || body.corePartId === '' ? null : positiveId(body.corePartId,'Returned core part');
      const quantity = corePartId == null ? 0 : positiveNumber(body.coreReturnQuantity,'Core quantity');
      if (!await activePart(partId)) throw new Error('Issued part was not found or is inactive.');
      if (corePartId && !await activePart(corePartId)) throw new Error('Returned core part was not found or is inactive.');
      await env.DB.prepare('UPDATE parts SET core_return_part_id=?,core_return_quantity=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND active=1')
        .bind(corePartId,quantity,partId).run();
      const saved = await env.DB.prepare('SELECT core_return_part_id,core_return_quantity FROM parts WHERE id=?').bind(partId).first<{core_return_part_id:number|null;core_return_quantity:number}>();
      return Response.json({ok:true,partId,corePartId:saved?.core_return_part_id ?? null,coreReturnQuantity:Number(saved?.core_return_quantity ?? 0)});
    }

    if (action === 'closeCore') {
      const obligationId = positiveId(body.obligationId,'Core obligation');
      const disposition = String(body.disposition ?? '').toLowerCase();
      if (disposition !== 'returned' && disposition !== 'waived') throw new Error('Core disposition must be returned or waived.');
      const key = operationKey(request,body,`core-${disposition}`);
      const prior = await existingOperation(key);
      if (prior) return Response.json({ok:true,idempotent:true,operationId:prior.id,obligationId,disposition});

      const obligation = await env.DB.prepare(`
        SELECT id,source_operation_id,repair_id,status
        FROM part_core_obligations
        WHERE id=?
      `).bind(obligationId).first<{id:number;source_operation_id:number;repair_id:number|null;status:string}>();
      if (!obligation || obligation.status !== 'open') throw new Error('Core obligation is no longer open.');

      await env.DB.batch([
        env.DB.prepare(`INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note) VALUES (?,?,?,?,?)`)
          .bind(key,`core_${disposition}`,obligation.repair_id,user.id,String(body.note ?? '').trim().slice(0,500)),
        env.DB.prepare(`
          UPDATE part_core_obligations
          SET status=?,closed_at=CURRENT_TIMESTAMP,closed_by_user_id=?
          WHERE id=? AND status='open'
        `).bind(disposition,user.id,obligationId),
        env.DB.prepare(`
          INSERT INTO inventory_operation_dependencies (operation_id,depends_on_operation_id,reason)
          SELECT id,?,'Core obligation disposition depends on the original issued part.'
          FROM inventory_operations
          WHERE operation_key=?
        `).bind(obligation.source_operation_id,key),
        env.DB.prepare(`
          INSERT INTO inventory_operation_commits (operation_id,applied)
          SELECT id,CASE WHEN (SELECT status FROM part_core_obligations WHERE id=?)=? THEN 1 ELSE 0 END
          FROM inventory_operations
          WHERE operation_key=?
        `).bind(obligationId,disposition,key),
      ]);

      const closed = await env.DB.prepare('SELECT status,closed_at FROM part_core_obligations WHERE id=?').bind(obligationId).first<{status:string;closed_at:string|null}>();
      if (!closed || closed.status !== disposition) throw new Error('Core return did not save. Please try again.');
      const operation = await existingOperation(key);
      return Response.json({ok:true,idempotent:false,operationId:operation?.id,obligationId,disposition,closedAt:closed.closed_at});
    }

    return Response.json({error:'Unknown core action.'},{status:400});
  } catch (error) {
    console.error(JSON.stringify({event:'cores_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Core action failed.'},{status:400});
  }
}
