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

type ActionRow = {
  id: number;
  repair_id: number;
  description: string;
  status: string;
  target_event_type: EventType;
  target_repair_id: number | null;
  tagged_at: string;
  repair_status: string;
  technician_id: number | null;
};

type PlannedPartRow = {
  id: number;
  action_id: number;
  part_id: number;
  part_number: string;
  description: string;
  quantity: number;
  used_quantity: number;
};

function maintenanceRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Maintenance work order was not found.');
  return id;
}

function positiveId(value: unknown, label: string) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} was not found.`);
  return id;
}

function eventType(source: string): EventType {
  if (source === 'scheduled-pm') return 'pm';
  if (source === 'scheduled-annual') return 'annual';
  throw new Error('Maintenance actions are only available from a scheduled PM or Annual.');
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

async function checklistIsAtFinalStep(repairId: number) {
  const row = await env.DB.prepare(`
    SELECT c.id,
           SUM(CASE WHEN i.result = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN i.result = 'fail' THEN 1 ELSE 0 END) AS failed,
           COALESCE(c.status,'') AS status
    FROM maintenance_checklist_runs c
    JOIN maintenance_checklist_items i ON i.checklist_run_id = c.id
    WHERE c.repair_id = ?
    GROUP BY c.id, c.status
  `).bind(repairId).first<{ id: number; pending: number | null; failed: number | null; status: string }>();
  if (!row) throw new Error('Start and complete the inspection checklist before adding end-of-inspection action items.');
  if (row.status === 'completed') throw new Error('Completed inspections cannot be changed.');
  if (Number(row.pending ?? 0) > 0 || Number(row.failed ?? 0) > 0) {
    throw new Error('Finish the checklist and correct every failed inspection item before adding final action items.');
  }
}

async function detailFor(repair: MaintenanceRepair) {
  const [actions, plannedParts, required] = await Promise.all([
    env.DB.prepare(`
      SELECT n.id, n.repair_id, n.description, n.status, n.target_event_type,
             n.target_repair_id, n.tagged_at, COALESCE(r.status,'') AS repair_status,
             r.technician_id
      FROM pm_next_repairs n
      JOIN repairs r ON r.id = n.repair_id
      WHERE n.origin_repair_id = ?
        AND n.repair_id IS NOT NULL
        AND n.tagged_by_user_id IS NOT NULL
        AND n.status <> 'cancelled'
      ORDER BY n.id
    `).bind(repair.id).all<ActionRow>(),
    env.DB.prepare(`
      SELECT rpp.id, n.id AS action_id, rpp.part_id, p.part_number, p.description,
             rpp.quantity, rpp.used_quantity
      FROM pm_next_repairs n
      JOIN repair_planned_parts rpp ON rpp.repair_id = n.repair_id
      JOIN parts p ON p.id = rpp.part_id
      WHERE n.origin_repair_id = ?
        AND n.repair_id IS NOT NULL
        AND rpp.removed_at IS NULL
      ORDER BY n.id, rpp.id
    `).bind(repair.id).all<PlannedPartRow>(),
    env.DB.prepare(`
      SELECT DISTINCT r.id, r.title, COALESCE(r.status,'') AS status
      FROM pm_next_repairs n
      JOIN repairs r ON r.id = n.repair_id
      WHERE n.target_repair_id = ?
        AND n.repair_id IS NOT NULL
        AND n.status <> 'cancelled'
        AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      ORDER BY r.id
    `).bind(repair.id).all<{ id: number; title: string; status: string }>(),
  ]);

  const partsByAction = new Map<number, PlannedPartRow[]>();
  for (const part of plannedParts.results) {
    const list = partsByAction.get(part.action_id) ?? [];
    list.push(part);
    partsByAction.set(part.action_id, list);
  }

  return {
    repairId: `repair-${repair.id}`,
    equipmentId: repair.equipment_id,
    unit: repair.unit,
    eventType: eventType(repair.source),
    actionItems: actions.results.map((action) => ({
      id: action.id,
      repairId: `repair-${action.repair_id}`,
      description: action.description,
      queueStatus: action.status,
      repairStatus: action.repair_status,
      targetEventType: action.target_event_type,
      disposition: action.target_repair_id === repair.id ? 'now' : 'next',
      taggedAt: action.tagged_at,
      plannedParts: (partsByAction.get(action.id) ?? []).map((part) => ({
        id: part.id,
        partId: part.part_id,
        partNumber: part.part_number,
        description: part.description,
        quantity: Number(part.quantity),
        usedQuantity: Number(part.used_quantity),
      })),
    })),
    requiredRepairs: required.results.map((row) => ({
      repairId: `repair-${row.id}`,
      title: row.title,
      status: row.status,
    })),
  };
}

async function futureActions(equipmentId?: number) {
  const filter = equipmentId && equipmentId > 0 ? 'AND n.equipment_id = ?' : '';
  const statement = env.DB.prepare(`
    SELECT n.id, n.equipment_id, n.repair_id, n.description, n.target_event_type,
           n.tagged_at, COALESCE(e.unit,'') AS unit, COALESCE(e.location,'') AS location,
           COALESCE(r.status,'') AS repair_status,
           COALESCE((
             SELECT COUNT(*) FROM repair_planned_parts rpp
             WHERE rpp.repair_id = n.repair_id AND rpp.removed_at IS NULL
           ),0) AS planned_part_count
    FROM pm_next_repairs n
    JOIN repairs r ON r.id = n.repair_id
    JOIN equipment e ON e.id = n.equipment_id
    WHERE n.status = 'pending'
      AND n.target_repair_id IS NULL
      AND n.repair_id IS NOT NULL
      ${filter}
    ORDER BY e.unit COLLATE NOCASE, n.tagged_at, n.id
  `);
  const result = equipmentId && equipmentId > 0
    ? await statement.bind(equipmentId).all<{
        id:number; equipment_id:number; repair_id:number; description:string; target_event_type:EventType;
        tagged_at:string; unit:string; location:string; repair_status:string; planned_part_count:number;
      }>()
    : await statement.all<{
        id:number; equipment_id:number; repair_id:number; description:string; target_event_type:EventType;
        tagged_at:string; unit:string; location:string; repair_status:string; planned_part_count:number;
      }>();

  return result.results.map((row) => ({
    id: row.id,
    equipmentId: row.equipment_id,
    repairId: `repair-${row.repair_id}`,
    unit: row.unit,
    location: row.location,
    description: row.description,
    targetEventType: row.target_event_type,
    repairStatus: row.repair_status,
    taggedAt: row.tagged_at,
    plannedPartCount: Number(row.planned_part_count ?? 0),
  }));
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const requestedRepair = url.searchParams.get('repairId');
    if (requestedRepair) {
      const repair = await loadMaintenanceRepair(maintenanceRepairId(requestedRepair));
      return Response.json(await detailFor(repair), { headers: { 'cache-control': 'no-store' } });
    }
    const equipmentId = Number(url.searchParams.get('equipmentId') ?? 0);
    return Response.json({ actions: await futureActions(Number.isInteger(equipmentId) && equipmentId > 0 ? equipmentId : undefined) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Maintenance actions could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const repair = await loadMaintenanceRepair(maintenanceRepairId(body.repairId));
    requireWorkAccess(user, repair);

    if (String(repair.status).toLowerCase().includes('complete')) {
      throw new Error('This maintenance work order is already completed.');
    }

    if (action === 'createActionItem') {
      await checklistIsAtFinalStep(repair.id);
      const description = String(body.description ?? '').trim().slice(0, 500);
      if (!description) throw new Error('Describe the repair or condition you found.');
      const disposition = String(body.disposition ?? '');
      if (disposition !== 'now' && disposition !== 'next') throw new Error('Choose Repair Before Closing or Save for Next Service.');
      const kind = eventType(repair.source);
      const repairStatus = disposition === 'now'
        ? 'New'
        : `Deferred to Next ${kind === 'annual' ? 'Annual' : 'PM'}`;
      const result = await env.DB.prepare(`
        INSERT INTO repairs (
          equipment_id, title, description, status, priority, source, technician_id,
          opened_at, updated_at
        ) VALUES (?, ?, ?, ?, '2', 'maintenance-action', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        repair.equipment_id,
        description,
        `Added at the end of ${kind === 'annual' ? 'Annual inspection' : 'PM'} ${repair.id}: ${description}`.slice(0, 1000),
        repairStatus,
        disposition === 'now' ? repair.technician_id : null,
      ).run();
      const childRepairId = Number(result.meta.last_row_id);
      if (!childRepairId) throw new Error('The repair action could not be created.');

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
          ? `Added at the end of the ${kind === 'annual' ? 'Annual' : 'PM'} and required before closing.`
          : `Saved for the next ${kind === 'annual' ? 'Annual' : 'PM'}.`,
      ).run();

      return Response.json({ ok: true, ...(await detailFor(repair)) });
    }

    if (action === 'planPart') {
      const actionItemId = positiveId(body.actionItemId, 'Maintenance action');
      const partId = positiveId(body.partId, 'Part');
      const quantity = Number(body.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a positive planned quantity.');
      const link = await env.DB.prepare(`
        SELECT n.repair_id
        FROM pm_next_repairs n
        JOIN repairs r ON r.id = n.repair_id
        WHERE n.id = ? AND n.origin_repair_id = ? AND n.repair_id IS NOT NULL
          AND n.status <> 'cancelled'
          AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      `).bind(actionItemId, repair.id).first<{ repair_id: number }>();
      if (!link) throw new Error('That maintenance action is no longer available for parts planning.');
      const part = await env.DB.prepare('SELECT id FROM parts WHERE id = ? AND active = 1').bind(partId).first<{ id:number }>();
      if (!part) throw new Error('That inventory part is not active.');
      await env.DB.prepare(`
        INSERT INTO repair_planned_parts (repair_id, part_id, pm_kit_id, quantity, used_quantity, removed_at, removed_by_user_id, updated_at)
        VALUES (?, ?, NULL, ?, 0, NULL, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT(repair_id, part_id) DO UPDATE SET
          quantity = excluded.quantity,
          removed_at = NULL,
          removed_by_user_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      `).bind(link.repair_id, partId, quantity).run();
      return Response.json({ ok: true, ...(await detailFor(repair)) });
    }

    if (action === 'removePlannedPart') {
      const actionItemId = positiveId(body.actionItemId, 'Maintenance action');
      const plannedPartId = positiveId(body.plannedPartId, 'Planned part');
      const row = await env.DB.prepare(`
        SELECT rpp.id, rpp.repair_id, rpp.used_quantity
        FROM pm_next_repairs n
        JOIN repair_planned_parts rpp ON rpp.repair_id = n.repair_id
        WHERE n.id = ? AND n.origin_repair_id = ?
          AND rpp.id = ? AND rpp.removed_at IS NULL
      `).bind(actionItemId, repair.id, plannedPartId).first<{ id:number; repair_id:number; used_quantity:number }>();
      if (!row) throw new Error('That planned part is no longer on this action item.');
      if (Number(row.used_quantity) > 0) throw new Error('A used part cannot be removed from the repair record.');
      await env.DB.prepare(`
        UPDATE repair_planned_parts
        SET removed_at = CURRENT_TIMESTAMP, removed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND repair_id = ? AND removed_at IS NULL
      `).bind(user.id, row.id, row.repair_id).run();
      return Response.json({ ok: true, ...(await detailFor(repair)) });
    }

    if (action === 'cancelFutureAction') {
      const actionItemId = positiveId(body.actionItemId, 'Maintenance action');
      const result = await env.DB.prepare(`
        UPDATE pm_next_repairs
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND origin_repair_id = ?
          AND status = 'pending' AND target_repair_id IS NULL
      `).bind(user.id, actionItemId, repair.id).run();
      if (!Number(result.meta.changes ?? 0)) throw new Error('Only a future service item that is still waiting can be removed.');
      return Response.json({ ok: true, ...(await detailFor(repair)) });
    }

    return Response.json({ error: 'Unknown maintenance action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Maintenance action failed.' }, { status: 400 });
  }
}
