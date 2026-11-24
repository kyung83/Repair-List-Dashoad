import { isRepairTeamMember } from '@/lib/repair-team';
import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { listRepairTypes, repairTypeForRepair, requireRepairType } from '@/lib/repair-types';
import {resolveRepairChecklist} from '@/lib/repair-checklist-scope';
import {listRepairSubcategories,repairSubcategoryForRepair,requireRepairSubcategory} from '@/lib/repair-subcategories';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

type RepairRow = {
  id:number;
  equipment_id:number|null;
  technician_id:number|null;
  repair_type_id:number|null;
  status:string;
  maintenance_event_type:string|null;
};

async function repairForUser(request:Request, repairId:number, requireWorkingNow:boolean) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!['mechanic','manager','admin'].includes(user.role) || !user.technicianId) {
    throw new Error('A linked technician account is required.');
  }

  const repair = await env.DB.prepare(`
    SELECT r.id,r.equipment_id,r.technician_id,r.repair_type_id,
           COALESCE(r.status,'') AS status,
           (SELECT c.event_type FROM maintenance_checklist_runs c
             WHERE c.repair_id=r.id AND c.event_type IN ('pm','annual') LIMIT 1) AS maintenance_event_type
    FROM repairs r
    WHERE r.id=?
  `).bind(repairId).first<RepairRow>();
  if (!repair) throw new Error('Repair was not found.');
  if (repair.status.toLowerCase().includes('complete')) throw new Error('That repair is already completed.');
  if (!(await isRepairTeamMember(env.DB,repairId,Number(user.technicianId)))) throw new Error('This repair is not assigned to you.');

  if (requireWorkingNow) {
    const timer = await env.DB.prepare(`SELECT repair_id,technician_id FROM repair_labor_timers WHERE user_id=?`).bind(user.id).first<{repair_id:number;technician_id:number}>();
    if (!timer || Number(timer.repair_id) !== repairId || Number(timer.technician_id) !== Number(user.technicianId)) {
      throw new Error('Choose the Repair Type while this repair is WORKING NOW.');
    }
  }
  return {user,repair};
}

async function payload(repair:RepairRow) {
  const current = await repairTypeForRepair(env.DB, repair.id);
  const maintenanceEventType = repair.maintenance_event_type === 'pm' || repair.maintenance_event_type === 'annual'
    ? repair.maintenance_event_type
    : null;
  const checklistRun = await env.DB.prepare(`SELECT id FROM repair_type_checklist_runs WHERE repair_id=? LIMIT 1`)
    .bind(repair.id).first<{id:number}>();
  const all = await listRepairTypes(env.DB,true);
  const types = all.filter(type => type.name.toUpperCase() !== 'INDIRECT LABOR-OTHER');
  const currentSubcategory=await repairSubcategoryForRepair(env.DB,repair.id);
  const subcategories=current&&current.name.toUpperCase()!=='INDIRECT LABOR-OTHER'?(await listRepairSubcategories(env.DB)).filter(s=>s.repairTypeId===current.id):[];
  const checklistScope=current?await resolveRepairChecklist(env.DB,repair.id,current):null;
  const lockReason = checklistRun
    ? 'checklist_started'
    : maintenanceEventType
      ? 'maintenance'
      : repair.equipment_id === null
        ? 'no_unit'
        : null;
  return {
    repairId:`repair-${repair.id}`,
    current,
    currentSubcategory,
    subcategories,
    checklistMode:checklistScope?.mode??'none',
    checklistName:checklistScope?.template?.name??null,
    checklistPendingSubcategory:checklistScope?.waitingForSubcategory??false,
    subcategoryLocked:Boolean(checklistRun&&currentSubcategory),
    types,
    maintenanceEventType,
    maintenanceLabel:maintenanceEventType === 'annual' ? 'ANNUAL' : maintenanceEventType === 'pm' ? 'PM' : '',
    noUnit:repair.equipment_id === null,
    locked:Boolean(lockReason),
    lockReason,
  };
}

