import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { requireRepairType } from '@/lib/repair-types';

async function equipmentIdForUnit(unitValue:string,equipmentTypeValue:unknown,locationValue:string){
  const unit=unitValue.trim();if(!unit)throw new Error('Enter a unit number.');
  const existing=await env.DB.prepare(`SELECT id FROM equipment WHERE lower(trim(unit))=lower(trim(?)) AND active=1 LIMIT 1`).bind(unit).first<{id:number}>();
  if(existing)return Number(existing.id);
  const type=String(equipmentTypeValue??'other').trim().toLowerCase();
  const equipmentType=['truck','trailer','other'].includes(type)?type:'other';
  const result=await env.DB.prepare(`INSERT INTO equipment(unit,category,equipment_type,active,location,updated_at) VALUES(?, ?, ?, 1, ?, CURRENT_TIMESTAMP)`).bind(unit,equipmentType==='trailer'?'Trailer':equipmentType==='truck'?'Truck':'Other',equipmentType,locationValue.trim()).run();
  const id=Number(result.meta.last_row_id);if(!id)throw new Error('Unit could not be created.');return id;
}

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)return Response.json({error:'Authentication required.'},{status:401});
    if(user.role!=='manager'&&user.role!=='admin')return Response.json({error:'Manager or administrator access is required.'},{status:403});

    const body=await request.json() as Record<string,unknown>;
    const repairType=await requireRepairType(env.DB,body.repairTypeId);
    if(repairType.name.toUpperCase()==='INDIRECT LABOR-OTHER')throw new Error('INDIRECT LABOR-OTHER no-unit work is being enabled in Part 3.');

    const issue=String(body.issue??'').trim().slice(0,500);
    const parts=String(body.parts??'').trim().slice(0,1000);
    const priority=Number(body.priority??2);
    if(!issue)throw new Error('Enter the repair needed.');
    if(![1,2,3].includes(priority))throw new Error('Priority must be 1, 2, or 3.');

    const mode=String(body.mode??'equipment');
    let equipmentId:number;
    let unit='';
    let location='';
    if(mode==='equipment'){
      const id=Number(body.equipmentId??0);
      if(!Number.isInteger(id)||id<=0)throw new Error('Choose an active unit.');
      const equipment=await env.DB.prepare(`SELECT id,unit,COALESCE(location,'') AS location FROM equipment WHERE id=? AND active=1`).bind(id).first<{id:number;unit:string;location:string}>();
      if(!equipment)throw new Error('Equipment was not found or is inactive.');
      equipmentId=equipment.id;unit=equipment.unit;location=equipment.location;
    }else{
      equipmentId=await equipmentIdForUnit(String(body.unit??''),body.equipmentType,String(body.location??''));
      const equipment=await env.DB.prepare(`SELECT unit,COALESCE(location,'') AS location FROM equipment WHERE id=?`).bind(equipmentId).first<{unit:string;location:string}>();
      unit=equipment?.unit||String(body.unit??'').trim();location=equipment?.location||String(body.location??'').trim();
    }

    const technicianId=Number(body.technicianId??0);
    let technician:null|{id:number;name:string}=null;
    if(technicianId>0){
      technician=await env.DB.prepare(`SELECT id,name FROM technicians WHERE id=? AND active=1`).bind(technicianId).first<{id:number;name:string}>();
      if(!technician)throw new Error('Technician was not found or is inactive.');
    }

    const status=technician?'Assigned':'New';
    const result=await env.DB.prepare(`INSERT INTO repairs(equipment_id,title,parts_text,status,priority,source,location,technician_id,repair_type_id,updated_at) VALUES(?,?,?,?,?,'manual',?,?,?,CURRENT_TIMESTAMP)`).bind(equipmentId,issue,parts,status,String(priority),location,technician?.id??null,repairType.id).run();
    const repairId=Number(result.meta.last_row_id);if(!repairId)throw new Error('Repair could not be added.');
    await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'repair_created',?)`).bind(repairId,user.id,technician?.id??null,`${user.displayName} created ${repairType.name}: ${issue} for Unit ${unit}${technician?` and assigned it to ${technician.name}`:''}.`.slice(0,500)).run();

    return Response.json({ok:true,repairId:`repair-${repairId}`,equipmentId,unit,repairTypeId:repairType.id,repairType:repairType.name,technicianId:technician?.id??null});
  }catch(error){
    console.error(JSON.stringify({event:'categorized_repair_create_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair could not be added.'},{status:400});
  }
}
