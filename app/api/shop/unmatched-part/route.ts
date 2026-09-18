import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { normalizeWarehouseCode } from '@/lib/parts-lifecycle';
import { requestUnmatchedPart } from '@/lib/unmatched-parts';
import { yardWarehouseCode } from '@/lib/yards';
import { POST as shopPOST } from '../route';

type RequestContext = {
  url:string;
  headers:Headers;
};

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function firstRecognizedWarehouse(...values:unknown[]) {
  for (const value of values) {
    const code = normalizeWarehouseCode(value);
    if (code) return code;
  }
  return '';
}

async function autoWaitAfterRequest(
  requestContext:RequestContext,
  user:{id:number;technicianId:number|null},
  repairId:number,
  detail:string,
) {
  const ownTimer = await env.DB.prepare('SELECT repair_id FROM repair_labor_timers WHERE user_id = ?')
    .bind(user.id).first<{repair_id:number}>();

  if (Number(ownTimer?.repair_id ?? 0) === repairId) {
    const headers = new Headers(requestContext.headers);
    headers.set('content-type','application/json');
    headers.delete('content-length');
    const waitingRequest = new Request(requestContext.url,{
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
    if (!['mechanic','manager','admin'].includes(user.role) || !user.technicianId) {
      throw new Error('A working technician account is required.');
    }

    const requestContext:RequestContext = {
      url:request.url,
      headers:new Headers(request.headers),
    };
    const body = await request.json() as Record<string, unknown>;
    const repairId = numericRepairId(body.repairId);
    const requestedText = String(body.requestedText ?? '').trim();
    const quantity = Number(body.quantity ?? 0);
    if (!repairId) throw new Error('Repair was not found.');

    const repair = await env.DB.prepare(`
      SELECT r.id, r.technician_id, COALESCE(r.status,'') AS status,
             COALESCE(s.yard,'') AS live_yard,
             COALESCE(e.current_yard,'') AS current_yard,
             COALESCE(r.location,'') AS repair_location,
             COALESCE(u.yard,'') AS user_yard
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN equipment_geotab_devices d ON d.equipment_id = e.id AND d.current = 1
      LEFT JOIN geotab_unit_state s ON s.equipment_id = e.id AND s.geotab_device_id = d.geotab_device_id
      LEFT JOIN app_users u ON u.id = ?
      WHERE r.id = ?
    `).bind(user.id,repairId).first<{
      id:number;
      technician_id:number|null;
      status:string;
      live_yard:string;
      current_yard:string;
      repair_location:string;
      user_yard:string;
    }>();
    if (!repair) throw new Error('Repair was not found.');
    if (Number(repair.technician_id ?? 0) !== Number(user.technicianId)) throw new Error('This repair is not assigned to you.');
    if (repair.status.toLowerCase().includes('complete')) throw new Error('That repair is already completed.');

    const lockedToAssignedWarehouse = user.role === 'mechanic' || user.role === 'manager';
    const assignedWarehouseCode = lockedToAssignedWarehouse ? yardWarehouseCode(repair.user_yard) : '';
    if (lockedToAssignedWarehouse && !assignedWarehouseCode) {
      throw new Error('Your account needs an assigned yard/parts warehouse before you can request parts.');
    }

    const fallbackYard = lockedToAssignedWarehouse
      ? repair.user_yard
      : firstRecognizedWarehouse(
          repair.live_yard,
          repair.current_yard,
          repair.repair_location,
          repair.user_yard,
        );

    const result = await requestUnmatchedPart(env.DB, {
      repairId,
      requestedText,
      quantity,
      userId:user.id,
      technicianId:Number(user.technicianId),
      fallbackYard,
      warehouseCode:assignedWarehouseCode,
    });

    const yardDetail = result.warehouseCode
      ? ` (${result.warehouseCode})`
      : ' (yard to be assigned by Parts Desk)';
    const detail = `${result.addedQuantity} x ${result.requestedText} requested for Parts Desk${yardDetail}.`;
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
      requestContext,
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
