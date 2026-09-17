import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getRepairType, listRepairTypes, requireRepairType } from '@/lib/repair-types';

function repairId(value:unknown){
  const match=String(value??'').match(/^(?:repair-)?(\d+)$/);
  const id=match?Number(match[1]):0;
  if(!Number.isInteger(id)||id<=0)throw new Error('Repair was not found.');
  return id;
}

async function loadRepair(id:number){
  const row=await env.DB.prepare(`
    SELECT r.id,r.equipment_id,r.technician_id,r.repair_type_id,COALESCE(r.status,'') AS status,
           COALESCE(r.source,'manual') AS source,COALESCE(e.unit,'') AS unit
    FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id
    WHERE r.id=?
  `).bind(id).first<{id:number;equipment_id:number|null;technician_id:number|null;repair_type_id:number|null;status:string;source:string;unit:string}>();
  if(!row)throw new Error('Repair was not found.');
  return row;
}

function completed(status:string){return status.toLowerCase().includes('complete')}
function maintenanceSource(source:string){return source==='scheduled-pm'||source==='scheduled-annual'}

async function access(request:Request,repair:Awaited<ReturnType<typeof loadRepair>>,write=false){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  const manager=user.role==='manager'||user.role==='admin';
  const assignedMechanic=user.role==='mechanic'&&Boolean(user.technicianId)&&Number(repair.technician_id??0)===Number(user.technicianId);
  if(write&&!manager&&!assignedMechanic)throw new Error('This repair is not assigned to you.');
  if(write&&completed(repair.status))throw new Error('Completed repair types are corrected from Work Order Review.');
  if(write&&maintenanceSource(repair.source))throw new Error('PM and Annual keep their dedicated maintenance type.');
  return {user,canEdit:manager||assignedMechanic};
}

export async function GET(request:Request){
  try{
    const id=repairId(new URL(request.url).searchParams.get('repairId'));
    const repair=await loadRepair(id);
    const {canEdit}=await access(request,repair,false);
    return Response.json({
      repairId:`repair-${id}`,
      equipmentId:repair.equipment_id,
      unit:repair.unit,
      source:repair.source,
      repairType:repair.repair_type_id?await getRepairType(env.DB,repair.repair_type_id,true):null,
      types:await listRepairTypes(env.DB,false),
      canEdit:canEdit&&!completed(repair.status)&&!maintenanceSource(repair.source),
      dedicatedType:repair.source==='scheduled-pm'?'PM':repair.source==='scheduled-annual'?'ANNUAL':'',
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Repair type could not be loaded.'},{status:400});
  }
}

export async function POST(request:Request){
  try{
    const body=await request.json() as Record<string,unknown>;
    const id=repairId(body.repairId);
    const repair=await loadRepair(id);
    const {user}=await access(request,repair,true);
    const type=await requireRepairType(env.DB,body.repairTypeId);
    if(type.unitRule==='required'&&repair.equipment_id===null)throw new Error(`${type.name} must be attached to a unit.`);

    const run=await env.DB.prepare('SELECT repair_type_id,status FROM repair_type_checklist_runs WHERE repair_id=?').bind(id).first<{repair_type_id:number;status:string}>();
    if(run&&Number(run.repair_type_id)!==type.id)throw new Error('This repair already has a checklist started. Its repair type cannot be changed.');

    await env.DB.batch([
      env.DB.prepare('UPDATE repairs SET repair_type_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(type.id,id),
      env.DB.prepare(`
        INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
        VALUES(?,?,?,'repair_type_set',?)
      `).bind(id,user.id,repair.technician_id,`${user.displayName} set repair type to ${type.name}.`.slice(0,500)),
    ]);
    return Response.json({
      ok:true,
      repairId:`repair-${id}`,
      repairType:type,
      warning:type.checklistMode==='required'&&!type.checklistConfigured?'This repair type requires a checklist, but its checklist has not been configured yet.':undefined,
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'repair_type_assignment_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair type could not be saved.'},{status:400});
  }
}
