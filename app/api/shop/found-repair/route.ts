import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getTirePositionStatus, replaceTirePositions } from '@/lib/tire-position-db';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

type ActiveRepair = {
  repair_id:number;
  technician_id:number;
  equipment_id:number|null;
  location:string;
  unit:string;
};

async function activeRepairForUser(userId:number, technicianId:number, expectedRepairId:number) {
  const active = await env.DB.prepare(`
    SELECT rt.repair_id, rt.technician_id, r.equipment_id,
           COALESCE(r.location, '') AS location,
           COALESCE(e.unit, '') AS unit
    FROM repair_labor_timers rt
    JOIN repairs r ON r.id = rt.repair_id
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE rt.user_id = ?
  `).bind(userId).first<ActiveRepair>();
  if (!active || Number(active.repair_id) !== expectedRepairId) {
    throw new Error('This unit-workspace action is available for the repair that is WORKING NOW.');
  }
  if (Number(active.technician_id) !== technicianId) {
    throw new Error('The active labor session does not belong to your technician account.');
  }
  return active;
}

async function assignedRepairForTechnician(repairId:number, technicianId:number) {
  const repair = await env.DB.prepare(`
    SELECT id, technician_id, COALESCE(status, '') AS status
    FROM repairs
    WHERE id = ?
  `).bind(repairId).first<{id:number;technician_id:number|null;status:string}>();
  if (!repair) throw new Error('Repair was not found.');
  if (Number(repair.technician_id ?? 0) !== technicianId) throw new Error('This repair is not assigned to you.');
  if (repair.status.toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  return repair;
}

async function technicianName(technicianId:number) {
  const technician = await env.DB.prepare('SELECT id, name FROM technicians WHERE id = ? AND active = 1')
    .bind(technicianId)
    .first<{id:number;name:string}>();
  if (!technician) throw new Error('The linked technician record is not active.');
  return technician;
}

async function repairNotes(repairId:number) {
  const result = await env.DB.prepare(`
    SELECT e.id, COALESCE(e.detail, '') AS detail, e.created_at,
           COALESCE(t.name, 'Technician') AS technician_name
    FROM repair_job_events e
    LEFT JOIN technicians t ON t.id = e.technician_id
    WHERE e.repair_id = ? AND e.action = 'technician_note'
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 20
  `).bind(repairId).all<{id:number;detail:string;created_at:string;technician_name:string}>();
  return result.results.map((row) => ({
    id:Number(row.id),
    detail:row.detail,
    technician:row.technician_name,
    createdAt:row.created_at,
  }));
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    if (!['mechanic','manager','admin'].includes(user.role) || !user.technicianId) throw new Error('A technician account is required.');
    const repairId = numericRepairId(new URL(request.url).searchParams.get('repairId'));
    if (!repairId) throw new Error('The repair was not found.');
    await assignedRepairForTechnician(repairId, Number(user.technicianId));
    const tirePosition = await getTirePositionStatus(env.DB, repairId);
    return Response.json({
      ok:true,
      repairId:`repair-${repairId}`,
      notes:await repairNotes(repairId),
      tirePosition,
    }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : 'Repair details could not be loaded.' }, { status:400, headers:{ 'cache-control':'no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    if (!['mechanic','manager','admin'].includes(user.role) || !user.technicianId) {
      throw new Error('A technician account is required to update the unit workspace.');
    }

    const body = await request.json() as Record<string, unknown>;
    const expectedRepairId = numericRepairId(body.repairId);
    if (!expectedRepairId) throw new Error('The repair was not found.');
    const technicianId = Number(user.technicianId);
    const technician = await technicianName(technicianId);
    const action = String(body.action ?? 'foundRepair');

    if (action === 'saveTirePositions') {
      await activeRepairForUser(user.id, technicianId, expectedRepairId);
      const tirePosition = await replaceTirePositions(env.DB, {
        repairId: expectedRepairId,
        rawPositions: body.positions,
        technicianId: technician.id,
        userId: user.id,
      });
      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'tire_positions_selected', ?)
      `).bind(
        expectedRepairId,
        user.id,
        technician.id,
        `Tire position(s): ${tirePosition.positions.join(', ')}`.slice(0, 500),
      ).run();
      return Response.json({
        ok:true,
        tirePositionsSaved:true,
        repairId:`repair-${expectedRepairId}`,
        tirePosition,
        laborUnchanged:true,
      });
    }

    if (action === 'note') {
      await assignedRepairForTechnician(expectedRepairId, technicianId);
      const note = String(body.note ?? '').trim().slice(0, 2000);
      if (!note) throw new Error('Type or dictate a repair note first.');
      const result = await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'technician_note', ?)
      `).bind(expectedRepairId, user.id, technician.id, note).run();
      return Response.json({
        ok:true,
        noteSaved:true,
        repairId:`repair-${expectedRepairId}`,
        noteId:Number(result.meta.last_row_id),
        laborUnchanged:true,
      });
    }

    if (action !== 'foundRepair') throw new Error('Unknown unit workspace action.');
    const active = await activeRepairForUser(user.id, technicianId, expectedRepairId);
    const issue = String(body.issue ?? '').trim().slice(0, 500);
    if (!issue) throw new Error('Enter what you found.');
    if (active.equipment_id === null) {
      throw new Error('This repair is not linked to a fleet unit, so another repair cannot be added from the unit workspace.');
    }

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
    console.error(JSON.stringify({ event:'shop_unit_workspace_action_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Unit workspace action could not be completed.' }, { status:400 });
  }
}
