import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { requireRepairType, type RepairType } from '@/lib/repair-types';
import { normalizeYard, yardLabel } from '@/lib/yards';

type Technician={id:number;name:string};
type Equipment={id:number;unit:string;location:string;current_yard:string};

async function equipmentIdForUnit(unitValue:string,equipmentTypeValue:unknown,locationValue:string){
  const unit=unitValue.trim();
  if(!unit)throw new Error('Enter a unit number.');
  const existing=await env.DB.prepare('SELECT id FROM equipment WHERE lower(trim(unit))=lower(trim(?)) AND active=1 LIMIT 1')
    .bind(unit).first<{id:number}>();
  if(existing)return Number(existing.id);
  const type=String(equipmentTypeValue??'other').trim().toLowerCase();
  const equipmentType=['truck','trailer','other'].includes(type)?type:'other';
  const result=await env.DB.prepare(
    'INSERT INTO equipment(unit,category,equipment_type,active,location,updated_at) VALUES(?, ?, ?, 1, ?, CURRENT_TIMESTAMP)'
  ).bind(unit,equipmentType==='trailer'?'Trailer':equipmentType==='truck'?'Truck':'Other',equipmentType,locationValue.trim()).run();
  const id=Number(result.meta.last_row_id);
  if(!id)throw new Error('Unit could not be created.');
  return id;
}

async function linkedTechnician(user:AppUser){
  if(!user.technicianId)throw new Error('Your login is not linked to a technician record. Ask an administrator to enable Works on repairs.');
  const technician=await env.DB.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1')
    .bind(user.technicianId).first<Technician>();
  if(!technician)throw new Error('Your linked technician record is not active.');
  return technician;
}

