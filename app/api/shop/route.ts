import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { GET as originalGET, POST as originalPOST } from './original';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function isDeferredRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(id).first<{status:string}>();
  return Boolean(row && String(row.status).toLowerCase().startsWith('deferred to next'));
}

async function mechanicTakeAssignedRepair(request: Request, body: Record<string, unknown>) {
  const id = numericRepairId(body.repairId ?? body.id);
  if (!id) return null;

  const user = await getSessionUser(env.DB, request);
  if (!user || user.role !== 'mechanic' || !user.technicianId) return null;

  const repair = await env.DB.prepare(`
    SELECT r.id, r.technician_id, COALESCE(r.status,'') AS status,
           COALESCE(old.name,'') AS old_technician,
           COALESCE(new.name,'') AS new_technician
    FROM repairs r
    LEFT JOIN technicians old ON old.id = r.technician_id
    LEFT JOIN technicians new ON new.id = ?
    WHERE r.id = ?
  `).bind(user.technicianId, id).first<{
    id:number;
    technician_id:number|null;
    status:string;
    old_technician:string;
    new_technician:string;
  }>();
  if (!repair) return Response.json({ error: 'Repair was not found.' }, { status: 404 });
  if (String(repair.status).toLowerCase().includes('complete')) return Response.json({ error: 'That repair is already completed.' }, { status: 400 });
  if (repair.technician_id === null || Number(repair.technician_id) === Number(user.technicianId)) return null;

  const ownTimer = await env.DB.prepare('SELECT repair_id FROM repair_labor_timers WHERE user_id = ?').bind(user.id).first<{repair_id:number}>();
  if (ownTimer) return Response.json({ error: `You already have labor running on repair #${ownTimer.repair_id}. Stop that timer before taking another job.` }, { status: 409 });

  const activeOnTarget = await env.DB.prepare(`
    SELECT rt.user_id, rt.technician_id, COALESCE(t.name,'another technician') AS technician_name
    FROM repair_labor_timers rt
    LEFT JOIN technicians t ON t.id = rt.technician_id
    WHERE rt.repair_id = ?
    LIMIT 1
  `).bind(id).first<{user_id:number;technician_id:number;technician_name:string}>();
  if (activeOnTarget) {
    return Response.json({ error: `${activeOnTarget.technician_name} currently has labor running on this repair. It can be taken after that labor is stopped.` }, { status: 409 });
  }

  const technicianName = repair.new_technician || user.displayName;
  const oldTechnician = repair.old_technician || 'another technician';
  const notes = String(body.notes ?? '').trim().slice(0, 500);
  const result = await env.DB.batch([
    env.DB.prepare(`
      UPDATE repairs
      SET technician_id = ?, driver = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND technician_id = ?
        AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
        AND NOT EXISTS (SELECT 1 FROM repair_labor_timers WHERE repair_id = ?)
    `).bind(user.technicianId, technicianName, id, repair.technician_id, id),
    env.DB.prepare(`
      INSERT INTO repair_labor_timers (user_id, repair_id, technician_id, notes)
      SELECT ?, r.id, ?, ?
      FROM repairs r
      WHERE r.id = ?
        AND r.technician_id = ?
        AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
        AND NOT EXISTS (SELECT 1 FROM repair_labor_timers WHERE repair_id = r.id)
    `).bind(user.id, user.technicianId, notes, id, user.technicianId),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      SELECT ?, ?, ?, 'reassigned', ?
      WHERE EXISTS (SELECT 1 FROM repair_labor_timers WHERE user_id = ? AND repair_id = ?)
    `).bind(id, user.id, user.technicianId, `${technicianName} took over this open repair from ${oldTechnician}.`, user.id, id),
    env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      SELECT ?, ?, ?, 'labor_started', ?
      WHERE EXISTS (SELECT 1 FROM repair_labor_timers WHERE user_id = ? AND repair_id = ?)
    `).bind(id, user.id, user.technicianId, `${technicianName} took the job and labor started automatically.`, user.id, id),
  ]);

  if (Number(result[1]?.meta.changes ?? 0) === 0) {
    return Response.json({ error: 'That repair changed before you could take it. Refresh My Jobs and try again.' }, { status: 409 });
  }

  return Response.json({ ok:true, repairId:`repair-${id}`, laborStarted:true, takenOver:true, previousTechnician:oldTechnician });
}

export async function GET(request: Request) {
  const response = await originalGET(request);
  if (!response.ok) return response;
  const payload = await response.json() as { repairs?: Array<{status?:string}>; [key:string]: unknown };
  if (Array.isArray(payload.repairs)) {
    payload.repairs = payload.repairs.filter((repair) => !String(repair.status ?? '').toLowerCase().startsWith('deferred to next'));
  }
  return Response.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const clone = request.clone();
  try {
    const body = await clone.json() as Record<string, unknown>;
    if (await isDeferredRepair(body.repairId ?? body.id)) {
      return Response.json({ error: 'This repair is saved for a future PM/Annual and is not active shop work yet.' }, { status: 400 });
    }
    if (String(body.action ?? '') === 'openRepair') {
      const takeover = await mechanicTakeAssignedRepair(request.clone(), body);
      if (takeover) return takeover;
    }
  } catch {
    // The original handler owns validation for malformed/non-JSON requests.
  }
  return originalPOST(request);
}
