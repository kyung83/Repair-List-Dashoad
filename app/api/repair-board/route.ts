import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

const STATUSES = new Set(['New', 'Assigned', 'Waiting for Parts', 'In Progress', 'Completed']);

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Repair was not found.');
  return id;
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

function requireManager(user: AppUser) {
  if (user.role !== 'manager' && user.role !== 'admin') {
    throw new Error('Manager or administrator access is required for this change.');
  }
}

async function openRepairRow(id: number) {
  const repair = await env.DB.prepare(`
    SELECT id, technician_id, status
    FROM repairs
    WHERE id = ?
  `).bind(id).first<{ id: number; technician_id: number | null; status: string }>();
  if (!repair) throw new Error('Repair was not found.');
  if (String(repair.status ?? '').toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  return repair;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const [repairs, technicians] = await Promise.all([
      env.DB.prepare(`
        SELECT r.id,
               CASE
                 WHEN lower(trim(COALESCE(r.priority, ''))) IN ('1', 'high', 'urgent', 'critical') THEN 1
                 WHEN lower(trim(COALESCE(r.priority, ''))) IN ('3', 'low') THEN 3
                 ELSE 2
               END AS priority,
               COALESCE(NULLIF(r.location, ''), NULLIF(e.location, ''), '') AS location,
               COALESCE(e.unit, '') AS unit,
               COALESCE(NULLIF(e.driver, ''), NULLIF(r.driver, ''), '') AS driver,
               r.title,
               COALESCE(r.parts_text, '') AS parts_text,
               COALESCE(r.status, 'New') AS status,
               r.technician_id,
               COALESCE(t.name, '') AS technician_name,
               COALESCE(r.labor_hours, 0) AS labor_hours,
               COALESCE(e.equipment_type, 'other') AS equipment_type,
               rt.started_at AS timer_started_at,
               COALESCE(tt.name, '') AS timer_technician
        FROM repairs r
        LEFT JOIN equipment e ON e.id = r.equipment_id
        LEFT JOIN technicians t ON t.id = r.technician_id
        LEFT JOIN repair_labor_timers rt ON rt.repair_id = r.id
        LEFT JOIN technicians tt ON tt.id = rt.technician_id
        WHERE lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
        ORDER BY priority,
                 CASE WHEN r.technician_id IS NULL THEN 0 ELSE 1 END,
                 r.updated_at DESC,
                 r.id DESC
      `).all<{
        id: number;
        priority: number;
        location: string;
        unit: string;
        driver: string;
        title: string;
        parts_text: string;
        status: string;
        technician_id: number | null;
        technician_name: string;
        labor_hours: number;
        equipment_type: string;
        timer_started_at: string | null;
        timer_technician: string;
      }>(),
      env.DB.prepare(`
        SELECT id, name
        FROM technicians
        WHERE active = 1
        ORDER BY name
      `).all<{ id: number; name: string }>(),
    ]);

    const rows = repairs.results.map((row) => ({
      id: `repair-${row.id}`,
      priority: Number(row.priority ?? 2),
      location: row.location,
      unit: row.unit,
      driver: row.driver,
      issue: row.title,
      parts: row.parts_text,
      status: row.status,
      technicianId: row.technician_id === null ? null : Number(row.technician_id),
      assignedTo: row.technician_name,
      laborHours: Number(row.labor_hours ?? 0),
      equipmentType: row.equipment_type,
      activeTimer: row.timer_started_at ? {
        startedAt: row.timer_started_at,
        technician: row.timer_technician,
      } : null,
    }));

    return Response.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        technicianId: user.technicianId,
      },
      canManage: user.role === 'manager' || user.role === 'admin',
      technicians: technicians.results.map((technician) => ({ id: technician.id, name: technician.name })),
      repairs: rows,
      summary: {
        total: rows.length,
        highPriority: rows.filter((row) => row.priority === 1).length,
        unassigned: rows.filter((row) => row.technicianId === null).length,
        activeLabor: rows.filter((row) => row.activeTimer !== null).length,
      },
      updatedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_board_get_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Repair board could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requireManager(user);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const id = repairNumber(body.repairId);
    const repair = await openRepairRow(id);

    if (action === 'assignTechnician') {
      const technicianId = Number(body.technicianId ?? 0);
      let technician: { id: number; name: string } | null = null;
      if (technicianId > 0) {
        technician = await env.DB.prepare('SELECT id, name FROM technicians WHERE id = ? AND active = 1')
          .bind(technicianId)
          .first<{ id: number; name: string }>();
        if (!technician) throw new Error('Technician was not found or is inactive.');
      }

      const activeTimer = await env.DB.prepare(`
        SELECT technician_id FROM repair_labor_timers WHERE repair_id = ?
      `).bind(id).first<{ technician_id: number }>();
      if (activeTimer && Number(activeTimer.technician_id) !== Number(technician?.id ?? 0)) {
        throw new Error('This repair has active labor. Stop the running timer before reassigning it.');
      }

      const nextStatus = technician
        ? (String(repair.status).toLowerCase() === 'new' ? 'Assigned' : repair.status)
        : (String(repair.status).toLowerCase() === 'assigned' ? 'New' : repair.status);
      const actionName = technician ? 'assigned' : 'unassigned';
      const detail = technician
        ? `${user.displayName} assigned the repair to ${technician.name}.`
        : `${user.displayName} moved the repair back to the unassigned queue.`;

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE repairs
          SET technician_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(technician?.id ?? null, nextStatus, id),
        env.DB.prepare(`
          INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
          VALUES (?, ?, ?, ?, ?)
        `).bind(id, user.id, technician?.id ?? null, actionName, detail),
      ]);

      return Response.json({ ok: true, repairId: `repair-${id}`, technicianId: technician?.id ?? null, status: nextStatus });
    }

    if (action === 'setPriority') {
      const priority = Number(body.priority);
      if (![1, 2, 3].includes(priority)) throw new Error('Priority must be 1, 2, or 3.');
      await env.DB.batch([
        env.DB.prepare('UPDATE repairs SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(String(priority), id),
        env.DB.prepare(`
          INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
          VALUES (?, ?, ?, 'priority_changed', ?)
        `).bind(id, user.id, repair.technician_id, `${user.displayName} changed priority to ${priority}.`),
      ]);
      return Response.json({ ok: true, repairId: `repair-${id}`, priority });
    }

    if (action === 'setStatus') {
      const status = String(body.status ?? '').trim();
      if (!STATUSES.has(status)) throw new Error('Choose a valid repair status.');
      if (status === 'Completed') {
        const activeTimer = await env.DB.prepare('SELECT user_id FROM repair_labor_timers WHERE repair_id = ?').bind(id).first();
        if (activeTimer) throw new Error('Stop active labor before completing this repair.');
      }
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE repairs
          SET status = ?,
              completed_at = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(status, status, id),
        env.DB.prepare(`
          INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
          VALUES (?, ?, ?, 'status_changed', ?)
        `).bind(id, user.id, repair.technician_id, `${user.displayName} changed status to ${status}.`),
      ]);
      return Response.json({ ok: true, repairId: `repair-${id}`, status });
    }

    return Response.json({ error: 'Unknown repair-board action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_board_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Repair-board change failed.' }, { status: 400 });
  }
}
