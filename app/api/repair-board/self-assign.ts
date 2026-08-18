import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { getMaintenanceBoardItems } from '@/lib/maintenance-board';
import { normalizeYard, yardLabel } from '@/lib/yards';

type Technician = { id:number; name:string };

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
}

function completed(status: unknown) {
  return String(status ?? '').toLowerCase().includes('complete');
}

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function maintenanceBoardId(value: unknown) {
  const match = String(value ?? '').match(/^(pm|annual)-(\d+)$/);
  return match ? { kind:match[1] as 'pm'|'annual', equipmentId:Number(match[2]), id:`${match[1]}-${match[2]}` } : null;
}

async function linkedTechnician(user: AppUser) {
  if (!['mechanic','manager','admin'].includes(user.role)) throw new Error('This account cannot claim repair work.');
  if (!user.technicianId) throw new Error('Your login is not linked to a technician record. Ask an administrator to enable Works on repairs.');
  const technician = await env.DB.prepare(`SELECT id, name FROM technicians WHERE id = ? AND active = 1`)
    .bind(user.technicianId).first<Technician>();
  if (!technician) throw new Error('Your linked technician record is not active.');
  return technician;
}

async function enforceClaimYard(user: AppUser, equipmentId: number|null, fallbackLocation = '') {
  // Admins retain global operational access. Mechanics and working managers claim
  // unassigned work only from their configured working yard. Already-assigned work
  // remains available through Shop Jobs even when a unit later moves yards.
  if (user.role !== 'mechanic' && user.role !== 'manager') return;
  const account = await env.DB.prepare(`SELECT COALESCE(yard,'') AS yard FROM app_users WHERE id = ?`)
    .bind(user.id).first<{yard:string}>();
  const assigned = normalizeYard(account?.yard);
  if (!assigned) throw new Error('Your account needs a yard assignment before you can claim unassigned work.');

  const equipment = equipmentId ? await env.DB.prepare(`
    SELECT COALESCE(current_yard,'') AS current_yard, COALESCE(location,'') AS location
    FROM equipment WHERE id = ? AND active = 1
  `).bind(equipmentId).first<{current_yard:string;location:string}>() : null;
  const workYard = normalizeYard(equipment?.current_yard)
    || normalizeYard(equipment?.location)
    || normalizeYard(fallbackLocation);
  if (!workYard) throw new Error('This work does not have a yard assignment yet. Ask a manager to place the unit before claiming it.');
  if (workYard !== assigned) throw new Error(`This work is in the ${yardLabel(workYard)} yard. You can only claim work in your assigned ${yardLabel(assigned)} yard.`);
}

async function claimExistingRepair(user: AppUser, technician: Technician, id: number) {
  const repair = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.status,'') AS status,
           COALESCE(NULLIF(r.location,''), NULLIF(e.current_yard,''), NULLIF(e.location,''), '') AS location
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<{id:number;equipment_id:number|null;technician_id:number|null;status:string;location:string}>();
  if (!repair) throw new Error('Repair was not found.');
  if (completed(repair.status)) throw new Error('That repair is already completed.');
  if (deferred(repair.status)) throw new Error('That repair is intentionally saved for its next PM/Annual.');
  await enforceClaimYard(user, repair.equipment_id, repair.location);

  if (repair.technician_id !== null) {
    if (Number(repair.technician_id) === technician.id) return { ok:true, repairId:`repair-${id}`, technicianId:technician.id, existing:true };
    throw new Error('That repair is already assigned to another technician.');
  }
  const timer = await env.DB.prepare(`SELECT technician_id FROM repair_labor_timers WHERE repair_id = ?`)
    .bind(id).first<{technician_id:number}>();
  if (timer && Number(timer.technician_id) !== technician.id) throw new Error('Another technician already has labor running on that repair.');

  const result = await env.DB.prepare(`
    UPDATE repairs
    SET technician_id = ?,
        status = CASE WHEN lower(trim(COALESCE(status,''))) = 'new' THEN 'Assigned' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND technician_id IS NULL
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
  `).bind(technician.id,id).run();
  if (Number(result.meta.changes ?? 0) === 0) {
    const latest = await env.DB.prepare(`SELECT technician_id FROM repairs WHERE id = ?`)
      .bind(id).first<{technician_id:number|null}>();
    if (Number(latest?.technician_id ?? 0) === technician.id) return { ok:true, repairId:`repair-${id}`, technicianId:technician.id, existing:true };
    throw new Error('Someone else assigned that repair first. Refresh the board.');
  }
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'self_assigned',?)
  `).bind(id,user.id,technician.id,`${technician.name} claimed this repair from the Repair Board.`).run();
  return { ok:true, repairId:`repair-${id}`, technicianId:technician.id };
}

async function claimDvir(user: AppUser, technician: Technician, value: string) {
  const defectId = value.startsWith('dvir-') ? value.slice(5) : value;
  if (!defectId) throw new Error('DVIR defect was not found.');
  const existing = await env.DB.prepare(`SELECT id FROM repairs WHERE geotab_defect_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(defectId).first<{id:number}>();
  if (existing) return claimExistingRepair(user,technician,existing.id);

  const defect = await env.DB.prepare(`
    SELECT d.geotab_defect_id, d.asset_unit, COALESCE(d.driver,'') AS driver,
           d.defect, COALESCE(d.comments,'') AS comments, e.id AS equipment_id,
           COALESCE(e.current_yard,'') AS current_yard, COALESCE(e.location,'') AS equipment_location
    FROM dvir_defects d
    LEFT JOIN equipment e
      ON lower(trim(e.unit)) = lower(trim(d.asset_unit))
     AND e.active = 1
     AND e.merged_into_equipment_id IS NULL
    WHERE d.geotab_defect_id = ? AND d.repaired = 0
    ORDER BY e.id
    LIMIT 1
  `).bind(defectId).first<{
    geotab_defect_id:string;asset_unit:string;driver:string;defect:string;comments:string;
    equipment_id:number|null;current_yard:string;equipment_location:string;
  }>();
  if (!defect) throw new Error('That DVIR is no longer open. Refresh the board.');
  if (!defect.equipment_id) throw new Error('This DVIR is not linked to an active Equipment record yet. Ask a manager to link/create the job before claiming it.');
  await enforceClaimYard(user,defect.equipment_id,defect.current_yard||defect.equipment_location);

  const inserted = await env.DB.prepare(`
    INSERT INTO repairs (equipment_id,title,description,status,priority,source,geotab_defect_id,driver,technician_id,updated_at)
    SELECT ?,?,?, 'Assigned','2','geotab-dvir',?,?,?,CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM repairs WHERE geotab_defect_id = ?)
  `).bind(defect.equipment_id,defect.defect,defect.comments,defect.geotab_defect_id,defect.driver,technician.id,defect.geotab_defect_id).run();
  const row = await env.DB.prepare(`SELECT id FROM repairs WHERE geotab_defect_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(defectId).first<{id:number}>();
  if (!row) throw new Error('DVIR repair could not be created.');
  if (Number(inserted.meta.changes ?? 0) === 0) return claimExistingRepair(user,technician,row.id);
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'dvir_self_assigned',?)
  `).bind(row.id,user.id,technician.id,`${technician.name} created and claimed this DVIR from the Repair Board.`).run();
  return { ok:true, repairId:`repair-${row.id}`, technicianId:technician.id, created:true };
}

