import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getMaintenanceBoardItems } from '@/lib/maintenance-board';

type Technician={id:number;name:string};
type ExistingRepair={id:number;equipment_id:number|null;technician_id:number|null;status:string;timer_technician_id:number|null};
type DvirDefect={geotab_defect_id:string;asset_unit:string;driver:string;defect:string;comments:string};
type DueItem=Awaited<ReturnType<typeof getMaintenanceBoardItems>>[number];

type Plan=
 |{kind:'repair';sourceId:string;repair:ExistingRepair}
 |{kind:'dvir';sourceId:string;defect:DvirDefect}
 |{kind:'maintenance';sourceId:string;maintenanceKind:'pm'|'annual';equipmentId:number;dueItem:DueItem};

function uniqueIds(value:unknown){
 if(!Array.isArray(value))throw new Error('Choose at least one unit or repair to assign.');
 const ids=[...new Set(value.map(item=>String(item??'').trim()).filter(Boolean))];
 if(!ids.length)throw new Error('Choose at least one unit or repair to assign.');
 if(ids.length>100)throw new Error('Assign no more than 100 repair items at one time.');
 return ids;
}

function repairNumber(value:string){
 const match=value.match(/^repair-(\d+)$/);
 return match?Number(match[1]):0;
}

function maintenanceId(value:string){
 const match=value.match(/^(pm|annual)-(\d+)$/);
 return match?{kind:match[1] as 'pm'|'annual',equipmentId:Number(match[2]),id:value}:null;
}

function normalizedUnit(value:string){return value.trim().toLowerCase().replace(/[\s\-()]/g,'');}

async function requireManager(request:Request){
 const user=await getSessionUser(env.DB,request);
 if(!user)throw new Error('Authentication required.');
 if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required for bulk assignment.');
 return user;
}

async function activeTechnician(value:unknown){
 const id=Number(value??0);
 if(!Number.isInteger(id)||id<=0)throw new Error('Choose a technician for the selected work.');
 const technician=await env.DB.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1').bind(id).first<Technician>();
 if(!technician)throw new Error('Technician was not found or is inactive.');
 return technician;
}

async function existingRepair(id:number){
 return env.DB.prepare(`
  SELECT r.id,r.equipment_id,r.technician_id,COALESCE(r.status,'New') AS status,
         rt.technician_id AS timer_technician_id
  FROM repairs r
  LEFT JOIN repair_labor_timers rt ON rt.repair_id=r.id
  WHERE r.id=? AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
 `).bind(id).first<ExistingRepair>();
}

async function activeScheduledRepair(equipmentId:number,source:string){
 return env.DB.prepare(`
  SELECT r.id,r.equipment_id,r.technician_id,COALESCE(r.status,'New') AS status,
         rt.technician_id AS timer_technician_id
  FROM repairs r
  LEFT JOIN repair_labor_timers rt ON rt.repair_id=r.id
  WHERE r.equipment_id=? AND r.source=? AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
  ORDER BY r.id DESC LIMIT 1
 `).bind(equipmentId,source).first<ExistingRepair>();
}

async function activeDvirRepair(defectId:string){
 return env.DB.prepare(`
  SELECT r.id,r.equipment_id,r.technician_id,COALESCE(r.status,'New') AS status,
         rt.technician_id AS timer_technician_id
  FROM repairs r
  LEFT JOIN repair_labor_timers rt ON rt.repair_id=r.id
  WHERE r.geotab_defect_id=? AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
  ORDER BY r.id DESC LIMIT 1
 `).bind(defectId).first<ExistingRepair>();
}

function verifyTimer(repair:ExistingRepair,technicianId:number,sourceId:string){
 if(repair.timer_technician_id!==null&&Number(repair.timer_technician_id)!==technicianId){
  throw new Error(`${sourceId} has active labor. Stop the running timer before assigning it to another technician.`);
 }
}

