import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { getShopLaborRate } from '@/lib/billing';

function repairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Repair was not found.');
  return id;
}

function timestampMs(value: string) {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error('Labor timer start time is invalid.');
  return parsed;
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

async function requireTechnician(user: AppUser) {
  if (!user.technicianId) throw new Error('This account is not linked to a technician. Ask an administrator to update the account.');
  const technician = await env.DB.prepare('SELECT id, name FROM technicians WHERE id = ? AND active = 1')
    .bind(user.technicianId)
    .first<{ id: number; name: string }>();
  if (!technician) throw new Error('The linked technician record is not active.');
  return technician;
}

async function recordEvent(repair: number, user: AppUser, action: string, detail = '') {
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
    VALUES (?, ?, ?, ?, ?)
  `).bind(repair, user.id, user.technicianId, action, detail.slice(0, 500)).run();
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const repairs = await env.DB.prepare(`
      SELECT r.id, COALESCE(e.unit, '') AS unit, r.title, r.status, COALESCE(r.location, '') AS location,
             r.technician_id, COALESCE(t.name, '') AS technician_name,
             COALESCE(r.labor_hours, 0) AS labor_hours
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN technicians t ON t.id = r.technician_id
      WHERE lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
      ORDER BY CASE WHEN r.technician_id = ? THEN 0 WHEN r.technician_id IS NULL THEN 1 ELSE 2 END,
               r.updated_at DESC, r.id DESC
    `).bind(user.technicianId ?? -1).all<{
      id: number; unit: string; title: string; status: string; location: string;
      technician_id: number | null; technician_name: string; labor_hours: number;
    }>();

    const activeTimer = await env.DB.prepare(`
      SELECT rt.repair_id, rt.started_at, COALESCE(r.title, '') AS title, COALESCE(e.unit, '') AS unit
      FROM repair_labor_timers rt
      JOIN repairs r ON r.id = rt.repair_id
      LEFT JOIN equipment e ON e.id = r.equipment_id
      WHERE rt.user_id = ?
    `).bind(user.id).first<{ repair_id: number; started_at: string; title: string; unit: string }>();

    return Response.json({
      user,
      activeTimer: activeTimer ? {
        repairId: `repair-${activeTimer.repair_id}`,
        startedAt: activeTimer.started_at,
        title: activeTimer.title,
        unit: activeTimer.unit,
      } : null,
      repairs: repairs.results.map((row) => ({
        id: `repair-${row.id}`,
        unit: row.unit,
        issue: row.title,
        status: row.status,
        location: row.location,
        technicianId: row.technician_id === null ? null : Number(row.technician_id),
        assignedTo: row.technician_name,
        laborHours: Number(row.labor_hours ?? 0),
      })),
      updatedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Shop jobs could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const technician = await requireTechnician(user);

    if (action === 'claimRepair') {
      const id = repairId(body.repairId);
      const result = await env.DB.prepare(`
        UPDATE repairs
        SET technician_id = ?, driver = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND technician_id IS NULL
          AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
      `).bind(technician.id, technician.name, id).run();
      if (Number(result.meta.changes ?? 0) === 0) {
        const current = await env.DB.prepare('SELECT technician_id FROM repairs WHERE id = ?').bind(id)
          .first<{ technician_id: number | null }>();
        if (!current) throw new Error('Repair was not found.');
        if (Number(current.technician_id ?? 0) !== technician.id) throw new Error('That job has already been grabbed or assigned to another technician.');
      }
      await recordEvent(id, user, 'claimed', `${technician.name} grabbed the job.`);
      return Response.json({ ok: true, repairId: `repair-${id}` });
    }

    if (action === 'startLabor') {
      const id = repairId(body.repairId);
      const repair = await env.DB.prepare(`
        SELECT id, technician_id, status FROM repairs WHERE id = ?
      `).bind(id).first<{ id: number; technician_id: number | null; status: string }>();
      if (!repair) throw new Error('Repair was not found.');
      if (String(repair.status ?? '').toLowerCase().includes('complete')) throw new Error('Completed repairs cannot start a labor timer.');
      if (Number(repair.technician_id ?? 0) !== technician.id) throw new Error('Grab this job or have a manager assign it to you before starting labor.');
      const existing = await env.DB.prepare('SELECT repair_id FROM repair_labor_timers WHERE user_id = ?').bind(user.id)
        .first<{ repair_id: number }>();
      if (existing) throw new Error(`You already have labor running on repair #${existing.repair_id}. Stop that timer first.`);
      const notes = String(body.notes ?? '').trim().slice(0, 500);
      await env.DB.prepare(`
        INSERT INTO repair_labor_timers (user_id, repair_id, technician_id, notes)
        VALUES (?, ?, ?, ?)
      `).bind(user.id, id, technician.id, notes).run();
      await recordEvent(id, user, 'labor_started', `${technician.name} started labor.`);
      return Response.json({ ok: true, repairId: `repair-${id}` });
    }

    if (action === 'stopLabor') {
      const timer = await env.DB.prepare(`
        SELECT user_id, repair_id, technician_id, started_at, COALESCE(notes, '') AS notes
        FROM repair_labor_timers WHERE user_id = ?
      `).bind(user.id).first<{ user_id: number; repair_id: number; technician_id: number; started_at: string; notes: string }>();
      if (!timer) throw new Error('You do not have an active labor timer.');
      if (body.repairId && repairId(body.repairId) !== timer.repair_id) throw new Error('That is not your active labor job.');

      const elapsedHours = Math.max(0.01, Math.round(((Date.now() - timestampMs(timer.started_at)) / 3600000) * 100) / 100);
      const rate = await getShopLaborRate(env.DB);
      const laborDate = new Date().toISOString().slice(0, 10);
      const stopNotes = String(body.notes ?? '').trim().slice(0, 500);
      const notes = [timer.notes, stopNotes].filter(Boolean).join(' — ').slice(0, 500);

      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO repair_labor_entries (repair_id, technician_id, labor_date, hours, rate, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(timer.repair_id, timer.technician_id, laborDate, elapsedHours, rate, notes),
        env.DB.prepare('DELETE FROM repair_labor_timers WHERE user_id = ?').bind(user.id),
        env.DB.prepare(`
          INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
          VALUES (?, ?, ?, 'labor_stopped', ?)
        `).bind(timer.repair_id, user.id, timer.technician_id, `${technician.name} stopped labor at ${elapsedHours.toFixed(2)} hours.`),
        env.DB.prepare(`
          UPDATE repairs
          SET labor_hours = (SELECT COALESCE(SUM(hours), 0) FROM repair_labor_entries WHERE repair_id = ?),
              labor_rate = COALESCE((SELECT SUM(hours * rate) / NULLIF(SUM(hours), 0) FROM repair_labor_entries WHERE repair_id = ?), ?),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(timer.repair_id, timer.repair_id, rate, timer.repair_id),
      ]);
      return Response.json({ ok: true, repairId: `repair-${timer.repair_id}`, hours: elapsedHours, rate });
    }

    return Response.json({ error: 'Unknown shop action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'shop_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Shop action failed.' }, { status: 400 });
  }
}
