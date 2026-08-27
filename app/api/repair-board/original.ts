import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { markGeotabDefectRepaired } from '@/lib/geotab';
import { completeMaintenanceBoardItem, getMaintenanceBoardItems } from '@/lib/maintenance-board';

const STATUSES = new Set(['New', 'Assigned', 'Waiting for Parts', 'In Progress', 'Completed']);
type Technician = { id: number; name: string };
type OosEquipment = {
  id: number;
  unit: string;
  equipment_type: string;
  driver: string;
  location: string;
  out_of_service_reason: string;
  out_of_service_at: string | null;
};
type EquipmentOption = {
  id: number;
  unit: string;
  equipment_type: string;
  driver: string;
  location: string;
};
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
  equipment_id: number | null;
  out_of_service: number;
  out_of_service_reason: string;
  out_of_service_at: string | null;
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

function normalizedUnit(value: string) {
  return value.trim().toLowerCase().replace(/[\s\-()]/g, '');
}

function safeEquipmentType(value: unknown) {
  const type = String(value ?? 'other').trim().toLowerCase();
  if (type === 'truck' || type === 'trailer') return type;
  return 'other';
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

function requireManager(user: AppUser) {
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required for this change.');
}

async function openRepairRow(id: number) {
  const repair = await env.DB.prepare('SELECT id, equipment_id, technician_id, status, COALESCE(source,\'manual\') AS source FROM repairs WHERE id = ?')
    .bind(id).first<{ id: number; equipment_id: number | null; technician_id: number | null; status: string; source: string }>();
  if (!repair) throw new Error('Repair was not found.');
  if (String(repair.status ?? '').toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  return repair;
}

async function activeTechnician(idValue: unknown) {
  const id = Number(idValue ?? 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return env.DB.prepare('SELECT id, name FROM technicians WHERE id = ? AND active = 1').bind(id).first<Technician>();
}

async function equipmentIdForUnit(unitValue: string, equipmentTypeValue: unknown = 'other', locationValue = '') {
  const unit = unitValue.trim();
  if (!unit) throw new Error('A unit number is required.');
  const key = normalizedUnit(unit);
  const equipmentType = safeEquipmentType(equipmentTypeValue);
  const location = String(locationValue ?? '').trim();
  const existing = await env.DB.prepare(`
    SELECT id
    FROM equipment
    WHERE lower(replace(replace(replace(replace(trim(unit), ' ', ''), '-', ''), '(', ''), ')', '')) = ?
    ORDER BY active DESC, id
    LIMIT 1
  `).bind(key).first<{ id: number }>();
  if (existing) {
    await env.DB.prepare(`
      UPDATE equipment
      SET active = 1,
          equipment_type = CASE WHEN lower(COALESCE(equipment_type,'other')) = 'other' AND ? <> 'other' THEN ? ELSE equipment_type END,
          location = CASE WHEN trim(COALESCE(location,'')) = '' AND ? <> '' THEN ? ELSE location END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(equipmentType, equipmentType, location, location, existing.id).run();
    return existing.id;
  }
  await env.DB.prepare(`
    INSERT INTO equipment (unit, category, equipment_type, location, active, updated_at)
    VALUES (?, 'fleet', ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(unit) DO UPDATE SET active = 1, updated_at = CURRENT_TIMESTAMP
  `).bind(unit, equipmentType, location).run();
  const created = await env.DB.prepare('SELECT id FROM equipment WHERE unit = ?').bind(unit).first<{ id: number }>();
  if (!created) throw new Error('The unit could not be added to equipment.');
  return created.id;
}

async function resolveEquipmentId(body: Record<string, unknown>) {
  const explicit = Number(body.equipmentId ?? 0);
  if (Number.isInteger(explicit) && explicit > 0) {
    const row = await env.DB.prepare('SELECT id FROM equipment WHERE id = ? AND active = 1').bind(explicit).first<{ id: number }>();
    if (!row) throw new Error('Unit was not found or is inactive.');
    return row.id;
  }
  return equipmentIdForUnit(String(body.unit ?? ''), body.equipmentType, String(body.location ?? ''));
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const [repairs, dvirDefects, technicians, maintenanceItems, oosEquipment, equipmentOptions] = await Promise.all([
      env.DB.prepare(`
        SELECT r.id,
               CASE WHEN lower(trim(COALESCE(r.priority, ''))) IN ('1','high','urgent','critical') THEN 1
                    WHEN lower(trim(COALESCE(r.priority, ''))) IN ('3','low') THEN 3 ELSE 2 END AS priority,
               COALESCE(NULLIF(r.location,''), NULLIF(e.location,''), '') AS location,
               COALESCE(e.unit,'') AS unit,
               COALESCE(NULLIF(e.driver,''), NULLIF(r.driver,''), '') AS driver,
               r.title, COALESCE(r.parts_text,'') AS parts_text,
               COALESCE(r.status,'New') AS status, COALESCE(r.source,'manual') AS source,
               r.technician_id, COALESCE(t.name,'') AS technician_name,
               COALESCE(r.labor_hours,0) AS labor_hours, COALESCE(e.equipment_type,'other') AS equipment_type,
               r.equipment_id, r.geotab_defect_id,
               COALESCE(e.out_of_service,0) AS out_of_service,
               COALESCE(e.out_of_service_reason,'') AS out_of_service_reason,
               e.out_of_service_at,
               rt.started_at AS timer_started_at, COALESCE(tt.name,'') AS timer_technician
        FROM repairs r
        LEFT JOIN equipment e ON e.id = r.equipment_id
        LEFT JOIN technicians t ON t.id = r.technician_id
        LEFT JOIN repair_labor_timers rt ON rt.repair_id = r.id
        LEFT JOIN technicians tt ON tt.id = rt.technician_id
        WHERE lower(COALESCE(r.status,'')) NOT LIKE '%complete%' AND COALESCE(r.source,'') <> 'roadside-breakdown'
        ORDER BY COALESCE(e.unit,''), r.id DESC
      `).all<{
        id:number; priority:number; location:string; unit:string; driver:string; title:string; parts_text:string;
        status:string; source:string; technician_id:number|null; technician_name:string; labor_hours:number;
        equipment_type:string; equipment_id:number|null; geotab_defect_id:string|null; out_of_service:number;
        out_of_service_reason:string; out_of_service_at:string|null; timer_started_at:string|null; timer_technician:string;
      }>(),
      env.DB.prepare(`
        SELECT d.geotab_log_id, d.geotab_defect_id, d.asset_unit,
               COALESCE(d.driver,'') AS driver, d.defect, COALESCE(d.comments,'') AS comments,
               COALESCE(d.photos_url,'') AS photos_url, COALESCE(e.location,'') AS location,
               COALESCE(e.equipment_type,'other') AS equipment_type, e.id AS equipment_id,
               COALESCE(e.out_of_service,0) AS out_of_service,
               COALESCE(e.out_of_service_reason,'') AS out_of_service_reason, e.out_of_service_at
        FROM dvir_defects d
        LEFT JOIN equipment e ON lower(trim(e.unit)) = lower(trim(d.asset_unit))
        WHERE d.repaired = 0
          AND NOT EXISTS (SELECT 1 FROM repairs r WHERE r.geotab_defect_id = d.geotab_defect_id)
        ORDER BY d.asset_unit, d.updated_at DESC
      `).all<DvirRow>(),
      env.DB.prepare('SELECT id, name FROM technicians WHERE active = 1 ORDER BY name').all<Technician>(),
      getMaintenanceBoardItems(env.DB),
      env.DB.prepare(`
        SELECT id, unit, COALESCE(equipment_type,'other') AS equipment_type,
               COALESCE(driver,'') AS driver, COALESCE(location,'') AS location,
               COALESCE(out_of_service_reason,'') AS out_of_service_reason, out_of_service_at
        FROM equipment
        WHERE active = 1 AND out_of_service = 1
        ORDER BY unit
      `).all<OosEquipment>(),
      env.DB.prepare(`
        SELECT id, unit, COALESCE(equipment_type,'other') AS equipment_type,
               COALESCE(driver,'') AS driver, COALESCE(location,'') AS location
        FROM equipment
        WHERE active = 1 AND trim(COALESCE(unit,'')) <> ''
        ORDER BY unit COLLATE NOCASE
      `).all<EquipmentOption>(),
    ]);

    const oosByEquipment = new Map(oosEquipment.results.map((item) => [item.id, item]));
    const activeMaintenance = new Set<string>();
    const repairRows = repairs.results.map((row) => {
      let source: 'repair'|'dvir-repair'|'pm-repair'|'annual-repair' = 'repair';
      if (row.source === 'scheduled-pm') { source = 'pm-repair'; if (row.equipment_id) activeMaintenance.add(`pm-${row.equipment_id}`); }
      else if (row.source === 'scheduled-annual') { source = 'annual-repair'; if (row.equipment_id) activeMaintenance.add(`annual-${row.equipment_id}`); }
      else if (row.geotab_defect_id) source = 'dvir-repair';
      return {
        id:`repair-${row.id}`, source, priority:Number(row.priority ?? 2), location:row.location, unit:row.unit,
        driver:row.driver, issue:row.title, parts:row.parts_text, status:row.status,
        technicianId:row.technician_id === null ? null : Number(row.technician_id), assignedTo:row.technician_name,
        laborHours:Number(row.labor_hours ?? 0), equipmentType:row.equipment_type,
        equipmentId:row.equipment_id === null ? null : Number(row.equipment_id),
        outOfService:Boolean(row.out_of_service), oosReason:row.out_of_service_reason, oosAt:row.out_of_service_at,
        dvirDefectId:row.geotab_defect_id ?? '', dvirLogId:'', dvirComments:'', dvirPhotos:'',
        maintenanceId:source === 'pm-repair' && row.equipment_id ? `pm-${row.equipment_id}` : source === 'annual-repair' && row.equipment_id ? `annual-${row.equipment_id}` : '',
        activeTimer:row.timer_started_at ? { startedAt:row.timer_started_at, technician:row.timer_technician } : null,
      };
    });

    const rawDvirRows = dvirDefects.results.map((row) => ({
      id:`dvir-${row.geotab_defect_id}`, source:'dvir' as const, priority:2, location:row.location, unit:row.asset_unit,
      driver:row.driver, issue:row.defect, parts:'', status:'DVIR - Needs Repair', technicianId:null, assignedTo:'', laborHours:0,
      equipmentType:row.equipment_type, equipmentId:row.equipment_id === null ? null : Number(row.equipment_id),
      outOfService:Boolean(row.out_of_service), oosReason:row.out_of_service_reason, oosAt:row.out_of_service_at,
      dvirDefectId:row.geotab_defect_id, dvirLogId:row.geotab_log_id, dvirComments:row.comments, dvirPhotos:row.photos_url,
      maintenanceId:'', activeTimer:null,
    }));

    const maintenanceRows = maintenanceItems.filter((item) => !activeMaintenance.has(item.id)).map((item) => {
      const parsed = maintenanceId(item.id);
      const oos = oosByEquipment.get(parsed.equipmentId);
      return {
        id:item.id, source:item.maintenanceKind, priority:item.status.toLowerCase().includes('overdue') ? 1 : 2,
        location:item.location, unit:item.unit, driver:item.driver, issue:item.issue, parts:'', status:item.status,
        technicianId:null, assignedTo:'', laborHours:0, equipmentType:item.equipmentType, equipmentId:parsed.equipmentId,
        outOfService:Boolean(oos), oosReason:oos?.out_of_service_reason ?? '', oosAt:oos?.out_of_service_at ?? null,
        dvirDefectId:'', dvirLogId:'', dvirComments:'', dvirPhotos:'', maintenanceId:item.id, activeTimer:null,
      };
    });

    const rows = [...repairRows, ...rawDvirRows, ...maintenanceRows].sort((a,b) => a.unit.localeCompare(b.unit, undefined, { numeric:true, sensitivity:'base' }) || a.issue.localeCompare(b.issue));
    const oosUnits = oosEquipment.results.map((item) => ({
      equipmentId:item.id, unit:item.unit, equipmentType:item.equipment_type, driver:item.driver, location:item.location,
      reason:item.out_of_service_reason, since:item.out_of_service_at,
      openWork:rows.filter((row) => row.equipmentId === item.id).map((row) => ({ id:row.id, source:row.source, issue:row.issue, assignedTo:row.assignedTo, status:row.status })),
    }));

    return Response.json({
      user:{ id:user.id, username:user.username, displayName:user.displayName, role:user.role, technicianId:user.technicianId },
      canManage:user.role === 'manager' || user.role === 'admin',
      technicians:technicians.results.map((technician) => ({ id:technician.id, name:technician.name })),
      equipment:equipmentOptions.results.map((item) => ({ id:item.id, unit:item.unit, equipmentType:item.equipment_type, driver:item.driver, location:item.location })),
      repairs:rows, oosUnits,
      summary:{
        total:rows.length, oos:oosUnits.length,
        trucks:rows.filter((row) => !row.outOfService && /truck|tractor|vehicle/i.test(row.equipmentType)).length,
        trailers:rows.filter((row) => !row.outOfService && /trailer/i.test(row.equipmentType)).length,
        dvirOpen:rows.filter((row) => row.source === 'dvir' || row.source === 'dvir-repair').length,
        maintenanceDue:rows.filter((row) => ['pm','annual','pm-repair','annual-repair'].includes(row.source)).length,
        unassigned:rows.filter((row) => row.technicianId === null).length,
        activeLabor:rows.filter((row) => row.activeTimer !== null).length,
      },
      updatedAt:new Date().toISOString(),
    }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event:'repair_board_get_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Repair board could not be loaded.' }, { status:400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requireManager(user);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');

    if (action === 'createRepair') {
      const mode = String(body.mode ?? 'equipment') === 'freeform' ? 'freeform' : 'equipment';
      const issue = String(body.issue ?? '').trim();
      const parts = String(body.parts ?? '').trim();
      const priority = Number(body.priority ?? 2);
      if (!issue) throw new Error('Enter the repair needed.');
      if (![1,2,3].includes(priority)) throw new Error('Priority must be 1, 2, or 3.');
      let equipmentId = 0;
      if (mode === 'equipment') {
        equipmentId = await resolveEquipmentId({ equipmentId: body.equipmentId });
      } else {
        equipmentId = await equipmentIdForUnit(String(body.unit ?? ''), body.equipmentType, String(body.location ?? ''));
      }
      const equipment = await env.DB.prepare(`SELECT id, unit, COALESCE(location,'') AS location FROM equipment WHERE id = ? AND active = 1`)
        .bind(equipmentId).first<{ id:number; unit:string; location:string }>();
      if (!equipment) throw new Error('Equipment was not found or is inactive.');
      const technician = await activeTechnician(body.technicianId);
      if (Number(body.technicianId ?? 0) > 0 && !technician) throw new Error('Technician was not found or is inactive.');
      const status = technician ? 'Assigned' : 'New';
      const location = mode === 'freeform' ? String(body.location ?? '').trim() : '';
      const result = await env.DB.prepare(`
        INSERT INTO repairs (equipment_id,title,parts_text,status,priority,source,location,technician_id,updated_at)
        VALUES (?,?,?,?,?,'manual',?,?,CURRENT_TIMESTAMP)
      `).bind(equipmentId, issue, parts, status, String(priority), location, technician?.id ?? null).run();
      const id = Number(result.meta.last_row_id);
      await env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,'repair_created',?)`)
        .bind(id, user.id, technician?.id ?? null, technician ? `${user.displayName} created this repair for Unit ${equipment.unit} and assigned it to ${technician.name}.` : `${user.displayName} created this repair for Unit ${equipment.unit}.`).run();
      return Response.json({ ok:true, repairId:`repair-${id}`, equipmentId, unit:equipment.unit, technicianId:technician?.id ?? null });
    }

    if (action === 'setUnitOos') {
      const equipmentId = await resolveEquipmentId(body);
      const outOfService = Boolean(body.outOfService);
      const reason = String(body.reason ?? '').trim().slice(0, 500);
      if (outOfService && !reason) throw new Error('Enter a reason before placing the unit out of service.');
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE equipment
          SET out_of_service = ?,
              out_of_service_reason = CASE WHEN ? = 1 THEN ? ELSE NULL END,
              out_of_service_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
              out_of_service_by_user_id = CASE WHEN ? = 1 THEN ? ELSE NULL END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(outOfService ? 1 : 0, outOfService ? 1 : 0, reason, outOfService ? 1 : 0, outOfService ? 1 : 0, user.id, equipmentId),
        env.DB.prepare(`
          INSERT INTO equipment_status_events (equipment_id, user_id, out_of_service, reason)
          VALUES (?, ?, ?, ?)
        `).bind(equipmentId, user.id, outOfService ? 1 : 0, outOfService ? reason : (reason || 'Returned to service')),
      ]);
      return Response.json({ ok:true, equipmentId, outOfService });
    }

    if (action === 'createDvirRepair') {
      const defectId = String(body.defectId ?? '').trim();
      if (!defectId) throw new Error('DVIR defect was not found.');
      const defect = await env.DB.prepare(`
        SELECT geotab_defect_id, asset_unit, COALESCE(driver,'') AS driver, defect, COALESCE(comments,'') AS comments
        FROM dvir_defects WHERE geotab_defect_id = ? AND repaired = 0
      `).bind(defectId).first<{ geotab_defect_id:string; asset_unit:string; driver:string; defect:string; comments:string }>();
      if (!defect) throw new Error('That DVIR is no longer open. Refresh the board.');
      const technician = await activeTechnician(body.technicianId);
      if (Number(body.technicianId ?? 0) > 0 && !technician) throw new Error('Technician was not found or is inactive.');
      const existing = await env.DB.prepare('SELECT id FROM repairs WHERE geotab_defect_id = ? ORDER BY id DESC LIMIT 1').bind(defectId).first<{ id:number }>();
      if (existing) {
        if (technician) await env.DB.prepare(`UPDATE repairs SET technician_id = ?, status = CASE WHEN lower(status) = 'new' THEN 'Assigned' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(technician.id, existing.id).run();
        return Response.json({ ok:true, repairId:`repair-${existing.id}`, existing:true });
      }
      const equipmentId = await equipmentIdForUnit(defect.asset_unit);
      const status = technician ? 'Assigned' : 'New';
      const result = await env.DB.prepare(`
        INSERT INTO repairs (equipment_id,title,description,status,priority,source,geotab_defect_id,driver,technician_id,updated_at)
        VALUES (?,?,?,?, '2','geotab-dvir',?,?,?,CURRENT_TIMESTAMP)
      `).bind(equipmentId, defect.defect, defect.comments, status, defect.geotab_defect_id, defect.driver, technician?.id ?? null).run();
      const id = Number(result.meta.last_row_id);
      await env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,'dvir_added',?)`)
        .bind(id, user.id, technician?.id ?? null, technician ? `${user.displayName} added the DVIR and assigned it to ${technician.name}.` : `${user.displayName} added the DVIR to the repair list.`).run();
      return Response.json({ ok:true, repairId:`repair-${id}`, technicianId:technician?.id ?? null });
    }

    if (action === 'markDvirRepaired') {
      const defectId = String(body.defectId ?? '').trim();
      let logId = String(body.logId ?? '').trim();
      if (!defectId) throw new Error('DVIR defect was not found.');
      if (!logId) logId = (await env.DB.prepare('SELECT geotab_log_id FROM dvir_defects WHERE geotab_defect_id = ?').bind(defectId).first<{ geotab_log_id:string }>())?.geotab_log_id ?? '';
      if (!logId) throw new Error('The Geotab DVIR log could not be found.');
      const result = await markGeotabDefectRepaired(env, logId, defectId);
      return Response.json({ ok:true, ...result });
    }

    if (action === 'createMaintenanceRepair') {
      const maintenance = maintenanceId(body.maintenanceId ?? body.repairId);
      const dueItem = (await getMaintenanceBoardItems(env.DB)).find((item) => item.id === maintenance.id);
      if (!dueItem) throw new Error('That PM or annual is no longer due. Refresh the board.');
      const technician = await activeTechnician(body.technicianId);
      if (Number(body.technicianId ?? 0) > 0 && !technician) throw new Error('Technician was not found or is inactive.');
      const source = maintenance.kind === 'pm' ? 'scheduled-pm' : 'scheduled-annual';
      const existing = await env.DB.prepare(`
        SELECT id FROM repairs WHERE equipment_id = ? AND source = ? AND lower(COALESCE(status,'')) NOT LIKE '%complete%' ORDER BY id DESC LIMIT 1
      `).bind(maintenance.equipmentId, source).first<{ id:number }>();
      if (existing) {
        if (technician) await env.DB.prepare(`UPDATE repairs SET technician_id = ?, status = CASE WHEN lower(status) = 'new' THEN 'Assigned' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(technician.id, existing.id).run();
        return Response.json({ ok:true, repairId:`repair-${existing.id}`, existing:true });
      }
      const priority = dueItem.status.toLowerCase().includes('overdue') ? '1' : '2';
      const status = technician ? 'Assigned' : 'New';
      const result = await env.DB.prepare(`
        INSERT INTO repairs (equipment_id,title,description,status,priority,source,driver,location,technician_id,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      `).bind(maintenance.equipmentId, dueItem.issue, `Scheduled ${maintenance.kind === 'pm' ? 'PM' : 'annual inspection'} generated from the Repair Board.`, status, priority, source, dueItem.driver, dueItem.location, technician?.id ?? null).run();
      const id = Number(result.meta.last_row_id);
      await env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,'scheduled_maintenance_added',?)`)
        .bind(id, user.id, technician?.id ?? null, technician ? `${user.displayName} assigned the scheduled ${maintenance.kind.toUpperCase()} to ${technician.name}.` : `${user.displayName} added the scheduled ${maintenance.kind.toUpperCase()} to the repair list.`).run();
      return Response.json({ ok:true, repairId:`repair-${id}`, technicianId:technician?.id ?? null });
    }

    if (action === 'completeMaintenance') {
      const maintenance = maintenanceId(body.maintenanceId ?? body.repairId);
      const activeRepair = await env.DB.prepare(`SELECT id FROM repairs WHERE equipment_id = ? AND source = ? AND lower(COALESCE(status,'')) NOT LIKE '%complete%' LIMIT 1`)
        .bind(maintenance.equipmentId, maintenance.kind === 'pm' ? 'scheduled-pm' : 'scheduled-annual').first<{ id:number }>();
      if (activeRepair) throw new Error('This scheduled maintenance has an open work order. Complete that work order first.');
      const result = await completeMaintenanceBoardItem(env.DB, maintenance.id);
      if (!result) throw new Error('Scheduled maintenance item was not found.');
      return Response.json({ ok:true, ...result });
    }

    const id = repairNumber(body.repairId);
    const repair = await openRepairRow(id);

    if (action === 'moveRepairToEquipment') {
      if (repair.source !== 'manual') throw new Error('Only manual repairs can be moved to a different unit.');
      const equipmentId = await resolveEquipmentId({ equipmentId: body.equipmentId });
      if (equipmentId === repair.equipment_id) return Response.json({ ok:true, repairId:`repair-${id}`, equipmentId });
      const activeTimer = await env.DB.prepare('SELECT user_id FROM repair_labor_timers WHERE repair_id = ?').bind(id).first<{ user_id:number }>();
      if (activeTimer) throw new Error('Stop active labor before moving this repair to another unit.');
      const equipment = await env.DB.prepare('SELECT unit FROM equipment WHERE id = ?').bind(equipmentId).first<{ unit:string }>();
      if (!equipment) throw new Error('Equipment was not found.');
      await env.DB.batch([
        env.DB.prepare(`UPDATE repairs SET equipment_id = ?, location = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(equipmentId, id),
        env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,'equipment_changed',?)`).bind(id, user.id, repair.technician_id, `${user.displayName} moved the repair to Unit ${equipment.unit}.`),
      ]);
      return Response.json({ ok:true, repairId:`repair-${id}`, equipmentId, unit:equipment.unit });
    }

    if (action === 'assignTechnician') {
      const technician = await activeTechnician(body.technicianId);
      if (Number(body.technicianId ?? 0) > 0 && !technician) throw new Error('Technician was not found or is inactive.');
      const activeTimer = await env.DB.prepare('SELECT technician_id FROM repair_labor_timers WHERE repair_id = ?').bind(id).first<{ technician_id:number }>();
      if (activeTimer && Number(activeTimer.technician_id) !== Number(technician?.id ?? 0)) throw new Error('This repair has active labor. Stop the running timer before reassigning it.');
      const nextStatus = technician ? (String(repair.status).toLowerCase() === 'new' ? 'Assigned' : repair.status) : (String(repair.status).toLowerCase() === 'assigned' ? 'New' : repair.status);
      await env.DB.batch([
        env.DB.prepare('UPDATE repairs SET technician_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(technician?.id ?? null, nextStatus, id),
        env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,?,?)`).bind(id, user.id, technician?.id ?? null, technician ? 'assigned' : 'unassigned', technician ? `${user.displayName} assigned the repair to ${technician.name}.` : `${user.displayName} moved the repair back to the unassigned queue.`),
      ]);
      return Response.json({ ok:true, repairId:`repair-${id}`, technicianId:technician?.id ?? null, status:nextStatus });
    }

    if (action === 'setPriority') {
      const priority = Number(body.priority);
      if (![1,2,3].includes(priority)) throw new Error('Priority must be 1, 2, or 3.');
      await env.DB.batch([
        env.DB.prepare('UPDATE repairs SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(String(priority), id),
        env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,'priority_changed',?)`).bind(id, user.id, repair.technician_id, `${user.displayName} changed priority to ${priority}.`),
      ]);
      return Response.json({ ok:true, repairId:`repair-${id}`, priority });
    }

    if (action === 'setStatus') {
      const status = String(body.status ?? '').trim();
      if (!STATUSES.has(status)) throw new Error('Choose a valid repair status.');
      if (status === 'Completed' && await env.DB.prepare('SELECT user_id FROM repair_labor_timers WHERE repair_id = ?').bind(id).first()) throw new Error('Stop active labor before completing this repair.');
      await env.DB.batch([
        env.DB.prepare(`UPDATE repairs SET status = ?, completed_at = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, status, id),
        env.DB.prepare(`INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,'status_changed',?)`).bind(id, user.id, repair.technician_id, `${user.displayName} changed status to ${status}.`),
      ]);
      return Response.json({ ok:true, repairId:`repair-${id}`, status });
    }

    return Response.json({ error:'Unknown repair-board action.' }, { status:400 });
  } catch (error) {
    console.error(JSON.stringify({ event:'repair_board_post_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Repair-board change failed.' }, { status:400 });
  }
}