async function equipmentIdForUnit(unitValue:string){
 const unit=unitValue.trim();
 if(!unit)throw new Error('The DVIR unit number is missing.');
 const key=normalizedUnit(unit);
 const existing=await env.DB.prepare(`
  SELECT id FROM equipment
  WHERE lower(replace(replace(replace(replace(trim(unit),' ',''),'-',''),'(',''),')',''))=?
  ORDER BY active DESC,id LIMIT 1
 `).bind(key).first<{id:number}>();
 if(existing){
  await env.DB.prepare('UPDATE equipment SET active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(existing.id).run();
  return existing.id;
 }
 await env.DB.prepare(`
  INSERT INTO equipment(unit,category,equipment_type,active,updated_at)
  VALUES(?,'fleet','other',1,CURRENT_TIMESTAMP)
  ON CONFLICT(unit) DO UPDATE SET active=1,updated_at=CURRENT_TIMESTAMP
 `).bind(unit).run();
 const created=await env.DB.prepare('SELECT id FROM equipment WHERE unit=?').bind(unit).first<{id:number}>();
 if(!created)throw new Error(`Unit ${unit} could not be added to Equipment.`);
 return created.id;
}

async function assignExisting(repair:ExistingRepair,technician:Technician,user:{id:number;displayName:string}){
 verifyTimer(repair,technician.id,`Repair ${repair.id}`);
 const currentTech=repair.technician_id===null?null:Number(repair.technician_id);
 const nextStatus=String(repair.status).toLowerCase()==='new'?'Assigned':repair.status;
 if(currentTech===technician.id&&nextStatus===repair.status)return `repair-${repair.id}`;
 await env.DB.batch([
  env.DB.prepare('UPDATE repairs SET technician_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
   .bind(technician.id,nextStatus,repair.id),
  env.DB.prepare(`
   INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
   VALUES(?,?,?,'assigned',?)
  `).bind(repair.id,user.id,technician.id,`${user.displayName} bulk-assigned this repair to ${technician.name}.`),
 ]);
 return `repair-${repair.id}`;
}

export async function POST(request:Request){
 try{
  const user=await requireManager(request);
  const body=await request.json() as Record<string,unknown>;
  const technician=await activeTechnician(body.technicianId);
  const ids=uniqueIds(body.itemIds);
  const maintenanceItems=await getMaintenanceBoardItems(env.DB);
  const maintenanceById=new Map(maintenanceItems.map(item=>[item.id,item]));
  const plans:Plan[]=[];

  for(const sourceId of ids){
   const repairId=repairNumber(sourceId);
   if(repairId){
    const repair=await existingRepair(repairId);
    if(!repair)throw new Error(`${sourceId} is no longer an open repair. Refresh the Planning Center.`);
    verifyTimer(repair,technician.id,sourceId);
    plans.push({kind:'repair',sourceId,repair});
    continue;
   }

   if(sourceId.startsWith('dvir-')){
    const defectId=sourceId.slice(5).trim();
    if(!defectId)throw new Error('A selected DVIR is invalid. Refresh the Planning Center.');
    const existing=await activeDvirRepair(defectId);
    if(existing){
     verifyTimer(existing,technician.id,sourceId);
     plans.push({kind:'repair',sourceId,repair:existing});
     continue;
    }
    const defect=await env.DB.prepare(`
     SELECT geotab_defect_id,asset_unit,COALESCE(driver,'') AS driver,defect,COALESCE(comments,'') AS comments
     FROM dvir_defects WHERE geotab_defect_id=? AND repaired=0
    `).bind(defectId).first<DvirDefect>();
    if(!defect)throw new Error(`${sourceId} is no longer an open DVIR. Refresh the Planning Center.`);
    plans.push({kind:'dvir',sourceId,defect});
    continue;
   }

   const maintenance=maintenanceId(sourceId);
   if(maintenance){
    const source=maintenance.kind==='pm'?'scheduled-pm':'scheduled-annual';
    const existing=await activeScheduledRepair(maintenance.equipmentId,source);
    if(existing){
     verifyTimer(existing,technician.id,sourceId);
     plans.push({kind:'repair',sourceId,repair:existing});
     continue;
    }
    const dueItem=maintenanceById.get(maintenance.id);
    if(!dueItem)throw new Error(`${sourceId} is no longer due. Refresh the Planning Center.`);
    plans.push({kind:'maintenance',sourceId,maintenanceKind:maintenance.kind,equipmentId:maintenance.equipmentId,dueItem});
    continue;
   }

   throw new Error(`${sourceId} is not a valid Repair Board item.`);
  }

  const repairIds:string[]=[];
  for(const plan of plans){
   if(plan.kind==='repair'){
    repairIds.push(await assignExisting(plan.repair,technician,user));
    continue;
   }
   if(plan.kind==='dvir'){
    const equipmentId=await equipmentIdForUnit(plan.defect.asset_unit);
    const inserted=await env.DB.prepare(`
     INSERT INTO repairs(equipment_id,title,description,status,priority,source,geotab_defect_id,driver,technician_id,updated_at)
     VALUES(?,?,?,'Assigned','2','geotab-dvir',?,?,?,CURRENT_TIMESTAMP)
    `).bind(equipmentId,plan.defect.defect,plan.defect.comments,plan.defect.geotab_defect_id,plan.defect.driver,technician.id).run();
    const repairId=Number(inserted.meta.last_row_id);
    await env.DB.prepare(`
     INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
     VALUES(?,?,?,'dvir_added',?)
    `).bind(repairId,user.id,technician.id,`${user.displayName} added the DVIR and bulk-assigned it to ${technician.name}.`).run();
    repairIds.push(`repair-${repairId}`);
    continue;
   }

   const source=plan.maintenanceKind==='pm'?'scheduled-pm':'scheduled-annual';
   const priority=plan.dueItem.status.toLowerCase().includes('overdue')?'1':'2';
   const inserted=await env.DB.prepare(`
    INSERT INTO repairs(equipment_id,title,description,status,priority,source,driver,location,technician_id,updated_at)
    VALUES(?,?,?,'Assigned',?,?,?,?,?,CURRENT_TIMESTAMP)
   `).bind(
    plan.equipmentId,
    plan.dueItem.issue,
    `Scheduled ${plan.maintenanceKind==='pm'?'PM':'annual inspection'} generated from the Planning Center.`,
    priority,
    source,
    plan.dueItem.driver,
    plan.dueItem.location,
    technician.id,
   ).run();
   const repairId=Number(inserted.meta.last_row_id);
   await env.DB.prepare(`
    INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
    VALUES(?,?,?,'scheduled_maintenance_added',?)
   `).bind(repairId,user.id,technician.id,`${user.displayName} bulk-assigned the scheduled ${plan.maintenanceKind.toUpperCase()} to ${technician.name}.`).run();
   repairIds.push(`repair-${repairId}`);
  }

  return Response.json({ok:true,technicianId:technician.id,technicianName:technician.name,assignedCount:plans.length,repairIds},{headers:{'cache-control':'no-store'}});
 }catch(error){
  console.error(JSON.stringify({event:'repair_board_bulk_assign_failed',error:String(error)}));
  return Response.json({error:error instanceof Error?error.message:'Selected work could not be assigned.'},{status:400,headers:{'cache-control':'no-store'}});
 }
}
