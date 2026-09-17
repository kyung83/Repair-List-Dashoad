import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { requireRepairType } from '@/lib/repair-types';

function normalizedUnit(value:string){return value.trim().toLowerCase().replace(/[\s\-()]/g,'')}
function safeEquipmentType(value:unknown){const type=String(value??'other').trim().toLowerCase();return type==='truck'||type==='trailer'?type:'other'}

async function equipmentIdForUnit(unitValue:string,equipmentTypeValue:unknown='other',locationValue=''){
  const unit=unitValue.trim();
  if(!unit)throw new Error('A unit number is required.');
  const key=normalizedUnit(unit),equipmentType=safeEquipmentType(equipmentTypeValue),location=String(locationValue??'').trim();
  const existing=await env.DB.prepare(`
    SELECT id FROM equipment
    WHERE lower(replace(replace(replace(replace(trim(unit),' ',''),'-',''),'(',''),')',''))=?
    ORDER BY active DESC,id LIMIT 1
  `).bind(key).first<{id:number}>();
  if(existing){
    await env.DB.prepare(`
      UPDATE equipment SET active=1,
        equipment_type=CASE WHEN lower(COALESCE(equipment_type,'other'))='other' AND ?<>'other' THEN ? ELSE equipment_type END,
        location=CASE WHEN trim(COALESCE(location,''))='' AND ?<>'' THEN ? ELSE location END,
        updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(equipmentType,equipmentType,location,location,existing.id).run();
    return existing.id;
  }
  await env.DB.prepare(`
    INSERT INTO equipment(unit,category,equipment_type,location,active,updated_at)
    VALUES(?,'fleet',?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(unit) DO UPDATE SET active=1,updated_at=CURRENT_TIMESTAMP
  `).bind(unit,equipmentType,location).run();
  const created=await env.DB.prepare('SELECT id FROM equipment WHERE unit=?').bind(unit).first<{id:number}>();
  if(!created)throw new Error('The unit could not be added to equipment.');
  return created.id;
}

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)throw new Error('Authentication required.');
    const dispatch=Boolean((user as typeof user&{dispatchAccess?:boolean}).dispatchAccess);
    if(user.role!=='manager'&&user.role!=='admin'&&!dispatch)throw new Error('Manager, administrator, or dispatch access is required to add a repair.');
    const body=await request.json() as Record<string,unknown>;
    const type=await requireRepairType(env.DB,body.repairTypeId);
    const issue=String(body.issue??'').trim().slice(0,500);
    const parts=String(body.parts??'').trim().slice(0,1000);
    const priority=Number(body.priority??2);
    if(!issue)throw new Error('Enter the repair needed.');
    if(![1,2,3].includes(priority))throw new Error('Priority must be 1, 2, or 3.');

    const noUnit=Boolean(body.noUnit);
    if(noUnit&&type.unitRule!=='optional')throw new Error(`${type.name} must be attached to a unit.`);
    let equipmentId:number|null=null;
    let unit='';
    let location=String(body.location??'').trim();
    if(!noUnit){
      const explicit=Number(body.equipmentId??0);
      if(Number.isInteger(explicit)&&explicit>0){
        const equipment=await env.DB.prepare(`SELECT id,unit,COALESCE(location,'') AS location FROM equipment WHERE id=? AND active=1`).bind(explicit).first<{id:number;unit:string;location:string}>();
        if(!equipment)throw new Error('Unit was not found or is inactive.');
        equipmentId=equipment.id;unit=equipment.unit;location=equipment.location;
      }else{
        equipmentId=await equipmentIdForUnit(String(body.unit??''),body.equipmentType,location);
        const equipment=await env.DB.prepare(`SELECT unit,COALESCE(location,'') AS location FROM equipment WHERE id=?`).bind(equipmentId).first<{unit:string;location:string}>();
        unit=equipment?.unit??String(body.unit??'').trim();location=equipment?.location??location;
      }
    }

    const requestedTechnician=Number(body.technicianId??0);
    if(dispatch&&requestedTechnician>0)throw new Error('Dispatch can add unassigned repairs but cannot assign technicians.');
    const technician=requestedTechnician>0?await env.DB.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1').bind(requestedTechnician).first<{id:number;name:string}>():null;
    if(requestedTechnician>0&&!technician)throw new Error('Technician was not found or is inactive.');
    const status=technician?'Assigned':'New';
    const result=await env.DB.prepare(`
      INSERT INTO repairs(equipment_id,title,parts_text,status,priority,source,location,technician_id,repair_type_id,updated_at)
      VALUES(?,?,?,?,?,'manual',?,?,?,CURRENT_TIMESTAMP)
    `).bind(equipmentId,issue,parts,status,String(priority),location,technician?.id??null,type.id).run();
    const id=Number(result.meta.last_row_id);
    if(!id)throw new Error('Repair could not be added.');
    const target=noUnit?'SHOP / NO UNIT':`Unit ${unit}`;
    await env.DB.prepare(`
      INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
      VALUES(?,?,?,'repair_created',?)
    `).bind(id,user.id,technician?.id??null,`${user.displayName} created ${type.name} for ${target}${technician?` and assigned it to ${technician.name}`:''}.`.slice(0,500)).run();
    return Response.json({
      ok:true,repairId:`repair-${id}`,equipmentId,unit,noUnit,repairType:type,technicianId:technician?.id??null,
      warning:type.checklistMode==='required'&&!type.checklistConfigured?'This repair type requires a checklist. Configure its checklist in Setup → Repair Types before the technician completes it.':undefined,
    });
  }catch(error){
    console.error(JSON.stringify({event:'categorized_repair_create_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair could not be added.'},{status:400});
  }
}
