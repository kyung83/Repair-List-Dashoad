import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { usePartOnRepair } from '@/lib/inventory-db';

type ParentRepair = {
  id: number;
  equipment_id: number;
  technician_id: number | null;
  source: string;
  status: string;
};
type ChildRepair = {
  id: number;
  equipment_id: number | null;
  technician_id: number | null;
  status: string;
  title: string;
  maintenance_checklist_item_id: number | null;
  checklist_parent_id: number | null;
  action_parent_id: number | null;
};

function repairId(value: unknown, label: string) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} was not found.`);
  return id;
}

function canManage(user: AppUser) {
  return user.role === 'manager' || user.role === 'admin';
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

async function loadParent(id: number) {
  const row = await env.DB.prepare(`
    SELECT id, equipment_id, technician_id, COALESCE(source,'') AS source, COALESCE(status,'') AS status
    FROM repairs WHERE id = ?
  `).bind(id).first<ParentRepair>();
  if (!row || !['scheduled-pm', 'scheduled-annual'].includes(row.source)) throw new Error('PM/Annual work order was not found.');
  if (String(row.status).toLowerCase().includes('complete')) throw new Error('This PM/Annual is already completed.');
  return row;
}

function requireParentAccess(user: AppUser, parent: ParentRepair) {
  if (canManage(user)) return;
  if (user.role !== 'mechanic' || !user.technicianId || Number(parent.technician_id ?? 0) !== Number(user.technicianId)) {
    throw new Error('This PM/Annual is not assigned to you.');
  }
}

async function loadChild(parent: ParentRepair, childId: number) {
  const row = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.status,'') AS status,
           COALESCE(r.title,'') AS title, r.maintenance_checklist_item_id,
           (
             SELECT c.repair_id
             FROM maintenance_checklist_items i
             JOIN maintenance_checklist_runs c ON c.id = i.checklist_run_id
             WHERE i.id = r.maintenance_checklist_item_id
             LIMIT 1
           ) AS checklist_parent_id,
           (
             SELECT n.target_repair_id
             FROM pm_next_repairs n
             WHERE n.repair_id = r.id
               AND n.target_repair_id = ?
               AND n.status = 'attached'
             ORDER BY n.id DESC
             LIMIT 1
           ) AS action_parent_id
    FROM repairs r
    WHERE r.id = ?
  `).bind(parent.id, childId).first<ChildRepair>();
  if (!row || Number(row.equipment_id ?? 0) !== Number(parent.equipment_id)) throw new Error('That repair is not part of this PM/Annual.');
  const linked = Number(row.checklist_parent_id ?? 0) === parent.id || Number(row.action_parent_id ?? 0) === parent.id;
  if (!linked) throw new Error('That repair is not part of this PM/Annual.');
  return row;
}

async function ensureChildAssignment(user: AppUser, parent: ParentRepair, child: ChildRepair) {
  if (canManage(user)) return;
  const technicianId = Number(user.technicianId ?? 0);
  if (child.technician_id == null) {
    await env.DB.prepare('UPDATE repairs SET technician_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND technician_id IS NULL')
      .bind(technicianId, child.id).run();
    child.technician_id = technicianId;
    return;
  }
  if (Number(child.technician_id) !== technicianId || Number(parent.technician_id ?? 0) !== technicianId) {
    throw new Error('That repair is assigned to another technician.');
  }
}

async function refreshRepairPartsText(id: number) {
  const rows = await env.DB.prepare(`
    SELECT p.part_number, SUM(rp.quantity) AS quantity
    FROM repair_parts rp
    JOIN parts p ON p.id = rp.part_id
    WHERE rp.repair_id = ?
    GROUP BY p.id, p.part_number
    ORDER BY p.part_number
  `).bind(id).all<{ part_number: string; quantity: number }>();
  const text = rows.results.map((row) => `${row.part_number} x${Number(row.quantity)}`).join(', ');
  await env.DB.prepare('UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(text, id).run();
}

async function recordEvent(childId: number, user: AppUser, action: string, detail: string) {
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
    VALUES (?, ?, ?, ?, ?)
  `).bind(childId, user.id, user.technicianId ?? null, action, detail.slice(0, 500)).run();
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const parent = await loadParent(repairId(body.repairId, 'PM/Annual work order'));
    requireParentAccess(user, parent);
    const child = await loadChild(parent, repairId(body.childRepairId, 'Repair'));
    await ensureChildAssignment(user, parent, child);
    const action = String(body.action ?? '');

    if (action === 'usePart') {
      if (String(child.status).toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
      const partId = Number(body.partId ?? 0);
      const quantity = Number(body.quantity ?? 0);
      if (!Number.isInteger(partId) || partId <= 0) throw new Error('Choose a part.');
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a positive part quantity.');
      const part = await env.DB.prepare('SELECT part_number, description FROM parts WHERE id = ? AND active = 1')
        .bind(partId).first<{ part_number: string; description: string }>();
      if (!part) throw new Error('Part was not found.');
      await usePartOnRepair(env.DB, { repairId: `repair-${child.id}`, partId, quantity });
      await refreshRepairPartsText(child.id);
      await recordEvent(child.id, user, 'part_used_under_maintenance_labor', `Used ${quantity} x ${part.part_number} — ${part.description}. PM/Annual labor continued on repair #${parent.id}.`);
      return Response.json({ ok: true, childRepairId: `repair-${child.id}`, maintenanceLaborContinues: true });
    }

    if (action === 'complete') {
      if (!String(child.status).toLowerCase().includes('complete')) {
        const result = await env.DB.prepare(`
          UPDATE repairs
          SET status = 'Completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
        `).bind(child.id).run();
        if (Number(result.meta.changes ?? 0) === 0) throw new Error('Repair could not be completed.');
        await recordEvent(child.id, user, 'completed_under_maintenance_labor', `Repair completed while PM/Annual labor continued on repair #${parent.id}.`);
      }
      let checklistItemPassed = false;
      if (child.maintenance_checklist_item_id && Number(child.checklist_parent_id ?? 0) === parent.id) {
        const passed = await env.DB.prepare(`
          UPDATE maintenance_checklist_items
          SET result = 'pass', updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND result = 'fail'
        `).bind(user.id, child.maintenance_checklist_item_id).run();
        checklistItemPassed = Number(passed.meta.changes ?? 0) > 0;
      }
      return Response.json({ ok: true, childRepairId: `repair-${child.id}`, completed: true, checklistItemPassed, maintenanceLaborContinues: true });
    }

    return Response.json({ error: 'Unknown PM/Annual repair action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_subrepair_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'PM/Annual repair action failed.' }, { status: 400 });
  }
}
