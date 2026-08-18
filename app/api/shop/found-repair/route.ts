import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    if (user.role !== 'mechanic' || !user.technicianId) {
      throw new Error('A technician account is required to add a repair from the unit workspace.');
    }

    const body = await request.json() as Record<string, unknown>;
    const expectedRepairId = numericRepairId(body.repairId);
    const issue = String(body.issue ?? '').trim().slice(0, 500);
    if (!expectedRepairId) throw new Error('The active repair was not found.');
    if (!issue) throw new Error('Enter what you found.');

    const active = await env.DB.prepare(`
      SELECT rt.repair_id, rt.technician_id, r.equipment_id,
             COALESCE(r.location, '') AS location,
             COALESCE(e.unit, '') AS unit
      FROM repair_labor_timers rt
      JOIN repairs r ON r.id = rt.repair_id
      LEFT JOIN equipment e ON e.id = r.equipment_id
      WHERE rt.user_id = ?
    `).bind(user.id).first<{
      repair_id:number;
      technician_id:number;
      equipment_id:number|null;
      location:string;
      unit:string;
    }>();
    if (!active || Number(active.repair_id) !== expectedRepairId) {
      throw new Error('Found Something Else is only available for the repair that is WORKING NOW.');
    }
    if (Number(active.technician_id) !== Number(user.technicianId)) {
      throw new Error('The active labor session does not belong to your technician account.');
    }
    if (active.equipment_id === null) {
      throw new Error('This repair is not linked to a fleet unit, so another repair cannot be added from the unit workspace.');
    }

    const technician = await env.DB.prepare('SELECT id, name FROM technicians WHERE id = ? AND active = 1')
      .bind(user.technicianId)
      .first<{id:number;name:string}>();
    if (!technician) throw new Error('The linked technician record is not active.');

    const result = await env.DB.prepare(`
      INSERT INTO repairs (equipment_id, title, status, priority, source, location, technician_id, updated_at)
      VALUES (?, ?, 'Open', '2', 'manual', ?, ?, CURRENT_TIMESTAMP)
    `).bind(active.equipment_id, issue, active.location, technician.id).run();
    const id = Number(result.meta.last_row_id);
    if (!id) throw new Error('The repair could not be added.');

    await env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      VALUES (?, ?, ?, 'repair_created_by_technician', ?)
    `).bind(id, user.id, technician.id, `${technician.name} found additional work on Unit ${active.unit || active.equipment_id}: ${issue}`.slice(0, 500)).run();

    return Response.json({
      ok:true,
      foundRepair:true,
      repairId:`repair-${id}`,
      equipmentId:Number(active.equipment_id),
      unit:active.unit,
      issue,
      status:'Open',
      priority:2,
      technicianId:technician.id,
      laborUnchanged:true,
    });
  } catch (error) {
    console.error(JSON.stringify({ event:'shop_found_repair_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Repair could not be added.' }, { status:400 });
  }
}