async function claimMaintenance(user: AppUser, technician: Technician, value: string) {
  const maintenance = maintenanceBoardId(value);
  if (!maintenance) throw new Error('Scheduled maintenance item was not found.');
  const dueItem = (await getMaintenanceBoardItems(env.DB)).find((item) => item.id === maintenance.id);
  if (!dueItem) throw new Error('That PM or annual is no longer due. Refresh the board.');
  await enforceClaimYard(user,maintenance.equipmentId,dueItem.location);
  const source = maintenance.kind === 'pm' ? 'scheduled-pm' : 'scheduled-annual';

  const existing = await env.DB.prepare(`
    SELECT id FROM repairs
    WHERE equipment_id = ? AND source = ?
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    ORDER BY id DESC LIMIT 1
  `).bind(maintenance.equipmentId,source).first<{id:number}>();
  if (existing) return claimExistingRepair(user,technician,existing.id);

  const priority = dueItem.status.toLowerCase().includes('overdue') ? '1' : '2';
  // Keep existence test and insertion in one SQLite statement so a second claim
  // sees the first open work order instead of intentionally creating another one.
  const inserted = await env.DB.prepare(`
    INSERT INTO repairs (equipment_id,title,description,status,priority,source,driver,location,technician_id,updated_at)
    SELECT ?,?,?, 'Assigned',?,?,?,?,?,CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1 FROM repairs
      WHERE equipment_id = ? AND source = ?
        AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    )
  `).bind(
    maintenance.equipmentId,
    dueItem.issue,
    `Scheduled ${maintenance.kind === 'pm' ? 'PM' : 'annual inspection'} claimed from the Repair Board.`,
    priority,
    source,
    dueItem.driver,
    dueItem.location,
    technician.id,
    maintenance.equipmentId,
    source,
  ).run();
  const row = await env.DB.prepare(`
    SELECT id FROM repairs
    WHERE equipment_id = ? AND source = ?
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    ORDER BY id DESC LIMIT 1
  `).bind(maintenance.equipmentId,source).first<{id:number}>();
  if (!row) throw new Error('Scheduled maintenance repair could not be created.');
  if (Number(inserted.meta.changes ?? 0) === 0) return claimExistingRepair(user,technician,row.id);

  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'scheduled_maintenance_self_assigned',?)
  `).bind(row.id,user.id,technician.id,`${technician.name} claimed the scheduled ${maintenance.kind.toUpperCase()} from the Repair Board.`).run();
  return { ok:true, repairId:`repair-${row.id}`, technicianId:technician.id, created:true };
}

export async function assignToMeFromBoard(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB,request);
  if (!user) throw new Error('Authentication required.');
  const technician = await linkedTechnician(user);
  const value = String(body.repairId ?? body.id ?? '').trim();
  const repairId = numericRepairId(value);
  if (repairId) return claimExistingRepair(user,technician,repairId);
  if (value.startsWith('dvir-')) return claimDvir(user,technician,value);
  if (maintenanceBoardId(value)) return claimMaintenance(user,technician,value);
  throw new Error('That Repair Board item cannot be claimed. Refresh the board and try again.');
}
