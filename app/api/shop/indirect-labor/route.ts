import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

const INDIRECT='INDIRECT LABOR-OTHER';

export async function POST(request:Request){
 try{
  const user=await getSessionUser(env.DB,request);
  if(!user)return Response.json({error:'Authentication required.'},{status:401});
  if(!['mechanic','manager','admin'].includes(user.role)||!user.technicianId)throw new Error('A linked technician account is required to start indirect labor.');
  const active=await env.DB.prepare(`SELECT repair_id FROM repair_labor_timers WHERE user_id=?`).bind(user.id).first<{repair_id:number}>();
  if(active)throw new Error('Finish or stop your current work before starting indirect labor.');
  const type=await env.DB.prepare(`SELECT id,unit_rule,active FROM repair_types WHERE name=? COLLATE NOCASE LIMIT 1`).bind(INDIRECT).first<{id:number;unit_rule:string;active:number}>();
  if(!type||!type.active)throw new Error('INDIRECT LABOR-OTHER is not active in Repair Type Setup.');
  if(type.unit_rule!=='optional')throw new Error('INDIRECT LABOR-OTHER must allow work without a unit.');
  const body=await request.json() as Record<string,unknown>;
  const activity=String(body.activity??'').trim().replace(/\s+/g,' ').slice(0,250);
  if(!activity)throw new Error('Enter what you are doing.');
  const technician=await env.DB.prepare(`SELECT id,name FROM technicians WHERE id=? AND active=1`).bind(user.technicianId).first<{id:number;name:string}>();
  if(!technician)throw new Error('The linked technician record is not active.');
  const result=await env.DB.prepare(`
    INSERT INTO repairs(equipment_id,title,description,status,priority,source,technician_id,repair_type_id,opened_at,updated_at)
    VALUES(NULL,?,?,'Assigned','2','indirect-labor',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `).bind(activity,`Indirect shop labor: ${activity}`,technician.id,type.id).run();
  const repairId=Number(result.meta.last_row_id);if(!repairId)throw new Error('Indirect labor work order could not be created.');
  await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'indirect_labor_created',?)`).bind(repairId,user.id,technician.id,`${technician.name} started INDIRECT LABOR-OTHER: ${activity}`.slice(0,500)).run();
  return Response.json({ok:true,repairId:`repair-${repairId}`,repairType:INDIRECT,activity,unit:'SHOP / NO UNIT'});
 }catch(error){console.error(JSON.stringify({event:'indirect_labor_create_failed',error:String(error)}));return Response.json({error:error instanceof Error?error.message:'Indirect labor could not be started.'},{status:400})}
}
