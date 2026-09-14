import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { requestUnmatchedPart } from '@/lib/unmatched-parts';
import { POST as shopPOST } from '../route';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function autoWaitAfterRequest(
  request:Request,
  user:{id:number;technicianId:number|null},
  repairId:number,
  detail:string,
) {
  const ownTimer = await env.DB.prepare('SELECT repair_id FROM repair_labor_timers WHERE user_id = ?')
    .bind(user.id).first<{repair_id:number}>();

  if (Number(ownTimer?.repair_id ?? 0) === repairId) {
    const headers = new Headers(request.headers);
    headers.set('content-type','application/json');
    headers.delete('content-length');
    const waitingRequest = new Request(request.url,{
      method:'POST',
      headers,
      body:JSON.stringify({
        action:'repairOutcome',
        repairId:`repair-${repairId}`,
        outcome:'waiting_part',
        notes:detail,
      }),
    });
    const response = await shopPOST(waitingRequest);
    const payload = await response.json() as Record<string,unknown>;
    if (!response.ok || payload.ok === false) {
      throw new Error(String(payload.error ?? 'The part request was saved, but the repair could not move to Waiting on Part.'));
    }
    return payload;
  }

  const anyTimer = await env.DB.prepare('SELECT user_id FROM repair_labor_timers WHERE repair_id = ? LIMIT 1')
    .bind(repairId).first<{user_id:number}>();
  if (anyTimer) return { waitingOnPart:false, activeLaborContinues:true };

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE repairs
      SET status='Waiting on Part', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    `).bind(repairId),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'waiting_on_part',?)
    `).bind(repairId,user.id,user.technicianId,detail.slice(0,500)),
  ]);
  return { waitingOnPart:true, nextRepairId:null, laborStarted:false };
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    if (user.role !== 'mechanic' || !user.technicianId) throw new Error('A technician account is required.');

    const body = await request.json() as Record<string, unknown>;
    const repairId = numericRepairId(body.repairId);
    const requestedText = String(body.requestedText ?? '').trim();
    const quantity = Number(body.quantity ?? 0);
    if (!repairId) throw new Error('Repair was not found.');

    const repair = await env.DB.prepare(`
      SELECT r.id, r.technician_id, COALESCE(r.status,'') AS status,
             COALESCE(e.current_yard,'') AS current_yard, COALESCE(r.location,'') AS repair_location
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      WHERE r.id = ?
    `).bind(repairId).first<{
      id:number;technician_id:number|null;status:string;current_yard:string;repair_location:string;
    }>();
    if (!repair) throw new Error('Repair was not found.');
    if (Number(repair.technician_id ?? 0) !== Number(user.technicianId)) throw new Error('This repair is not assigned to you.');
    if (repair.status.toLowerCase().includes('complete')) throw new Error('That repair is already completed.');

    const result = await requestUnmatchedPart(env.DB, {
      repairId,
      requestedText,
      quantity,
      userId:user.id,
      technicianId:Number(user.technicianId),
      fallbackYard:repair.current_yard || repair.repair_location,
    });

    const detail = `${result.addedQuantity} x ${result.requestedText} requested for Parts Desk (${result.warehouseCode}).`;
    await env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      VALUES (?, ?, ?, 'unmatched_part_requested', ?)
    `).bind(
      repairId,
      user.id,
      user.technicianId,
      detail.slice(0,500),
    ).run();

    const waitingResult = await autoWaitAfterRequest(
      request.clone(),
      {id:user.id,technicianId:user.technicianId},
      repairId,
      `Part shortage requested from Part Lookup. ${detail}`,
    );

    return Response.json({ ...result, ...waitingResult, repairId:`repair-${repairId}`, awaitingParts:true });
  } catch (error) {
    console.error(JSON.stringify({ event:'shop_unmatched_part_request_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Part request could not be saved.' }, { status:400 });
  }
}
