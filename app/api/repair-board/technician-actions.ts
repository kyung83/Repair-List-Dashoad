import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { normalizeYard, yardLabel } from '@/lib/yards';

type Technician = { id:number; name:string };
type Equipment = {
  id:number;
  unit:string;
  current_yard:string;
  location:string;
  out_of_service:number;
};

async function linkedTechnician(user: AppUser) {
  if (!['mechanic','manager','admin'].includes(user.role)) throw new Error('This account cannot perform technician Repair Board actions.');
  if (!user.technicianId) throw new Error('Your login is not linked to a technician record. Ask an administrator to enable Works on repairs.');
  const technician = await env.DB.prepare(`SELECT id, name FROM technicians WHERE id = ? AND active = 1`)
    .bind(user.technicianId).first<Technician>();
  if (!technician) throw new Error('Your linked technician record is not active.');
  return technician;
}

async function loadEquipment(equipmentIdValue: unknown) {
  const equipmentId = Number(equipmentIdValue ?? 0);
  if (!Number.isInteger(equipmentId) || equipmentId <= 0) throw new Error('Choose an active unit.');
  const equipment = await env.DB.prepare(`
    SELECT id, unit, COALESCE(current_yard,'') AS current_yard,
           COALESCE(location,'') AS location, COALESCE(out_of_service,0) AS out_of_service
    FROM equipment
    WHERE id = ? AND active = 1 AND merged_into_equipment_id IS NULL
  `).bind(equipmentId).first<Equipment>();
  if (!equipment) throw new Error('That unit is not an active Equipment record.');
  return equipment;
}

async function hasAssignedUnitAccess(user: AppUser, technicianId: number, equipmentId: number) {
  const row = await env.DB.prepare(`
    SELECT 1 AS allowed
    WHERE EXISTS (
      SELECT 1
      FROM repairs r
      WHERE r.equipment_id = ? AND r.technician_id = ?
        AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
    ) OR EXISTS (
      SELECT 1
      FROM repair_labor_timers rt
      JOIN repairs r ON r.id = rt.repair_id
      WHERE rt.user_id = ? AND r.equipment_id = ?
    )
  `).bind(equipmentId,technicianId,user.id,equipmentId).first<{allowed:number}>();
  return Boolean(row?.allowed);
}

async function enforceYardForNewWork(user: AppUser, equipment: Equipment) {
  if (user.role !== 'mechanic' && user.role !== 'manager') return;
  const account = await env.DB.prepare(`SELECT COALESCE(yard,'') AS yard FROM app_users WHERE id = ?`)
    .bind(user.id).first<{yard:string}>();
  const assigned = normalizeYard(account?.yard);
  if (!assigned) throw new Error('Your account needs a yard assignment before you can add work to another unit.');
  const unitYard = normalizeYard(equipment.current_yard) || normalizeYard(equipment.location);
  if (!unitYard) throw new Error('This unit does not have a yard assignment yet. Ask a manager to place the unit first.');
  if (unitYard !== assigned) {
    throw new Error(`Unit ${equipment.unit} is in the ${yardLabel(unitYard)} yard. You can add new work only in your assigned ${yardLabel(assigned)} yard unless that unit is already assigned to you.`);
  }
}

export async function createRepairForTechnician(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB,request);
  if (!user) throw new Error('Authentication required.');
  const technician = await linkedTechnician(user);
  const equipment = await loadEquipment(body.equipmentId);
  const alreadyMine = await hasAssignedUnitAccess(user,technician.id,equipment.id);
  if (!alreadyMine) await enforceYardForNewWork(user,equipment);

  const issue = String(body.issue ?? '').trim().slice(0,500);
  const parts = String(body.parts ?? '').trim().slice(0,1000);
  if (!issue) throw new Error('Enter the repair needed.');

  const result = await env.DB.prepare(`
    INSERT INTO repairs (equipment_id,title,parts_text,status,priority,source,technician_id,updated_at)
    VALUES (?,?,?,'Assigned','2','manual',?,CURRENT_TIMESTAMP)
  `).bind(equipment.id,issue,parts,technician.id).run();
  const id = Number(result.meta.last_row_id);
  if (!id) throw new Error('The repair could not be created.');
  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
    VALUES (?,?,?,'repair_created',?)
  `).bind(id,user.id,technician.id,`${technician.name} added this repair for Unit ${equipment.unit} from the Repair Board and assigned it to themself.`).run();

  return { ok:true, repairId:`repair-${id}`, equipmentId:equipment.id, unit:equipment.unit, technicianId:technician.id };
}

export async function setUnitOosByTechnician(request: Request, body: Record<string, unknown>) {
  const user = await getSessionUser(env.DB,request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'mechanic') throw new Error('Technician OOS handling is only used for mechanic accounts.');
  const technician = await linkedTechnician(user);
  if (!Boolean(body.outOfService)) throw new Error('Technicians can place a unit out of service. A manager must return it to service.');

  const equipment = await loadEquipment(body.equipmentId);
  const reason = String(body.reason ?? '').trim().slice(0,500);
  if (!reason) throw new Error('Enter a reason before placing the unit out of service.');
  if (equipment.out_of_service) return { ok:true, equipmentId:equipment.id, outOfService:true, existing:true };

  const allowed = await hasAssignedUnitAccess(user,technician.id,equipment.id);
  if (!allowed) throw new Error('You can place a unit out of service only when you have open work assigned on that unit or are actively working on it.');

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE equipment
      SET out_of_service = 1,
          out_of_service_reason = ?,
          out_of_service_at = CURRENT_TIMESTAMP,
          out_of_service_by_user_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(reason,user.id,equipment.id),
    env.DB.prepare(`
      INSERT INTO equipment_status_events (equipment_id,user_id,out_of_service,reason)
      VALUES (?,?,1,?)
    `).bind(equipment.id,user.id,reason),
  ]);

  return { ok:true, equipmentId:equipment.id, outOfService:true };
}
