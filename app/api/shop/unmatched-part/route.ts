import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { requestUnmatchedPart } from '@/lib/unmatched-parts';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
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

    await env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      VALUES (?, ?, ?, 'unmatched_part_requested', ?)
    `).bind(
      repairId,
      user.id,
      user.technicianId,
      `${result.addedQuantity} x ${result.requestedText} requested for Parts Desk (${result.warehouseCode}).`.slice(0,500),
    ).run();

    return Response.json({ ...result, repairId:`repair-${repairId}` });
  } catch (error) {
    console.error(JSON.stringify({ event:'shop_unmatched_part_request_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Part request could not be saved.' }, { status:400 });
  }
}
