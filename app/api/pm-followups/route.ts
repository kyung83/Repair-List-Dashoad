import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type OpenPmRepair = {
  id: number;
  equipment_id: number | null;
  technician_id: number | null;
  status: string;
  source: string;
  title: string;
  unit: string;
};

function positiveId(value: unknown, label: string) {
  const id = Number(value ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} was not found.`);
  return id;
}

function isManager(user: AppUser) {
  return user.role === 'manager' || user.role === 'admin';
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!isManager(user) && user.role !== 'mechanic') throw new Error('Technician, manager, or administrator access is required.');
  return user;
}

async function openPmRepair(id: number) {
  const row = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.status,'') AS status,
           COALESCE(r.source,'') AS source, COALESCE(r.title,'PM') AS title,
           COALESCE(e.unit,'') AS unit
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<OpenPmRepair>();
  if (!row) throw new Error('PM work order was not found.');
  if (row.source !== 'scheduled-pm') throw new Error('Next PM repairs can only be managed from a scheduled PM work order.');
  if (String(row.status).toLowerCase().includes('complete')) throw new Error('That PM work order is already completed.');
  if (!row.equipment_id) throw new Error('That PM is not linked to equipment.');
  return row;
}

async function requirePmAccess(user: AppUser, repairId: number) {
  const repair = await openPmRepair(repairId);
  if (!isManager(user)) {
    if (!user.technicianId || Number(repair.technician_id ?? 0) !== user.technicianId) {
      throw new Error('That PM work order is not assigned to you.');
    }
  }
  return repair;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const manager = isManager(user);
    const [equipmentRows, pmRows, followupRows] = await Promise.all([
      manager
        ? env.DB.prepare(`
            SELECT id, unit, COALESCE(equipment_type,'other') AS equipment_type,
                   COALESCE(location,'') AS location, COALESCE(driver,'') AS driver
            FROM equipment
            WHERE active = 1 AND trim(COALESCE(unit,'')) <> ''
            ORDER BY unit COLLATE NOCASE
          `).all<{ id:number; unit:string; equipment_type:string; location:string; driver:string }>()
        : Promise.resolve({ results: [] as { id:number; unit:string; equipment_type:string; location:string; driver:string }[] }),
      env.DB.prepare(`
        SELECT r.id, r.equipment_id, COALESCE(e.unit,'') AS unit, COALESCE(r.title,'PM') AS title,
               COALESCE(r.status,'') AS status, COALESCE(r.location,e.location,'') AS location,
               r.technician_id, COALESCE(t.name,'') AS technician_name
        FROM repairs r
        LEFT JOIN equipment e ON e.id = r.equipment_id
        LEFT JOIN technicians t ON t.id = r.technician_id
        WHERE r.source = 'scheduled-pm'
          AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
          AND (? = 1 OR r.technician_id = ?)
        ORDER BY e.unit COLLATE NOCASE, r.id DESC
      `).bind(manager ? 1 : 0, user.technicianId ?? -1).all<{
        id:number; equipment_id:number|null; unit:string; title:string; status:string; location:string;
        technician_id:number|null; technician_name:string;
      }>(),
      env.DB.prepare(`
        SELECT n.id, n.equipment_id, n.description, n.status, n.origin_repair_id,
               n.queued_from_repair_id, n.target_repair_id, n.tagged_at, n.defer_count,
               COALESCE(e.unit,'') AS unit, COALESCE(e.equipment_type,'other') AS equipment_type,
               COALESCE(e.location,'') AS location, COALESCE(t.name,'Technician') AS tagged_by,
               COALESCE(target.title,'') AS target_title, COALESCE(tt.name,'') AS target_technician
        FROM pm_next_repairs n
        JOIN equipment e ON e.id = n.equipment_id
        LEFT JOIN technicians t ON t.id = n.tagged_by_technician_id
        LEFT JOIN repairs target ON target.id = n.target_repair_id
        LEFT JOIN technicians tt ON tt.id = target.technician_id
        WHERE n.status IN ('pending','attached')
          AND COALESCE(n.target_event_type,'pm') = 'pm'
          AND (
            ? = 1
            OR n.target_repair_id IN (
              SELECT r.id FROM repairs r
              WHERE r.source = 'scheduled-pm'
                AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
                AND r.technician_id = ?
            )
            OR n.queued_from_repair_id IN (
              SELECT r.id FROM repairs r
              WHERE r.source = 'scheduled-pm'
                AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
                AND r.technician_id = ?
            )
          )
        ORDER BY e.unit COLLATE NOCASE, n.tagged_at, n.id
      `).bind(manager ? 1 : 0, user.technicianId ?? -1, user.technicianId ?? -1).all<{
        id:number; equipment_id:number; description:string; status:'pending'|'attached'; origin_repair_id:number|null;
        queued_from_repair_id:number|null; target_repair_id:number|null; tagged_at:string; defer_count:number;
        unit:string; equipment_type:string; location:string; tagged_by:string; target_title:string; target_technician:string;
      }>(),
    ]);

    return Response.json({
      user: { id:user.id, username:user.username, displayName:user.displayName, role:user.role, technicianId:user.technicianId },
      canManage: manager,
      equipment: equipmentRows.results.map((row) => ({
        id:row.id, unit:row.unit, equipmentType:row.equipment_type, location:row.location,
        driver:row.driver.includes('@') ? '' : row.driver,
      })),
      pmJobs: pmRows.results.map((row) => ({
        id:`repair-${row.id}`, equipmentId:row.equipment_id, unit:row.unit, title:row.title,
        status:row.status, location:row.location, technicianId:row.technician_id, assignedTo:row.technician_name,
      })),
      followups: followupRows.results.map((row) => ({
        id:row.id, equipmentId:row.equipment_id, unit:row.unit, equipmentType:row.equipment_type,
        location:row.location, description:row.description, status:row.status,
        originRepairId:row.origin_repair_id ? `repair-${row.origin_repair_id}` : null,
        queuedFromRepairId:row.queued_from_repair_id ? `repair-${row.queued_from_repair_id}` : null,
        targetRepairId:row.target_repair_id ? `repair-${row.target_repair_id}` : null,
        taggedAt:row.tagged_at, taggedBy:row.tagged_by, deferCount:Number(row.defer_count ?? 0),
        targetTitle:row.target_title, targetTechnician:row.target_technician,
      })),
      updatedAt:new Date().toISOString(),
    }, { headers: { 'cache-control':'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event:'pm_followups_get_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Next PM repairs could not be loaded.' }, { status:400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const manager = isManager(user);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');

    if (action === 'addNextPmRepair') {
      const description = String(body.description ?? '').trim().slice(0, 500);
      if (!description) throw new Error('Enter the repair or condition to address on the next PM.');

      let equipmentId = 0;
      let repairId: number | null = null;
      if (manager && Number(body.equipmentId ?? 0) > 0) {
        equipmentId = positiveId(body.equipmentId, 'Equipment');
        const equipment = await env.DB.prepare('SELECT id FROM equipment WHERE id = ? AND active = 1').bind(equipmentId).first<{id:number}>();
        if (!equipment) throw new Error('Equipment was not found or is inactive.');
      } else {
        repairId = positiveId(body.repairId, 'PM work order');
        const repair = await requirePmAccess(user, repairId);
        equipmentId = Number(repair.equipment_id);
      }

      const repairResult = await env.DB.prepare(`
        INSERT INTO repairs (
          equipment_id, title, description, status, priority, source, technician_id,
          opened_at, updated_at
        ) VALUES (?, ?, ?, 'Deferred to Next PM', '2', 'maintenance-action', NULL,
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        equipmentId,
        description,
        `Saved for next PM: ${description}`.slice(0, 1000),
      ).run();
      const childRepairId = Number(repairResult.meta.last_row_id);
      if (!childRepairId) throw new Error('The future repair record could not be created.');

      let queueId = 0;
      try {
        const result = await env.DB.prepare(`
          INSERT INTO pm_next_repairs (
            equipment_id, description, status, origin_repair_id, queued_from_repair_id,
            tagged_by_user_id, tagged_by_technician_id, tagged_at, updated_at,
            repair_id, target_event_type
          ) VALUES (?, ?, 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 'pm')
        `).bind(
          equipmentId,
          description,
          repairId,
          repairId,
          user.id,
          user.technicianId ?? null,
          childRepairId,
        ).run();
        queueId = Number(result.meta.last_row_id);
      } catch (error) {
        await env.DB.prepare(`
          DELETE FROM repairs
          WHERE id = ? AND source = 'maintenance-action' AND status = 'Deferred to Next PM'
        `).bind(childRepairId).run().catch(() => undefined);
        throw error;
      }

      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'next_pm_requested', ?)
      `).bind(
        childRepairId,
        user.id,
        user.technicianId ?? null,
        repairId
          ? `Saved during PM ${repairId} for the next PM.`
          : 'Added by office/manager for the next PM.',
      ).run().catch(() => undefined);

      return Response.json({ ok:true, id:queueId, repairId:`repair-${childRepairId}`, equipmentId, description });
    }

    if (action === 'completeNextPmRepair' || action === 'deferNextPmRepair') {
      const itemId = positiveId(body.itemId, 'Next PM repair');
      const item = await env.DB.prepare(`
        SELECT id, equipment_id, description, target_repair_id
        FROM pm_next_repairs
        WHERE id = ? AND status = 'attached' AND target_repair_id IS NOT NULL
      `).bind(itemId).first<{ id:number; equipment_id:number; description:string; target_repair_id:number }>();
      if (!item) throw new Error('That repair is no longer attached to an open PM.');
      await requirePmAccess(user, Number(item.target_repair_id));

      if (action === 'completeNextPmRepair') {
        await env.DB.prepare(`
          UPDATE pm_next_repairs
          SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
              completed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'attached'
        `).bind(user.id, itemId).run();
        return Response.json({ ok:true, itemId, completed:true, description:item.description });
      }

      await env.DB.prepare(`
        UPDATE pm_next_repairs
        SET status = 'pending', target_repair_id = NULL, attached_at = NULL,
            queued_from_repair_id = ?, defer_count = defer_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'attached'
      `).bind(item.target_repair_id, itemId).run();
      return Response.json({ ok:true, itemId, deferred:true, description:item.description });
    }

    if (action === 'cancelNextPmRepair') {
      const itemId = positiveId(body.itemId, 'Next PM repair');
      const item = await env.DB.prepare(`
        SELECT id, equipment_id, description, queued_from_repair_id
        FROM pm_next_repairs
        WHERE id = ? AND status = 'pending' AND target_repair_id IS NULL
      `).bind(itemId).first<{ id:number; equipment_id:number; description:string; queued_from_repair_id:number|null }>();
      if (!item) throw new Error('That queued repair is no longer waiting for a future PM.');
      if (!manager) {
        if (!item.queued_from_repair_id) throw new Error('Only a manager can remove a driver/office next-PM request.');
        await requirePmAccess(user, Number(item.queued_from_repair_id));
      }
      await env.DB.prepare(`
        UPDATE pm_next_repairs
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending' AND target_repair_id IS NULL
      `).bind(user.id, itemId).run();
      return Response.json({ ok:true, itemId, cancelled:true, description:item.description });
    }

    return Response.json({ error:'Unknown next-PM repair action.' }, { status:400 });
  } catch (error) {
    console.error(JSON.stringify({ event:'pm_followups_post_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Next PM repair change failed.' }, { status:400 });
  }
}
