import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { markGeotabDefectRepaired } from '@/lib/geotab';
import { completeMaintenanceBoardItem, getMaintenanceBoardItems } from '@/lib/maintenance-board';

const STATUSES = new Set(['New', 'Assigned', 'Waiting for Parts', 'In Progress', 'Completed']);

type Technician = { id: number; name: string };

type DvirRow = {
  geotab_log_id: string;
  geotab_defect_id: string;
  asset_unit: string;
  driver: string;
  defect: string;
  comments: string;
  photos_url: string;
  location: string;
  equipment_type: string;
};

function repairNumber(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Repair was not found.');
  return id;
}

function maintenanceId(value: unknown) {
  const match = String(value ?? '').match(/^(pm|annual)-(\d+)$/);
  if (!match) throw new Error('Scheduled maintenance item was not found.');
  return { kind: match[1] as 'pm' | 'annual', equipmentId: Number(match[2]), id: `${match[1]}-${match[2]}` };
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

async function activeTechnician(idValue: unknown) {
  const id = Number(idValue ?? 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return env.DB.prepare('SELECT id, name FROM technicians WHERE id = ? AND active = 1')
    .bind(id)
    .first<Technician>();
}

async function equipmentIdForDvir(unitValue: string) {
  const unit = unitValue.trim();
  if (!unit) throw new Error('The DVIR does not have a unit number.');

  const existing = await env.DB.prepare(`
    SELECT id FROM equipment WHERE lower(trim(unit)) = lower(trim(?)) LIMIT 1
  `).bind(unit).first<{ id: number }>();
  if (existing) return existing.id;

  await env.DB.prepare(`
    INSERT INTO equipment (unit, category, equipment_type, active, updated_at)
    VALUES (?, 'fleet', 'other', 1, CURRENT_TIMESTAMP)
    ON CONFLICT(unit) DO UPDATE SET active = 1, updated_at = CURRENT_TIMESTAMP
  `).bind(unit).run();

  const created = await env.DB.prepare('SELECT id FROM equipment WHERE unit = ?').bind(unit).first<{ id: number }>();
  if (!created) throw new Error('The DVIR unit could not be added to equipment.');
  return created.id;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const [repairs, dvirDefects, technicians, maintenanceItems] = await Promise.all([
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
               COALESCE(r.source, 'manual') AS source,
               r.technician_id,
               COALESCE(t.name, '') AS technician_name,
               COALESCE(r.labor_hours, 0) AS labor_hours,
               COALESCE(e.equipment_type, 'other') AS equipment_type,
               r.equipment_id,
               r.geotab_defect_id,
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
        source: string;
        technician_id: number | null;
        technician_name: string;
        labor_hours: number;
        equipment_type: string;
        equipment_id: number | null;
        geotab_defect_id: string | null;
        timer_started_at: string | null;
        timer_technician: string;
      }>(),
      env.DB.prepare(`
        SELECT d.geotab_log_id,
               d.geotab_defect_id,
               d.asset_unit,
               COALESCE(d.driver, '') AS driver,
               d.defect,
               COALESCE(d.comments, '') AS comments,
               COALESCE(d.photos_url, '') AS photos_url,
               COALESCE(e.location, '') AS location,
               COALESCE(e.equipment_type, 'other') AS equipment_type
        FROM dvir_defects d
        LEFT JOIN equipment e ON lower(trim(e.unit)) = lower(trim(d.asset_unit))
        WHERE d.repaired = 0
          AND NOT EXISTS (
            SELECT 1 FROM repairs r WHERE r.geotab_defect_id = d.geotab_defect_id
          )
        ORDER BY d.updated_at DESC
      `).all<DvirRow>(),
      env.DB.prepare(`
        SELECT id, name
        FROM technicians
        WHERE active = 1
        ORDER BY name
      `).all<Technician>(),
      getMaintenanceBoardItems(env.DB),
    ]);

    const activeMaintenance = new Set<string>();
    const repairRows = repairs.results.map((row) => {
      let source: 'repair' | 'dvir-repair' | 'pm-repair' | 'annual-repair' = 'repair';
      if (row.source === 'scheduled-pm') {
        source = 'pm-repair';
        if (row.equipment_id) activeMaintenance.add(`pm-${row.equipment_id}`);
      } else if (row.source === 'scheduled-annual') {
        source = 'annual-repair';
        if (row.equipment_id) activeMaintenance.add(`annual-${row.equipment_id}`);
      } else if (row.geotab_defect_id) {
        source = 'dvir-repair';
      }

      return {
        id: `repair-${row.id}`,
        source,
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
        dvirDefectId: row.geotab_defect_id ?? '',
        dvirLogId: '',
        dvirComments: '',
        dvirPhotos: '',
        maintenanceId: source === 'pm-repair' && row.equipment_id
          ? `pm-${row.equipment_id}`
          : source === 'annual-repair' && row.equipment_id
            ? `annual-${row.equipment_id}`
            : '',
        activeTimer: row.timer_started_at ? {
          startedAt: row.timer_started_at,
          technician: row.timer_technician,
        } : null,
      };
    });

    const rawDvirRows = dvirDefects.results.map((row) => ({
      id: `dvir-${row.geotab_defect_id}`,
      source: 'dvir' as const,
      priority: 2,
      location: row.location,
      unit: row.asset_unit,
      driver: row.driver,
      issue: row.defect,
      parts: '',
      status: 'DVIR - Needs Repair',
      technicianId: null,
      assignedTo: '',
      laborHours: 0,
      equipmentType: row.equipment_type,
      dvirDefectId: row.geotab_defect_id,
      dvirLogId: row.geotab_log_id,
      dvirComments: row.comments,
      dvirPhotos: row.photos_url,
      maintenanceId: '',
      activeTimer: null,
    }));

    const maintenanceRows = maintenanceItems
      .filter((item) => !activeMaintenance.has(item.id))
      .map((item) => ({
        id: item.id,
        source: item.maintenanceKind,
        priority: item.status.toLowerCase().includes('overdue') ? 1 : 2,
        location: item.location,
        unit: item.unit,
        driver: item.driver,
        issue: item.issue,
        parts: '',
        status: item.status,
        technicianId: null,
        assignedTo: '',
        laborHours: 0,
        equipmentType: item.equipmentType,
        dvirDefectId: '',
        dvirLogId: '',
        dvirComments: '',
        dvirPhotos: '',
        maintenanceId: item.id,
        activeTimer: null,
      }));

    const rows = [...repairRows, ...rawDvirRows, ...maintenanceRows].sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      const leftScheduled = ['dvir', 'pm', 'annual'].includes(left.source) ? 0 : 1;
      const rightScheduled = ['dvir', 'pm', 'annual'].includes(right.source) ? 0 : 1;
      if (leftScheduled !== rightScheduled) return leftScheduled - rightScheduled;
      if (left.technicianId === null && right.technicianId !== null) return -1;
      if (right.technicianId === null && left.technicianId !== null) return 1;
      return left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: 'base' });
    });

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
        dvirOpen: rows.filter((row) => row.source === 'dvir' || row.source === 'dvir-repair').length,
        maintenanceDue: rows.filter((row) => ['pm', 'annual', 'pm-repair', 'annual-repair'].includes(row.source)).length,
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

    if (action === 'createDvirRepair') {
      const defectId = String(body.defectId ?? '').trim();
      if (!defectId) throw new Error('DVIR defect was not found.');

      const defect = await env.DB.prepare(`
        SELECT geotab_defect_id, asset_unit, COALESCE(driver, '') AS driver,
               defect, COALESCE(comments, '') AS comments
        FROM dvir_defects
        WHERE geotab_defect_id = ? AND repaired = 0
      `).bind(defectId).first<{
        geotab_defect_id: string;
        asset_unit: string;
        driver: string;
        defect: string;
        comments: string;
      }>();
      if (!defect) throw new Error('That DVIR is no longer open. Refresh the board.');

      const technician = await activeTechnician(body.technicianId);
      if (Number(body.technicianId ?? 0) > 0 && !technician) throw new Error('Technician was not found or is inactive.');

      const existing = await env.DB.prepare(`
        SELECT id FROM repairs WHERE geotab_defect_id = ? ORDER BY id DESC LIMIT 1
      `).bind(defectId).first<{ id: number }>();
      if (existing) {
        if (technician) {
          await env.DB.prepare(`
            UPDATE repairs SET technician_id = ?, status = CASE WHEN lower(status) = 'new' THEN 'Assigned' ELSE status END,
                               updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(technician.id, existing.id).run();
        }
        return Response.json({ ok: true, repairId: `repair-${existing.id}`, existing: true });
      }

      const equipmentId = await equipmentIdForDvir(defect.asset_unit);
      const status = technician ? 'Assigned' : 'New';
      const result = await env.DB.prepare(`
        INSERT INTO repairs (
          equipment_id, title, description, status, priority, source,
          geotab_defect_id, driver, technician_id, updated_at
        ) VALUES (?, ?, ?, ?, '2', 'geotab-dvir', ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        equipmentId,
        defect.defect,
        defect.comments,
        status,
        defect.geotab_defect_id,
        defect.driver,
        technician?.id ?? null,
      ).run();

      const id = Number(result.meta.last_row_id);
      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'dvir_added', ?)
      `).bind(
        id,
        user.id,
        technician?.id ?? null,
        technician
          ? `${user.displayName} added the DVIR to the repair list and assigned it to ${technician.name}.`
          : `${user.displayName} added the DVIR to the repair list.`,
      ).run();

      return Response.json({ ok: true, repairId: `repair-${id}`, technicianId: technician?.id ?? null });
    }

    if (action === 'markDvirRepaired') {
      const defectId = String(body.defectId ?? '').trim();
      let logId = String(body.logId ?? '').trim();
      if (!defectId) throw new Error('DVIR defect was not found.');
      if (!logId) {
        const row = await env.DB.prepare('SELECT geotab_log_id FROM dvir_defects WHERE geotab_defect_id = ?')
          .bind(defectId)
          .first<{ geotab_log_id: string }>();
        logId = row?.geotab_log_id ?? '';
      }
      if (!logId) throw new Error('The Geotab DVIR log could not be found.');
      const result = await markGeotabDefectRepaired(env, logId, defectId);
      return Response.json({ ok: true, ...result });
    }

    if (action === 'createMaintenanceRepair') {
      const maintenance = maintenanceId(body.maintenanceId ?? body.repairId);
      const dueItems = await getMaintenanceBoardItems(env.DB);
      const dueItem = dueItems.find((item) => item.id === maintenance.id);
      if (!dueItem) throw new Error('That PM or annual is no longer due. Refresh the board.');

      const technician = await activeTechnician(body.technicianId);
      if (Number(body.technicianId ?? 0) > 0 && !technician) throw new Error('Technician was not found or is inactive.');
      const source = maintenance.kind === 'pm' ? 'scheduled-pm' : 'scheduled-annual';

      const existing = await env.DB.prepare(`
        SELECT id FROM repairs
        WHERE equipment_id = ? AND source = ?
          AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
        ORDER BY id DESC LIMIT 1
      `).bind(maintenance.equipmentId, source).first<{ id: number }>();

      if (existing) {
        if (technician) {
          await env.DB.prepare(`
            UPDATE repairs
            SET technician_id = ?, status = CASE WHEN lower(status) = 'new' THEN 'Assigned' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(technician.id, existing.id).run();
        }
        return Response.json({ ok: true, repairId: `repair-${existing.id}`, existing: true });
      }

      const priority = dueItem.status.toLowerCase().includes('overdue') ? '1' : '2';
      const status = technician ? 'Assigned' : 'New';
      const result = await env.DB.prepare(`
        INSERT INTO repairs (
          equipment_id, title, description, status, priority, source,
          driver, location, technician_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        maintenance.equipmentId,
        dueItem.issue,
        `Scheduled ${maintenance.kind === 'pm' ? 'PM' : 'annual inspection'} generated from the Repair Board.`,
        status,
        priority,
        source,
        dueItem.driver,
        dueItem.location,
        technician?.id ?? null,
      ).run();

      const id = Number(result.meta.last_row_id);
      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'scheduled_maintenance_added', ?)
      `).bind(
        id,
        user.id,
        technician?.id ?? null,
        technician
          ? `${user.displayName} assigned the scheduled ${maintenance.kind.toUpperCase()} to ${technician.name}.`
          : `${user.displayName} added the scheduled ${maintenance.kind.toUpperCase()} to the repair list.`,
      ).run();

      return Response.json({ ok: true, repairId: `repair-${id}`, technicianId: technician?.id ?? null });
    }

    if (action === 'completeMaintenance') {
      const maintenance = maintenanceId(body.maintenanceId ?? body.repairId);
      const activeRepair = await env.DB.prepare(`
        SELECT id FROM repairs
        WHERE equipment_id = ? AND source = ?
          AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
        LIMIT 1
      `).bind(
        maintenance.equipmentId,
        maintenance.kind === 'pm' ? 'scheduled-pm' : 'scheduled-annual',
      ).first<{ id: number }>();
      if (activeRepair) throw new Error('This scheduled maintenance has an open work order. Complete that work order first.');
      const result = await completeMaintenanceBoardItem(env.DB, maintenance.id);
      if (!result) throw new Error('Scheduled maintenance item was not found.');
      return Response.json({ ok: true, ...result });
    }

    const id = repairNumber(body.repairId);
    const repair = await openRepairRow(id);

    if (action === 'assignTechnician') {
      const technician = await activeTechnician(body.technicianId);
      if (Number(body.technicianId ?? 0) > 0 && !technician) throw new Error('Technician was not found or is inactive.');

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
