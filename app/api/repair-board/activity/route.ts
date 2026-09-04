import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export async function GET(request:Request){
 try{
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required.');
  const rows=await env.DB.prepare(`
   SELECT ev.id,ev.action,COALESCE(ev.detail,'') AS detail,ev.created_at,
          COALESCE(eq.unit,'') AS unit,
          COALESCE(NULLIF(u.display_name,''),NULLIF(t.name,''),'System') AS actor
   FROM repair_job_events ev
   JOIN repairs r ON r.id=ev.repair_id
   LEFT JOIN equipment eq ON eq.id=r.equipment_id
   LEFT JOIN app_users u ON u.id=ev.user_id
   LEFT JOIN technicians t ON t.id=ev.technician_id
   ORDER BY ev.created_at DESC,ev.id DESC
   LIMIT 16
  `).all<{id:number;action:string;detail:string;created_at:string;unit:string;actor:string}>();
  return Response.json({ok:true,activity:rows.results.map(row=>({id:Number(row.id),action:row.action,detail:row.detail,createdAt:row.created_at,unit:row.unit,actor:row.actor}))},{headers:{'cache-control':'no-store'}});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:'Recent repair activity could not be loaded.'},{status:400,headers:{'cache-control':'no-store'}});
 }
}
