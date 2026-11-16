import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { listRepairTeam } from '@/lib/repair-team';

function id(value:unknown){ const n=Number(value); return Number.isInteger(n)&&n>0?n:0; }
async function getContext(request:Request,repairId:number){
  const user=await getSessionUser(env.DB,request);
  if(!user||!['mechanic','manager','admin'].includes(user.role))throw new Error('Authorized technician login required.');
  const repair=await env.DB.prepare(`
    SELECT id,technician_id,COALESCE(status,'') AS status FROM repairs WHERE id=?
  `).bind(repairId).first<{id:number;technician_id:number|null;status:string}>();
  if(!repair)throw new Error('Repair was not found.');
  const manager=user.role==='manager'||user.role==='admin';
  if(!manager&&Number(repair.technician_id)!==Number(user.technicianId))
    throw new Error('Only the primary technician or management can manage helpers.');
  return {user,repair};
}
export async function GET(request:Request){
  try{
    const repairId=id(new URL(request.url).searchParams.get('repairId'));
    if(!repairId)throw new Error('Repair ID required.');
    const {user,repair}=await getContext(request,repairId);
    const technicians=await env.DB.prepare(`
      SELECT id,name FROM technicians WHERE active=1 ORDER BY name
    `).all<{id:number;name:string}>();
    return Response.json({team:await listRepairTeam(env.DB,repairId),technicians:technicians.results.filter(t=>t.id!==repair.technician_id&&t.id!==user.technicianId)},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:String((error as Error).message||error)},{status:403});}
}
export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin');
    if(origin&&new URL(origin).origin!==new URL(request.url).origin)
      return Response.json({error:'Cross-site changes are not allowed.'},{status:403});
    const body=await request.json() as Record<string,unknown>;
    const repairId=id(body.repairId),technicianId=id(body.technicianId);
    if(!repairId||!technicianId)throw new Error('Choose a repair and technician.');
    const {user,repair}=await getContext(request,repairId);
    const action=String(body.action||'');
    if(!['add','remove'].includes(action))throw new Error('Unknown team action.');
    if(repair.technician_id===technicianId)throw new Error('Primary technician cannot be added or removed as a helper.');
    const technician=await env.DB.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1')
      .bind(technicianId).first<{id:number;name:string}>();
    if(!technician)throw new Error('That technician is not active.');
    if(action==='add'){
      if(repair.status.toLowerCase().includes('complete'))throw new Error('Completed work cannot take new helpers.');
      await env.DB.prepare(`
        INSERT INTO repair_team_members(repair_id,technician_id,added_by_user_id)
        VALUES(?,?,?) ON CONFLICT(repair_id,technician_id) DO NOTHING
      `).bind(repairId,technicianId,user.id).run();
    }else{
      const running=await env.DB.prepare(`
        SELECT 1 AS active FROM repair_labor_timers WHERE repair_id=? AND technician_id=? LIMIT 1
      `).bind(repairId,technicianId).first<{active:number}>();
      if(running)throw new Error('Helper must stop their labor timer before removal.');
      await env.DB.prepare('DELETE FROM repair_team_members WHERE repair_id=? AND technician_id=?')
        .bind(repairId,technicianId).run();
    }
    await env.DB.prepare(`
      INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
      VALUES(?,?,?,?,?)
    `).bind(repairId,user.id,user.technicianId,action==='add'?'helper_added':'helper_removed',
      `${technician.name} ${action==='add'?'added to':'removed from'} repair team by ${user.displayName}.`).run();
    return Response.json({ok:true,team:await listRepairTeam(env.DB,repairId)},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:String((error as Error).message||error)},{status:409});}
}
