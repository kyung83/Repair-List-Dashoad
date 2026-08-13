import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type EventType = 'pm' | 'annual';
type EquipmentRow = { id: number; unit: string; equipment_type: string; location: string; driver: string };
type FutureRow = {
  id: number;
  equipment_id: number;
  repair_id: number;
  description: string;
  status: 'pending' | 'attached';
  target_event_type: EventType;
  target_repair_id: number | null;
  tagged_at: string;
  unit: string;
  equipment_type: string;
  location: string;
  repair_status: string;
  target_title: string;
};
type PlannedPartRow = { id: number; action_id: number; part_id: number; part_number: string; description: string; quantity: number; used_quantity: number };
type PartRow = { id: number; part_number: string; description: string; quantity_on_hand: number };

function canManage(user: AppUser) {
  return user.role === 'manager' || user.role === 'admin';
}

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!canManage(user)) throw new Error('Manager or administrator access is required.');
  return user;
}

function positiveId(value: unknown, label: string) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} was not found.`);
  return id;
}

function targetType(value: unknown): EventType {
  if (value === 'pm' || value === 'annual') return value;
  throw new Error('Choose Next PM or Next Annual.');
}

async function loadData() {
  const [equipment, actions, plannedParts, parts] = await Promise.all([
    env.DB.prepare(`
      SELECT id, unit, COALESCE(equipment_type,'other') AS equipment_type,
             COALESCE(location,'') AS location, COALESCE(driver,'') AS driver
      FROM equipment
      WHERE active = 1 AND trim(COALESCE(unit,'')) <> ''
      ORDER BY unit COLLATE NOCASE
    `).all<EquipmentRow>(),
    env.DB.prepare(`
      SELECT n.id, n.equipment_id, n.repair_id, n.description, n.status,
             COALESCE(n.target_event_type,'pm') AS target_event_type,
             n.target_repair_id, n.tagged_at,
             COALESCE(e.unit,'') AS unit, COALESCE(e.equipment_type,'other') AS equipment_type,
             COALESCE(e.location,'') AS location, COALESCE(r.status,'') AS repair_status,
             COALESCE(target.title,'') AS target_title
      FROM pm_next_repairs n
      JOIN equipment e ON e.id = n.equipment_id
      JOIN repairs r ON r.id = n.repair_id
      LEFT JOIN repairs target ON target.id = n.target_repair_id
      WHERE n.status IN ('pending','attached') AND n.repair_id IS NOT NULL
      ORDER BY e.unit COLLATE NOCASE, n.tagged_at, n.id
    `).all<FutureRow>(),
    env.DB.prepare(`
      SELECT rpp.id, n.id AS action_id, rpp.part_id, p.part_number, p.description,
             rpp.quantity, rpp.used_quantity
      FROM pm_next_repairs n
      JOIN repair_planned_parts rpp ON rpp.repair_id = n.repair_id
      JOIN parts p ON p.id = rpp.part_id
      WHERE n.status IN ('pending','attached') AND n.repair_id IS NOT NULL AND rpp.removed_at IS NULL
      ORDER BY n.id, rpp.id
    `).all<PlannedPartRow>(),
    env.DB.prepare(`
      SELECT id, part_number, description, quantity_on_hand
      FROM parts WHERE active = 1
      ORDER BY description COLLATE NOCASE, part_number COLLATE NOCASE
    `).all<PartRow>(),
  ]);

  const partsByAction = new Map<number, PlannedPartRow[]>();
  for (const part of plannedParts.results) {
    const list = partsByAction.get(part.action_id) ?? [];
    list.push(part);
    partsByAction.set(part.action_id, list);
  }

  return {
    equipment: equipment.results.map((row) => ({
      id: row.id, unit: row.unit, equipmentType: row.equipment_type, location: row.location,
      driver: row.driver.includes('@') ? '' : row.driver,
    })),
    futureRepairs: actions.results.map((row) => ({
      id: row.id, equipmentId: row.equipment_id, repairId: `repair-${row.repair_id}`,
      description: row.description, queueStatus: row.status, repairStatus: row.repair_status,
      targetEventType: row.target_event_type,
      targetRepairId: row.target_repair_id ? `repair-${row.target_repair_id}` : null,
      targetTitle: row.target_title, taggedAt: row.tagged_at, unit: row.unit,
      equipmentType: row.equipment_type, location: row.location,
      plannedParts: (partsByAction.get(row.id) ?? []).map((part) => ({
        id: part.id, partId: part.part_id, partNumber: part.part_number,
        description: part.description, quantity: Number(part.quantity), usedQuantity: Number(part.used_quantity),
      })),
    })),
    parts: parts.results.map((row) => ({
      id: row.id, partNumber: row.part_number, description: row.description,
      quantityOnHand: Number(row.quantity_on_hand),
    })),
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireManager(request);
    return Response.json({ user: { displayName: user.displayName, role: user.role }, ...(await loadData()) }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Future repairs could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireManager(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');

    if (action === 'createFutureRepair') {
      const equipmentId = positiveId(body.equipmentId, 'Equipment');
      const event = targetType(body.targetEventType);
      const description = String(body.description ?? '').trim().slice(0, 500);
      if (!description) throw new Error('Enter what needs to be repaired.');
      const equipment = await env.DB.prepare('SELECT id FROM equipment WHERE id = ? AND active = 1').bind(equipmentId).first<{ id: number }>();
      if (!equipment) throw new Error('Equipment was not found or is inactive.');

      const label = event === 'annual' ? 'Annual' : 'PM';
      const repairResult = await env.DB.prepare(`
        INSERT INTO repairs (
          equipment_id, title, description, status, priority, source, technician_id,
          opened_at, updated_at
        ) VALUES (?, ?, ?, ?, '2', 'maintenance-action', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        equipmentId,
        description,
        `Office/driver future repair for next ${label}: ${description}`.slice(0, 1000),
        `Deferred to Next ${label}`,
      ).run();
      const repairId = Number(repairResult.meta.last_row_id);
      if (!repairId) throw new Error('The future repair record could not be created.');

      try {
        await env.DB.prepare(`
          INSERT INTO pm_next_repairs (
            equipment_id, description, status, origin_repair_id, queued_from_repair_id,
            tagged_by_user_id, tagged_by_technician_id, tagged_at, updated_at,
            repair_id, target_event_type
          ) VALUES (?, ?, 'pending', NULL, NULL, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
        `).bind(equipmentId, description, user.id, repairId, event).run();
      } catch (error) {
        await env.DB.prepare(`
          UPDATE repairs
          SET status = 'Completed - Cancelled Future Work', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND source = 'maintenance-action'
        `).bind(repairId).run().catch(() => undefined);
        throw error;
      }

      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, NULL, 'future_repair_requested', ?)
      `).bind(repairId, user.id, `Added by office for the next ${label}.`).run().catch(() => undefined);
      return Response.json({ ok: true, ...(await loadData()) });
    }

    if (action === 'cancelFutureRepair') {
      const itemId = positiveId(body.itemId, 'Future repair');
      const result = await env.DB.prepare(`
        UPDATE pm_next_repairs
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending' AND target_repair_id IS NULL
      `).bind(user.id, itemId).run();
      if (!Number(result.meta.changes ?? 0)) throw new Error('Only a future repair that is still waiting can be removed.');
      return Response.json({ ok: true, ...(await loadData()) });
    }

    if (action === 'planPart') {
      const itemId = positiveId(body.itemId, 'Future repair');
      const partId = positiveId(body.partId, 'Part');
      const quantity = Number(body.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a positive planned quantity.');
      const link = await env.DB.prepare(`
        SELECT n.repair_id
        FROM pm_next_repairs n
        JOIN repairs r ON r.id = n.repair_id
        WHERE n.id = ? AND n.status IN ('pending','attached') AND n.repair_id IS NOT NULL
          AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      `).bind(itemId).first<{ repair_id: number }>();
      if (!link) throw new Error('That future repair is no longer available for parts planning.');
      const part = await env.DB.prepare('SELECT id FROM parts WHERE id = ? AND active = 1').bind(partId).first<{ id: number }>();
      if (!part) throw new Error('That inventory part is not active.');
      await env.DB.prepare(`
        INSERT INTO repair_planned_parts (
          repair_id, part_id, pm_kit_id, quantity, used_quantity,
          removed_at, removed_by_user_id, updated_at
        ) VALUES (?, ?, NULL, ?, 0, NULL, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT(repair_id, part_id) DO UPDATE SET
          quantity = excluded.quantity, removed_at = NULL,
          removed_by_user_id = NULL, updated_at = CURRENT_TIMESTAMP
      `).bind(link.repair_id, partId, quantity).run();
      return Response.json({ ok: true, ...(await loadData()) });
    }

    if (action === 'removePlannedPart') {
      const itemId = positiveId(body.itemId, 'Future repair');
      const plannedPartId = positiveId(body.plannedPartId, 'Planned part');
      const row = await env.DB.prepare(`
        SELECT rpp.id, rpp.repair_id, rpp.used_quantity
        FROM pm_next_repairs n
        JOIN repair_planned_parts rpp ON rpp.repair_id = n.repair_id
        WHERE n.id = ? AND n.status IN ('pending','attached')
          AND rpp.id = ? AND rpp.removed_at IS NULL
      `).bind(itemId, plannedPartId).first<{ id: number; repair_id: number; used_quantity: number }>();
      if (!row) throw new Error('That planned part is no longer attached to this future repair.');
      if (Number(row.used_quantity) > 0) throw new Error('A used part cannot be removed from the repair record.');
      await env.DB.prepare(`
        UPDATE repair_planned_parts
        SET removed_at = CURRENT_TIMESTAMP, removed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND repair_id = ? AND removed_at IS NULL
      `).bind(user.id, row.id, row.repair_id).run();
      return Response.json({ ok: true, ...(await loadData()) });
    }

    return Response.json({ error: 'Unknown future repair action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'future_repair_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Future repair action failed.' }, { status: 400 });
  }
}
