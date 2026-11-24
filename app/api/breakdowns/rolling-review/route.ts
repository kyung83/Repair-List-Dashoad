import {env} from 'cloudflare:workers';
import {getSessionUser} from '@/lib/auth';
import {getRollingReview} from '@/lib/breakdown-rolling-review';
import {parseRollingTime} from '@/lib/breakdown-rolling-motion';

export async function PATCH(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)return Response.json({error:'Authentication required.'},{status:401});
  if(user.role!=='manager'&&user.role!=='admin')return Response.json({error:'Manager or administrator access required.'},{status:403});
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Cross-site request rejected.'},{status:403});
  try{
    const body=await request.json<Record<string,unknown>>();
    const id=Number(body.breakdownId),action=String(body.action??'');
    if(!Number.isInteger(id)||id<=0)throw new Error('Invalid breakdown.');
    const row=await env.DB.prepare('SELECT id,repair_id,equipment_id,created_at,rolling_at,stage,status FROM roadside_breakdowns WHERE id=?').bind(id).first<{id:number;repair_id:number;equipment_id:number;created_at:string;rolling_at:string|null;stage:number;status:string}>();
    if(!row||row.stage>=5||row.rolling_at||row.status==='not_breakdown')throw new Error('Breakdown is no longer awaiting Rolling. Refresh its status.');
    const candidate=await getRollingReview(env.DB,id);
    const note=String(body.reason??'').trim().slice(0,250);
    const expected=String(body.candidateAt??'');
    if(action==='reject'){
      if(!candidate||candidate.candidateAt!==expected)throw new Error('Movement evidence changed. Refresh before reviewing.');
      if(!note)throw new Error('Enter the reason this movement was not a return to service.');
      const result=await env.DB.batch([
        env.DB.prepare(`UPDATE breakdown_rolling_checks SET state='watching',ignore_before=CURRENT_TIMESTAMP,scanned_through=CURRENT_TIMESTAMP,anchor_at=NULL,anchor_latitude=NULL,anchor_longitude=NULL,candidate_at=NULL,evidence_at=NULL,distance_miles=NULL,max_speed_mph=NULL,duration_minutes=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE breakdown_id=? AND equipment_id=? AND state='pending' AND candidate_at=? AND EXISTS(SELECT 1 FROM roadside_breakdowns b WHERE b.id=? AND b.stage<5 AND b.rolling_at IS NULL AND b.equipment_id=?)`).bind(id,row.equipment_id,expected,id,row.equipment_id),
        env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
          SELECT ?,?,NULL,'breakdown_rolling_rejected',? WHERE changes()=1`).bind(row.repair_id,user.id,('Geotab movement rejected at '+expected+': '+note).slice(0,500))
      ]);
      if(Number(result[0].meta.changes??0)!==1)throw new Error('Movement review changed. Refresh and try again.');
      return Response.json({ok:true},{headers:{'cache-control':'no-store'}});
    }
    if(action!=='confirm'&&action!=='manual')throw new Error('Invalid rolling review action.');
    if(action==='confirm'&&(!candidate||candidate.candidateAt!==expected))throw new Error('Movement evidence changed. Refresh before reviewing.');
    if(action==='manual'&&candidate)throw new Error('Review the available Geotab movement first.');
    const chosen=String(body.rollingAt??candidate?.candidateAt??'');
    const when=parseRollingTime(chosen),reported=parseRollingTime(row.created_at);
    if(!Number.isFinite(when)||!Number.isFinite(reported)||when<reported||when>Date.now())throw new Error('Rolling time must be after the breakdown report and no later than now.');
    if((action==='manual'||when!==parseRollingTime(candidate?.candidateAt))&&!note)throw new Error('Enter the reason for the office-entered time.');
    const source=action==='confirm'?'office_geotab':'office_manual';
    const stamp=new Date(when).toISOString();
    const guard=action==='confirm'?` AND EXISTS(SELECT 1 FROM breakdown_rolling_checks c JOIN equipment_geotab_devices d ON d.equipment_id=c.equipment_id AND d.geotab_device_id=c.device_id AND d.current=1 WHERE c.breakdown_id=roadside_breakdowns.id AND c.equipment_id=roadside_breakdowns.equipment_id AND julianday(d.assigned_at)<=julianday(roadside_breakdowns.created_at) AND c.state='pending' AND c.candidate_at=? AND (SELECT COUNT(*) FROM equipment_geotab_devices x WHERE x.equipment_id=roadside_breakdowns.equipment_id AND x.current=1)=1 AND (SELECT COUNT(*) FROM equipment_geotab_devices x WHERE x.geotab_device_id=c.device_id AND x.current=1)=1)`:'';
    const statement=env.DB.prepare(`UPDATE roadside_breakdowns
      SET rolling_at=strftime('%Y-%m-%d %H:%M:%S',?),rolling_confirmation_source=?,ready_for_review_at=CURRENT_TIMESTAMP,
          stage=CASE WHEN stage<4 THEN 4 ELSE stage END,status='ready_for_review',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND equipment_id=? AND stage<5 AND rolling_at IS NULL AND status<>'not_breakdown'`+guard);
    const evidence=candidate?`; Geotab suggested ${candidate.candidateAt}, evidence through ${candidate.evidenceAt}, ${candidate.distanceMiles.toFixed(1)} mi, ${candidate.maxSpeedMph.toFixed(0)} mph`:'';
    const audit=('Office confirmed Rolling at '+stamp+evidence+(note?'; reason: '+note:'')).slice(0,500);
    const result=await env.DB.batch([
      action==='confirm'?statement.bind(stamp,source,id,row.equipment_id,expected):statement.bind(stamp,source,id,row.equipment_id),
      env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) SELECT ?,?,NULL,'breakdown_rolling_confirmed',? WHERE changes()=1`).bind(row.repair_id,user.id,audit),
      env.DB.prepare(`UPDATE breakdown_rolling_checks SET state='confirmed',updated_at=CURRENT_TIMESTAMP WHERE breakdown_id=? AND equipment_id=? AND changes()=1`).bind(id,row.equipment_id)
    ]);
    if(Number(result[0].meta.changes??0)!==1)throw new Error('Breakdown changed. Refresh and try again.');
    return Response.json({ok:true,rollingAt:stamp},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Rolling review failed.'},{status:400,headers:{'cache-control':'no-store'}});}
}