async function enforceTechnicianUnitAccess(user:AppUser,technicianId:number,equipment:Equipment){
  const alreadyMine=await env.DB.prepare(`
    SELECT 1 AS allowed
    WHERE EXISTS (
      SELECT 1 FROM repairs
      WHERE equipment_id=? AND technician_id=?
        AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    ) OR EXISTS (
      SELECT 1
      FROM repair_labor_timers rt
      JOIN repairs r ON r.id=rt.repair_id
      WHERE rt.user_id=? AND r.equipment_id=?
    )
  `).bind(equipment.id,technicianId,user.id,equipment.id).first<{allowed:number}>();
  if(alreadyMine?.allowed)return;

  const account=await env.DB.prepare("SELECT COALESCE(yard,'') AS yard FROM app_users WHERE id=?")
    .bind(user.id).first<{yard:string}>();
  const assigned=normalizeYard(account?.yard);
  if(!assigned)throw new Error('Your account needs a yard assignment before you can add repair work.');

  const unitYard=normalizeYard(equipment.current_yard)||normalizeYard(equipment.location);
  if(!unitYard)throw new Error('This unit does not have a yard assignment yet. Ask a manager to place the unit first.');
  if(unitYard!==assigned){
    throw new Error(`Unit ${equipment.unit} is in the ${yardLabel(unitYard)} yard. You can add repair work only in your assigned ${yardLabel(assigned)} yard unless that unit is already assigned to you.`);
  }
}

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)return Response.json({error:'Authentication required.'},{status:401});
    if(!['mechanic','manager','admin'].includes(user.role)){
      return Response.json({error:'Technician, manager, or administrator access is required.'},{status:403});
    }

    const mechanic=user.role==='mechanic';
    const mechanicTechnician=mechanic?await linkedTechnician(user):null;

    const body=await request.json() as Record<string,unknown>;
    const issue=String(body.issue??'').trim().slice(0,500);
    const parts=String(body.parts??'').trim().slice(0,1000);
    const priority=Number(body.priority??2);
    if(!issue)throw new Error('Enter the repair needed.');
    if(![1,2,3].includes(priority))throw new Error('Priority must be 1, 2, or 3.');

    const requestedTypeId=Number(body.repairTypeId??0);
    let repairType:RepairType|null=null;
    if(Number.isInteger(requestedTypeId)&&requestedTypeId>0){
      repairType=await requireRepairType(env.DB,requestedTypeId);
    }

    const mode=String(body.mode??'equipment');
    let equipmentId:number|null=null;
    let unit='SHOP / NO UNIT';
    let location='';

    if(mode==='no-unit'){
      if(!repairType)throw new Error('SHOP / NO UNIT requires an indirect-labor work type.');
      if(repairType.unitRule!=='optional')throw new Error(`${repairType.name} requires a unit.`);
      if(mechanic&&repairType.name!=='INDIRECT LABOR-OTHER'){
        throw new Error('Technicians can use SHOP / NO UNIT only for INDIRECT LABOR-OTHER.');
      }
    }else if(mode==='equipment'){
      const id=Number(body.equipmentId??0);
      if(!Number.isInteger(id)||id<=0)throw new Error('Choose an active unit.');
      const equipment=await env.DB.prepare(`
        SELECT id,unit,COALESCE(location,'') AS location,COALESCE(current_yard,'') AS current_yard
        FROM equipment
        WHERE id=? AND active=1 AND merged_into_equipment_id IS NULL
      `).bind(id).first<Equipment>();
      if(!equipment)throw new Error('Equipment was not found or is inactive.');
      if(mechanic&&mechanicTechnician){
        await enforceTechnicianUnitAccess(user,mechanicTechnician.id,equipment);
      }
      equipmentId=equipment.id;
      unit=equipment.unit;
      location=equipment.location;
    }else{
      if(mechanic)throw new Error('Technicians can add repairs only to an existing active unit.');
      equipmentId=await equipmentIdForUnit(String(body.unit??''),body.equipmentType,String(body.location??''));
      const equipment=await env.DB.prepare("SELECT unit,COALESCE(location,'') AS location FROM equipment WHERE id=?")
        .bind(equipmentId).first<{unit:string;location:string}>();
      unit=equipment?.unit||String(body.unit??'').trim();
      location=equipment?.location||String(body.location??'').trim();
    }

    if(repairType?.unitRule==='required'&&equipmentId===null){
      throw new Error(`${repairType.name} requires a unit.`);
    }

    let technician:Technician|null=mechanicTechnician;
    if(!mechanic){
      const technicianId=Number(body.technicianId??0);
      if(technicianId>0){
        technician=await env.DB.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1')
          .bind(technicianId).first<Technician>();
        if(!technician)throw new Error('Technician was not found or is inactive.');
      }
    }

    const status=technician?'Assigned':'New';
    const source=repairType?.name==='INDIRECT LABOR-OTHER'?'indirect-labor':'manual';
    const result=await env.DB.prepare(`
      INSERT INTO repairs(
        equipment_id,title,parts_text,status,priority,source,location,
        technician_id,repair_type_id,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `).bind(
      equipmentId,issue,parts,status,String(priority),source,
      equipmentId===null?'':location,technician?.id??null,repairType?.id??null
    ).run();

    const repairId=Number(result.meta.last_row_id);
    if(!repairId)throw new Error('Repair could not be added.');

    const typeDetail=repairType?`${repairType.name}: `:'';
    await env.DB.prepare(`
      INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
      VALUES(?,?,?,'repair_created',?)
    `).bind(
      repairId,user.id,technician?.id??null,
      `${user.displayName} created ${typeDetail}${issue}${equipmentId===null?' (SHOP / NO UNIT)':` for Unit ${unit}`}${technician?` and assigned it to ${technician.name}`:''}.${repairType?'':' Repair Type will be selected when the repair is worked.'}`.slice(0,500)
    ).run();

    return Response.json({
      ok:true,
      repairId:`repair-${repairId}`,
      equipmentId,
      unit,
      repairTypeId:repairType?.id??null,
      repairType:repairType?.name??'',
      technicianId:technician?.id??null,
    });
  }catch(error){
    console.error(JSON.stringify({event:'repair_create_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair could not be added.'},{status:400});
  }
}
