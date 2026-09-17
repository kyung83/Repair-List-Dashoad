import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getRepairTypeBySystemKey } from '@/lib/repair-types';

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)throw new Error('Authentication required.');
    if(!['mechanic','manager','admin'].includes(user.role)||!user.technicianId)throw new Error('A technician account is required to start indirect labor.');
    const body=await request.json() as Record<string,unknown>;
    const description=String(body.description??'').trim().slice(0,500);
    if(!description)throw new Error('Enter what you are doing.');

    const active=await env.DB.prepare('SELECT repair_id FROM repair_labor_timers WHERE user_id=?').bind(user.id).first<{repair_id:number}>();
    if(active)throw new Error('Finish or stop your current work before starting indirect labor.');
    const type=await getRepairTypeBySystemKey(env.DB,'indirect-labor');
    if(!type)throw new Error('INDIRECT LABOR-OTHER is not active in Repair Type Setup.');
    const technician=await env.DB.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1').bind(user.technicianId).first<{id:number;name:string}>();
    if(!technician)throw new Error('The linked technician record is not active.');
    const account=await env.DB.prepare("SELECT COALESCE(yard,'') AS yard FROM app_users WHERE id=?").bind(user.id).first<{yard:string}>();
    const location=String(account?.yard??'').trim();

    const result=await env.DB.prepare(`
      INSERT INTO repairs(equipment_id,title,description,status,priority,source,location,technician_id,repair_type_id,driver,updated_at)
      VALUES(NULL,?,?,'Assigned','2','manual',?,?,?, ?,CURRENT_TIMESTAMP)
    `).bind(description,description,location,technician.id,type.id,technician.name).run();
    const id=Number(result.meta.last_row_id);
    if(!id)throw new Error('Indirect labor work order could not be created.');
    await env.DB.prepare(`
      INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
      VALUES(?,?,?,'indirect_labor_created',?)
    `).bind(id,user.id,technician.id,`${technician.name} started shop/no-unit indirect labor: ${description}`.slice(0,500)).run();
    return Response.json({ok:true,repairId:`repair-${id}`,repairType:type.name,description,equipmentId:null,unit:''},{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'indirect_labor_create_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Indirect labor could not be started.'},{status:400});
  }
}
