import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

async function technicianSession(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user||user.role!=='mechanic'||!user.technicianId)return null;
  return user;
}

export async function GET(request:Request){
  try{
    const user=await technicianSession(request);
    if(!user)return Response.json({alert:null},{headers:{'cache-control':'no-store'}});
    const alert=await env.DB.prepare(`
      SELECT a.id,a.repair_id,a.title,a.body,a.created_at,
             COALESCE(e.unit,'') AS unit,COALESCE(r.title,'') AS repair_title
      FROM technician_alerts a
      JOIN repairs r ON r.id=a.repair_id
      LEFT JOIN equipment e ON e.id=r.equipment_id
      WHERE a.technician_id=?
        AND a.alert_type='pull_thru'
        AND a.acknowledged_at IS NULL
        AND COALESCE(r.pull_thru,0)=1
        AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      ORDER BY a.id
      LIMIT 1
    `).bind(user.technicianId).first<{
      id:number;repair_id:number;title:string;body:string;created_at:string;unit:string;repair_title:string;
    }>();
    return Response.json({
      alert:alert?{
        id:Number(alert.id),
        repairId:`repair-${alert.repair_id}`,
        title:alert.title,
        body:alert.body,
        unit:alert.unit,
        repairTitle:alert.repair_title,
        createdAt:alert.created_at,
      }:null,
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'pull_thru_alert_load_failed',error:String(error)}));
    return Response.json({alert:null},{headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request:Request){
  try{
    const user=await technicianSession(request);
    if(!user)return Response.json({error:'Technician access is required.'},{status:403});
    const body=await request.json() as Record<string,unknown>;
    const alertId=Number(body.alertId??0);
    if(!Number.isInteger(alertId)||alertId<=0)throw new Error('Pull Thru alert was not found.');
    const result=await env.DB.prepare(`
      UPDATE technician_alerts
      SET acknowledged_at=CURRENT_TIMESTAMP,acknowledged_by_user_id=?
      WHERE id=? AND technician_id=? AND acknowledged_at IS NULL
    `).bind(user.id,alertId,user.technicianId).run();
    if(Boolean(result.meta.changes)){
      return Response.json({ok:true,acknowledged:true},{headers:{'cache-control':'no-store'}});
    }
    const existing=await env.DB.prepare(`
      SELECT id,acknowledged_at
      FROM technician_alerts
      WHERE id=? AND technician_id=?
    `).bind(alertId,user.technicianId).first<{id:number;acknowledged_at:string|null}>();
    if(existing?.acknowledged_at){
      return Response.json({ok:true,acknowledged:true,alreadyAcknowledged:true},{headers:{'cache-control':'no-store'}});
    }
    return Response.json({error:'Pull Thru alert could not be acknowledged.'},{status:404,headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Pull Thru alert could not be acknowledged.'},{status:400});
  }
}