export async function GET(request:Request) {
  try {
    const repairId = numericRepairId(new URL(request.url).searchParams.get('repairId'));
    if (!repairId) throw new Error('Repair was not found.');
    const {repair} = await repairForUser(request,repairId,false);
    return Response.json({ok:true,...await payload(repair)},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Repair Type could not be loaded.'},{status:400,headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request:Request) {
  try {
    const body = await request.json() as Record<string,unknown>;
    const repairId = numericRepairId(body.repairId);
    if (!repairId) throw new Error('Repair was not found.');
    const {user,repair} = await repairForUser(request,repairId,true);
    if (repair.maintenance_event_type === 'pm' || repair.maintenance_event_type === 'annual') {
      throw new Error('PM and Annual keep their own maintenance work type.');
    }
    if (repair.equipment_id === null) {
      throw new Error('SHOP / NO UNIT work keeps its assigned indirect-labor type.');
    }

    if(body.action==='setSubcategory'){
      const parent=await repairTypeForRepair(env.DB,repairId);
      if(!parent||parent.name.toUpperCase()==='INDIRECT LABOR-OTHER')throw new Error('Choose a fleet Repair Type first.');
      if(Number(body.repairTypeId)!==parent.id)throw new Error('The Repair Type changed. Reload and choose a subcategory again.');
      const next=await requireRepairSubcategory(env.DB,parent.id,body.repairSubcategoryId);
      const current=await repairSubcategoryForRepair(env.DB,repairId);
      if((current?.id??null)!==(next?.id??null)){
        if(current&&await env.DB.prepare('SELECT id FROM repair_type_checklist_runs WHERE repair_id=? LIMIT 1').bind(repairId).first())throw new Error('Subcategory cannot change after its checklist has started.');
        const result=await env.DB.prepare(`UPDATE repairs SET repair_subcategory_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND repair_type_id=? AND (repair_subcategory_id IS NULL OR NOT EXISTS(SELECT 1 FROM repair_type_checklist_runs WHERE repair_id=repairs.id)) AND lower(COALESCE(status,'')) NOT LIKE '%complete%' AND EXISTS(SELECT 1 FROM repair_labor_timers WHERE repair_id=? AND user_id=? AND technician_id=?)`).bind(next?.id??null,repairId,parent.id,repairId,user.id,user.technicianId).run();
        if(!result.meta.changes)throw new Error('The repair changed or is no longer WORKING NOW. Reload before selecting a subcategory.');
        await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'repair_subcategory_selected',?)`).bind(repairId,user.id,user.technicianId,`${user.displayName} selected ${parent.name} subcategory: ${next?.name??'Not specified'}.`.slice(0,500)).run();
      }
      return Response.json({ok:true,...await payload(repair)},{headers:{'cache-control':'no-store'}});
    }

    const next = await requireRepairType(env.DB,body.repairTypeId);
    if (next.name.toUpperCase() === 'INDIRECT LABOR-OTHER') {
      throw new Error('Use START INDIRECT LABOR for shop work that is not a fleet repair.');
    }
    const current = await repairTypeForRepair(env.DB,repairId);
    if (current?.id !== next.id) {
      const run = await env.DB.prepare(`SELECT id FROM repair_type_checklist_runs WHERE repair_id=? LIMIT 1`).bind(repairId).first<{id:number}>();
      if (run) throw new Error('This Repair Type cannot be changed after its checklist has been started.');
      await env.DB.prepare(`UPDATE repairs SET repair_type_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND NOT EXISTS(SELECT 1 FROM repair_type_checklist_runs WHERE repair_id=repairs.id)`).bind(next.id,repairId).run();
      await env.DB.prepare(`
        INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
        VALUES(?,?,?,'repair_type_selected',?)
      `).bind(repairId,user.id,user.technicianId,`${user.displayName} selected Repair Type: ${next.name}.`.slice(0,500)).run();
    }

    const refreshed = await env.DB.prepare(`
      SELECT r.id,r.equipment_id,r.technician_id,r.repair_type_id,COALESCE(r.status,'') AS status,
             (SELECT c.event_type FROM maintenance_checklist_runs c WHERE c.repair_id=r.id AND c.event_type IN ('pm','annual') LIMIT 1) AS maintenance_event_type
      FROM repairs r WHERE r.id=?
    `).bind(repairId).first<RepairRow>();
    if (!refreshed) throw new Error('Repair was not found.');
    return Response.json({ok:true,...await payload(refreshed)},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    console.error(JSON.stringify({event:'shop_repair_type_change_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair Type could not be saved.'},{status:400,headers:{'cache-control':'no-store'}});
  }
}
