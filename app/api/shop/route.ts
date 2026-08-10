import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { getShopLaborRate } from '@/lib/billing';
import { usePartOnRepair } from '@/lib/inventory-db';

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

async function requireAssignedRepair(technicianId: number, id: number) {
  const repair = await env.DB.prepare(`
    SELECT id, equipment_id, technician_id, status, title
    FROM repairs
    WHERE id = ?
  `).bind(id).first<{
    id: number;
    equipment_id: number | null;
    technician_id: number | null;
    status: string;
    title: string;
  }>();
  if (!repair) throw new Error('Repair was not found.');
  if (String(repair.status ?? '').toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  if (Number(repair.technician_id ?? 0) !== technicianId) throw new Error('This repair is not assigned to you.');
  return repair;
}

async function recordEvent(repair: number, user: AppUser, action: string, detail = '') {
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
    VALUES (?, ?, ?, ?, ?)
  `).bind(repair, user.id, user.technicianId, action, detail.slice(0, 500)).run();
}

async function refreshRepairPartsText(repair: number) {
  const rows = await env.DB.prepare(`
    SELECT p.part_number, SUM(rp.quantity) AS quantity
    FROM repair_parts rp
    JOIN parts p ON p.id = rp.part_id
    WHERE rp.repair_id = ?
    GROUP BY p.id, p.part_number
    ORDER BY p.part_number
  `).bind(repair).all<{ part_number: string; quantity: number }>();
  const text = rows.results.map((row) => `${row.part_number} x${Number(row.quantity)}`).join(', ');
  await env.DB.prepare('UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(text, repair).run();
}

async function stopActiveLabor(
  user: AppUser,
  technician: { id: number; name: string },
  expectedRepairId?: number,
  requireTimer = true,
  stopNotesValue: unknown = '',
) {
  const timer = await env.DB.prepare(`
    SELECT user_id, repair_id, technician_id, started_at, COALESCE(notes, '') AS notes
    FROM repair_labor_timers WHERE user_id = ?
  `).bind(user.id).first<{
    user_id: number;
    repair_id: number;
    technician_id: number;
    started_at: string;
    notes: string;
  }>();
  if (!timer) {
    if (requireTimer) throw new Error('You do not have an active labor timer.');
    return null;
  }
  if (expectedRepairId && expectedRepairId !== timer.repair_id) {
    throw new Error(`You already have labor running on repair #${timer.repair_id}. Stop that timer first.`);
  }

  const elapsedHours = Math.max(0.01, Math.round(((Date.now() - timestampMs(timer.started_at)) / 3600000) * 100) / 100);
  const rate = await getShopLaborRate(env.DB);
  const laborDate = new Date().toISOString().slice(0, 10);
  const stopNotes = String(stopNotesValue ?? '').trim().slice(0, 500);
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

  return { repairId: timer.repair_id, hours: elapsedHours, rate };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const [repairs, activeTimer, parts, usedParts, laborEntries] = await Promise.all([
      env.DB.prepare(`
        SELECT r.id, r.equipment_id, COALESCE(e.unit, '') AS unit, r.title, r.status,
               COALESCE(r.location, '') AS location, r.technician_id,
               COALESCE(t.name, '') AS technician_name, COALESCE(r.labor_hours, 0) AS labor_hours
        FROM repairs r
        LEFT JOIN equipment e ON e.id = r.equipment_id
        LEFT JOIN technicians t ON t.id = r.technician_id
        WHERE lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
        ORDER BY CASE WHEN r.technician_id = ? THEN 0 WHEN r.technician_id IS NULL THEN 1 ELSE 2 END,
                 r.updated_at DESC, r.id DESC
      `).bind(user.technicianId ?? -1).all<{
        id: number;
        equipment_id: number | null;
        unit: string;
        title: string;
        status: string;
        location: string;
        technician_id: number | null;
        technician_name: string;
        labor_hours: number;
      }>(),
      env.DB.prepare(`
        SELECT rt.repair_id, rt.started_at, COALESCE(r.title, '') AS title, COALESCE(e.unit, '') AS unit
        FROM repair_labor_timers rt
        JOIN repairs r ON r.id = rt.repair_id
        LEFT JOIN equipment e ON e.id = r.equipment_id
        WHERE rt.user_id = ?
      `).bind(user.id).first<{ repair_id: number; started_at: string; title: string; unit: string }>(),
      env.DB.prepare(`
        SELECT id, part_number, description, quantity_on_hand, COALESCE(location, '') AS location
        FROM parts
        WHERE active = 1
        ORDER BY description, part_number
      `).all<{ id: number; part_number: string; description: string; quantity_on_hand: number; location: string }>(),
      env.DB.prepare(`
        SELECT rp.repair_id, rp.part_id, p.part_number, p.description, SUM(rp.quantity) AS quantity
        FROM repair_parts rp
        JOIN parts p ON p.id = rp.part_id
        JOIN repairs r ON r.id = rp.repair_id
        WHERE lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
        GROUP BY rp.repair_id, rp.part_id, p.part_number, p.description
        ORDER BY p.part_number
      `).all<{ repair_id: number; part_id: number; part_number: string; description: string; quantity: number }>(),
      env.DB.prepare(`
        SELECT l.id, l.repair_id, l.labor_date, l.hours, l.rate, COALESCE(l.notes, '') AS notes,
               COALESCE(t.name, 'Shop labor') AS technician_name
        FROM repair_labor_entries l
        LEFT JOIN technicians t ON t.id = l.technician_id
        JOIN repairs r ON r.id = l.repair_id
        WHERE lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
        ORDER BY l.labor_date DESC, l.id DESC
      `).all<{
        id: number;
        repair_id: number;
        labor_date: string;
        hours: number;
        rate: number;
        notes: string;
        technician_name: string;
      }>(),
    ]);

    const usedByRepair = new Map<number, { partId: number; partNumber: string; description: string; quantity: number }[]>();
    for (const row of usedParts.results) {
      const list = usedByRepair.get(row.repair_id) ?? [];
      list.push({ partId: row.part_id, partNumber: row.part_number, description: row.description, quantity: Number(row.quantity) });
      usedByRepair.set(row.repair_id, list);
    }
    const laborByRepair = new Map<number, { id: number; technician: string; laborDate: string; hours: number; rate: number; notes: string }[]>();
    for (const row of laborEntries.results) {
      const list = laborByRepair.get(row.repair_id) ?? [];
      list.push({ id: row.id, technician: row.technician_name, laborDate: row.labor_date, hours: Number(row.hours), rate: Number(row.rate), notes: row.notes });
      laborByRepair.set(row.repair_id, list);
    }

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
        equipmentId: row.equipment_id === null ? null : Number(row.equipment_id),
        unit: row.unit,
        issue: row.title,
        status: row.status,
        location: row.location,
        technicianId: row.technician_id === null ? null : Number(row.technician_id),
        assignedTo: row.technician_name,
        laborHours: Number(row.labor_hours ?? 0),
        usedParts: usedByRepair.get(row.id) ?? [],
        laborEntries: laborByRepair.get(row.id) ?? [],
      })),
      parts: parts.results.map((row) => ({
        id: row.id,
        partNumber: row.part_number,
        description: row.description,
        quantityOnHand: Number(row.quantity_on_hand),
        location: row.location,
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

    if (action === 'openRepair') {
      const id = repairId(body.repairId);
      const existing = await env.DB.prepare('SELECT repair_id FROM repair_labor_timers WHERE user_id = ?')
        .bind(user.id)
        .first<{ repair_id: number }>();
      if (existing) {
        if (existing.repair_id === id) return Response.json({ ok: true, repairId: `repair-${id}`, alreadyRunning: true });
        throw new Error(`You already have labor running on repair #${existing.repair_id}. Stop that timer before opening another job.`);
      }

      const repair = await env.DB.prepare('SELECT id, technician_id, status FROM repairs WHERE id = ?')
        .bind(id)
        .first<{ id: number; technician_id: number | null; status: string }>();
      if (!repair) throw new Error('Repair was not found.');
      if (String(repair.status ?? '').toLowerCase().includes('complete')) throw new Error('Completed repairs cannot be opened for labor.');
      if (repair.technician_id !== null && Number(repair.technician_id) !== technician.id) {
        throw new Error('That job is assigned to another technician.');
      }

      const wasUnassigned = repair.technician_id === null;
      const notes = String(body.notes ?? '').trim().slice(0, 500);
      const results = await env.DB.batch([
        env.DB.prepare(`
          UPDATE repairs
          SET technician_id = ?, driver = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND (technician_id IS NULL OR technician_id = ?)
            AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
        `).bind(technician.id, technician.name, id, technician.id),
        env.DB.prepare(`
          INSERT INTO repair_labor_timers (user_id, repair_id, technician_id, notes)
          SELECT ?, r.id, ?, ?
          FROM repairs r
          WHERE r.id = ?
            AND r.technician_id = ?
            AND lower(COALESCE(r.status, '')) NOT LIKE '%complete%'
        `).bind(user.id, technician.id, notes, id, technician.id),
        env.DB.prepare(`
          INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
          SELECT ?, ?, ?, 'claimed', ?
          WHERE ? = 1
            AND EXISTS (
              SELECT 1 FROM repair_labor_timers WHERE user_id = ? AND repair_id = ?
            )
        `).bind(id, user.id, technician.id, `${technician.name} opened and grabbed the job.`, wasUnassigned ? 1 : 0, user.id, id),
        env.DB.prepare(`
          INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
          SELECT ?, ?, ?, 'labor_started', ?
          WHERE EXISTS (
            SELECT 1 FROM repair_labor_timers WHERE user_id = ? AND repair_id = ?
          )
        `).bind(id, user.id, technician.id, `${technician.name} opened the job and labor started automatically.`, user.id, id),
      ]);

      if (Number(results[1]?.meta.changes ?? 0) === 0) {
        const current = await env.DB.prepare('SELECT technician_id, status FROM repairs WHERE id = ?')
          .bind(id)
          .first<{ technician_id: number | null; status: string }>();
        if (!current) throw new Error('Repair was not found.');
        if (String(current.status ?? '').toLowerCase().includes('complete')) throw new Error('That repair has already been completed.');
        if (Number(current.technician_id ?? 0) !== technician.id) throw new Error('That job was grabbed or assigned to another technician.');
        throw new Error('Labor could not be started for that repair.');
      }

      return Response.json({ ok: true, repairId: `repair-${id}`, claimed: wasUnassigned, laborStarted: true });
    }

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
      await requireAssignedRepair(technician.id, id);
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

    if (action === 'usePart') {
      const id = repairId(body.repairId);
      await requireAssignedRepair(technician.id, id);
      const partId = Number(body.partId ?? 0);
      const quantity = Number(body.quantity ?? 0);
      const part = await env.DB.prepare('SELECT part_number, description FROM parts WHERE id = ? AND active = 1')
        .bind(partId)
        .first<{ part_number: string; description: string }>();
      if (!part) throw new Error('Part was not found.');
      await usePartOnRepair(env.DB, { ...body, repairId: `repair-${id}` });
      await refreshRepairPartsText(id);
      await recordEvent(id, user, 'part_used', `${technician.name} used ${quantity} x ${part.part_number} — ${part.description}.`);
      return Response.json({ ok: true, repairId: `repair-${id}`, partId, quantity });
    }

    if (action === 'completeRepair') {
      const id = repairId(body.repairId ?? body.id);
      await requireAssignedRepair(technician.id, id);
      const stopped = await stopActiveLabor(user, technician, id, false, body.notes);
      const result = await env.DB.prepare(`
        UPDATE repairs
        SET status = 'Completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND technician_id = ?
          AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
      `).bind(id, technician.id).run();
      if (Number(result.meta.changes ?? 0) === 0) throw new Error('Repair could not be completed.');
      await recordEvent(id, user, 'completed', `${technician.name} completed the repair.`);
      return Response.json({
        ok: true,
        repairId: `repair-${id}`,
        completed: true,
        hours: stopped?.hours,
        rate: stopped?.rate,
      });
    }

    if (action === 'stopLabor') {
      const expected = body.repairId ? repairId(body.repairId) : undefined;
      const stopped = await stopActiveLabor(user, technician, expected, true, body.notes);
      return Response.json({ ok: true, repairId: `repair-${stopped!.repairId}`, hours: stopped!.hours, rate: stopped!.rate });
    }

    return Response.json({ error: 'Unknown shop action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'shop_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Shop action failed.' }, { status: 400 });
  }
}
