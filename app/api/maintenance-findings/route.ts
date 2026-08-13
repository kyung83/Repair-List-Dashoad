import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type EventType = 'pm' | 'annual';
type MaintenanceRepair = {
  id: number;
  equipment_id: number;
  technician_id: number | null;
  source: string;
  status: string;
  unit: string;
};

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Maintenance work order was not found.');
  return id;
}

function eventType(source: string): EventType {
  if (source === 'scheduled-pm') return 'pm';
  if (source === 'scheduled-annual') return 'annual';
  throw new Error('Findings can only be added from a scheduled PM or Annual.');
}

function canManage(user: AppUser) {
  return user.role === 'manager' || user.role === 'admin';
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

async function loadMaintenanceRepair(id: number) {
  const row = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.source,'') AS source,
           COALESCE(r.status,'') AS status, COALESCE(e.unit,'') AS unit
    FROM repairs r
    JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<MaintenanceRepair>();
  if (!row) throw new Error('Maintenance work order was not found.');
  eventType(row.source);
  return row;
}

function requireWorkAccess(user: AppUser, repair: MaintenanceRepair) {
  if (canManage(user)) return;
  if (user.role !== 'mechanic' || !user.technicianId) throw new Error('Technician access is required.');
  if (Number(repair.technician_id ?? 0) !== Number(user.technicianId)) {
    throw new Error('This maintenance work order is not assigned to you.');
  }
}

async function requireQuestionsAnswered(repairId: number) {
  const row = await env.DB.prepare(`
    SELECT c.id, COALESCE(c.status,'') AS status,
           SUM(CASE WHEN i.result = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM maintenance_checklist_runs c
    JOIN maintenance_checklist_items i ON i.checklist_run_id = c.id
    WHERE c.repair_id = ?
    GROUP BY c.id, c.status
  `).bind(repairId).first<{ id: number; status: string; pending: number | null }>();
  if (!row) throw new Error('Start the PM/Annual inspection before adding a finding.');
  if (row.status === 'completed') throw new Error('Completed inspections cannot be changed.');
  if (Number(row.pending ?? 0) > 0) {
    throw new Error('Finish answering the inspection questions first. Repairs can still be open when you save a Future Repair.');
  }
}

async function removeOrphanRepair(id: number) {
  try {
    await env.DB.prepare(`
      DELETE FROM repairs
      WHERE id = ? AND source = 'maintenance-action'
        AND NOT EXISTS (SELECT 1 FROM pm_next_repairs n WHERE n.repair_id = repairs.id)
    `).bind(id).run();
  } catch {
    // Preserve the original save error. Any linked repair is intentionally kept.
  }
}

export async function POST(request: Request) {
  let childRepairId = 0;
  try {
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const repair = await loadMaintenanceRepair(numericRepairId(body.repairId));
    requireWorkAccess(user, repair);
    if (String(repair.status).toLowerCase().includes('complete')) throw new Error('This maintenance work order is already completed.');
    await requireQuestionsAnswered(repair.id);

    const description = String(body.description ?? '').trim().slice(0, 500);
    if (!description) throw new Error('Describe the repair or condition you found.');
    const disposition = String(body.disposition ?? '');
    if (disposition !== 'now' && disposition !== 'next') throw new Error('Choose Repair Before Closing or Save as Future Repair.');
    const kind = eventType(repair.source);
    const repairStatus = disposition === 'now' ? 'New' : `Deferred to Next ${kind === 'annual' ? 'Annual' : 'PM'}`;

    const inserted = await env.DB.prepare(`
      INSERT INTO repairs (
        equipment_id, title, description, status, priority, source, technician_id,
        opened_at, updated_at
      ) VALUES (?, ?, ?, ?, '2', 'maintenance-action', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      repair.equipment_id,
      description,
      `Added during ${kind === 'annual' ? 'Annual inspection' : 'PM'} ${repair.id}: ${description}`.slice(0, 1000),
      repairStatus,
      disposition === 'now' ? repair.technician_id : null,
    ).run();
    childRepairId = Number(inserted.meta.last_row_id ?? 0);
    if (!childRepairId) throw new Error('The repair finding could not be created.');

    if (disposition === 'next') {
      await env.DB.prepare(`
        INSERT INTO pm_next_repairs (
          equipment_id, description, status, origin_repair_id, queued_from_repair_id,
          tagged_by_user_id, tagged_by_technician_id, tagged_at, updated_at,
          repair_id, target_event_type
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
      `).bind(
        repair.equipment_id,
        description,
        repair.id,
        repair.id,
        user.id,
        user.technicianId ?? null,
        childRepairId,
        kind,
      ).run();
    } else {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO pm_next_repairs (
          equipment_id, description, status, origin_repair_id, queued_from_repair_id,
          target_repair_id, tagged_by_user_id, tagged_by_technician_id,
          tagged_at, attached_at, updated_at, repair_id, target_event_type
        ) VALUES (?, ?, 'attached', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
      `).bind(
        repair.equipment_id,
        description,
        repair.id,
        repair.id,
        repair.id,
        user.id,
        user.technicianId ?? null,
        childRepairId,
        kind,
      ).run();
      await env.DB.prepare(`
        UPDATE pm_next_repairs
        SET origin_repair_id = ?, description = ?, tagged_by_user_id = ?,
            tagged_by_technician_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE repair_id = ? AND target_repair_id = ?
      `).bind(repair.id, description, user.id, user.technicianId ?? null, childRepairId, repair.id).run();
    }

    await env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      VALUES (?, ?, ?, 'maintenance_action_created', ?)
    `).bind(
      childRepairId,
      user.id,
      user.technicianId ?? null,
      disposition === 'now'
        ? `Added during the ${kind === 'annual' ? 'Annual' : 'PM'} and required before closing. Labor remains on the maintenance visit.`
        : `Saved as a Future Repair for the next ${kind === 'annual' ? 'Annual' : 'PM'}.`,
    ).run();

    return Response.json({ ok: true, repairId: `repair-${childRepairId}` });
  } catch (error) {
    if (childRepairId) await removeOrphanRepair(childRepairId);
    console.error(JSON.stringify({ event: 'maintenance_finding_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Maintenance finding could not be saved.' }, { status: 400 });
  }
}
