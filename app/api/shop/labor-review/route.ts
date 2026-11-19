import {env} from 'cloudflare:workers';
import {getSessionUser} from '@/lib/auth';
import {getShopLaborRate} from '@/lib/billing';

type User=NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
type Row={
  id:number;requester_user_id:number;technician_id:number;request_type:'correction'|'missed';
  source_labor_entry_id:number|null;source_repair_id:number|null;proposed_repair_id:number|null;
  unit_snapshot:string;repair_snapshot:string;original_hours:number|null;original_rate:number|null;original_notes:string;
  requested_hours:number;labor_date:string;started_local:string;ended_local:string;details:string;
  status:string;manager_note:string;reviewed_by_user_id:number|null;reviewed_at:string|null;
};
type Entry={id:number;repair_id:number;technician_id:number|null;hours:number;rate:number;notes:string;labor_date:string;status:string;reviewed_at:string|null;go_live_archived_at:string|null;source:string;unit:string;title:string};
type Repair={id:number;status:string;reviewed_at:string|null;go_live_archived_at:string|null;source:string;title:string;unit:string};

function problem(message:string,status=400){return Response.json({ok:false,error:message},{status,headers:{'cache-control':'no-store'}})}
function idOf(value:unknown){const match=String(value??'').match(/^(?:repair-)?(\d+)$/);const id=match?Number(match[1]):0;return Number.isSafeInteger(id)&&id>0?id:0}
function hoursOf(value:unknown){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>24||Math.round(n*100)!==n*100&&Math.abs(Math.round(n*100)-n*100)>0.000001)throw new Error('Enter labor hours from 0.01 to 24.00 in hundredths.');return Math.round(n*100)/100}
function detailOf(value:unknown){const text=String(value??'').trim();if(text.length<8||text.length>1500)throw new Error('Explain what happened (8–1500 characters).');return text}
function dateOf(value:unknown){const v=String(value??'').trim();const parsed=new Date(v+'T12:00:00Z');const now=Date.now();if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==v||parsed.getTime()<now-120*86400000||parsed.getTime()>now+86400000)throw new Error('Choose a work date within the last 120 days.');return v}
function clockOf(value:unknown){const v=String(value??'').trim();if(v&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error('Use a valid time such as 07:30.');return v}
function isTechnician(user:User){return Boolean(user.technicianId)&&(user.role==='mechanic'||user.role==='manager')}
function isManager(user:User){return user.role==='manager'||user.role==='admin'}
async function getEntry(entryId:number){return env.DB.prepare("SELECT l.id,l.repair_id,l.technician_id,l.hours,l.rate,COALESCE(l.notes,'') AS notes,l.labor_date,r.status,r.reviewed_at,r.go_live_archived_at,COALESCE(r.source,'') AS source,COALESCE(e.unit,'') AS unit,r.title FROM repair_labor_entries l JOIN repairs r ON r.id=l.repair_id LEFT JOIN equipment e ON e.id=r.equipment_id WHERE l.id=?").bind(entryId).first<Entry>()}
async function getRepair(repairId:number){return env.DB.prepare("SELECT r.id,r.status,r.reviewed_at,r.go_live_archived_at,COALESCE(r.source,'') AS source,r.title,COALESCE(e.unit,'') AS unit FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id WHERE r.id=?").bind(repairId).first<Repair>()}
async function checkRepair(id:number){
  const repair=await getRepair(id);
  if(!repair||repair.go_live_archived_at||repair.source.trim().toLowerCase()==='roadside-breakdown')throw new Error('Choose an existing shop work order, not a roadside or archived record.');
  if(repair.reviewed_at)throw new Error('This work order was already approved. Reopen its review before applying corrected labor.');
  const invoice=await env.DB.prepare('SELECT 1 AS linked FROM invoices i LEFT JOIN invoice_repair_links irl ON irl.invoice_id=i.id WHERE (i.repair_id=? OR irl.repair_id=?) LIMIT 1').bind(id,id).first();
  if(invoice)throw new Error('This repair is already linked to an invoice. Resolve the billing review before editing labor.');
  return repair;
}
async function requestById(id:number){return env.DB.prepare('SELECT * FROM shop_labor_review_requests WHERE id=?').bind(id).first<Row>()}
async function logEvent(repairId:number,user:User,technicianId:number,detail:string){
  return env.DB.prepare("INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES (?,?,?,'labor_review_approved',?)").bind(repairId,user.id,technicianId,detail.slice(0,500));
}
function updateTotals(repairId:number){return env.DB.prepare("UPDATE repairs SET labor_hours=(SELECT COALESCE(SUM(hours),0) FROM repair_labor_entries WHERE repair_id=?),labor_rate=COALESCE((SELECT SUM(hours*rate)/NULLIF(SUM(hours),0) FROM repair_labor_entries WHERE repair_id=?),labor_rate),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(repairId,repairId,repairId)}
function cleanKey(value:unknown){const key=String(value??'').trim();if(!/^[A-Za-z0-9:_-]{12,90}$/.test(key))throw new Error('Invalid request identifier. Reload and try again.');return key}

export async function GET(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)return problem('Sign in again.',401);
    if(!isTechnician(user)&&!isManager(user))return problem('Labor review is available to linked technicians and managers.',403);
    const url=new URL(request.url);
    const q=(url.searchParams.get('q')||'').trim().slice(0,70);
    if(q.length>=2){
      const pattern='%'+q.replace(/[%_]/g,'')+'%';
      const rows=await env.DB.prepare("SELECT r.id AS repairId,COALESCE(e.unit,'') AS unit,r.title,r.status,COALESCE(r.location,'') AS location FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id WHERE r.go_live_archived_at IS NULL AND lower(trim(COALESCE(r.source,'')))<>'roadside-breakdown' AND (e.unit LIKE ? OR r.title LIKE ? OR CAST(r.id AS TEXT)=?) ORDER BY r.updated_at DESC LIMIT 35").bind(pattern,pattern,q).all();
      return Response.json({ok:true,repairs:rows.results},{headers:{'cache-control':'no-store'}});
    }
    // Working managers can explicitly open their OWN Completed history; the unqualified route
    // remains the full manager Labor Corrections queue used by management.
    if(isManager(user)&&!(url.searchParams.get('view')==='mine'&&isTechnician(user))){
      const rows=await env.DB.prepare("SELECT l.*,t.name AS technicianName,u.display_name AS requestedBy,COALESCE(se.unit,'') AS sourceUnit,COALESCE(sr.title,'') AS sourceTitle,COALESCE(te.unit,'') AS targetUnit,COALESCE(tr.title,'') AS targetTitle,le.hours AS currentHours FROM shop_labor_review_requests l JOIN technicians t ON t.id=l.technician_id JOIN app_users u ON u.id=l.requester_user_id LEFT JOIN repair_labor_entries le ON le.id=l.source_labor_entry_id LEFT JOIN repairs sr ON sr.id=l.source_repair_id LEFT JOIN equipment se ON se.id=sr.equipment_id LEFT JOIN repairs tr ON tr.id=l.proposed_repair_id LEFT JOIN equipment te ON te.id=tr.equipment_id ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'needs_info' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,l.created_at DESC LIMIT 200").all();
      return Response.json({ok:true,requests:rows.results,manager:true,currentUserId:user.id,currentTechnicianId:user.technicianId},{headers:{'cache-control':'no-store'}});
    }
    const techId=Number(user.technicianId);
    const [history,completed,requests]=await Promise.all([
      env.DB.prepare("SELECT l.id AS entryId,l.repair_id AS repairId,l.labor_date AS laborDate,l.hours,l.rate,COALESCE(l.notes,'') AS notes,l.started_at AS startedAt,l.ended_at AS endedAt,COALESCE(e.unit,'') AS unit,r.title,r.status FROM repair_labor_entries l JOIN repairs r ON r.id=l.repair_id LEFT JOIN equipment e ON e.id=r.equipment_id WHERE l.technician_id=? AND l.labor_date>=date('now','-90 days') AND r.go_live_archived_at IS NULL ORDER BY l.labor_date DESC,l.id DESC LIMIT 160").bind(techId).all(),
      env.DB.prepare(
        "SELECT r.id AS repairId,COALESCE(e.unit,'') AS unit,r.title,r.status,r.completed_at AS completedAt,COALESCE(r.labor_hours,0) AS totalHours,"+
        "CASE WHEN lower(trim(COALESCE(r.status,'')))='completed' AND lower(trim(COALESCE(r.source,'')))='manual' "+
        "AND r.reviewed_at IS NULL AND r.go_live_archived_at IS NULL "+
        "AND r.maintenance_checklist_item_id IS NULL AND r.maintenance_source_id IS NULL "+
        "AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.repair_id=r.id) "+
        "AND NOT EXISTS(SELECT 1 FROM invoice_repair_links l WHERE l.repair_id=r.id) "+
        "AND NOT EXISTS(SELECT 1 FROM repair_labor_timers rt WHERE rt.repair_id=r.id) "+
        "AND (r.technician_id=? OR (SELECT ev.user_id FROM repair_job_events ev WHERE ev.repair_id=r.id AND ev.action='completed' ORDER BY ev.id DESC LIMIT 1)=?) "+
        "THEN 1 ELSE 0 END AS canReopen "+
        "FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id WHERE r.go_live_archived_at IS NULL "+
        "AND lower(COALESCE(r.status,'')) LIKE '%complete%' AND r.completed_at>=datetime('now','-90 days') "+
        "AND (r.technician_id=? OR EXISTS(SELECT 1 FROM repair_team_members m WHERE m.repair_id=r.id AND m.technician_id=?)) "+
        "ORDER BY r.completed_at DESC LIMIT 100"
      ).bind(techId,user.id,techId,techId).all(),
      env.DB.prepare('SELECT * FROM shop_labor_review_requests WHERE requester_user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all()
    ]);
    return Response.json({ok:true,history:history.results,completed:completed.results,requests:requests.results,manager:false},{headers:{'cache-control':'no-store'}});
  }catch(error){console.error(JSON.stringify({event:'shop_labor_review_get_failed',error:String(error)}));return problem('Unable to load labor review records.',500)}
}

async function submit(user:User,body:Record<string,unknown>){
  if(!isTechnician(user))throw new Error('Only linked technicians can submit labor review requests.');
  const key=cleanKey(body.requestKey);
  const previous=await env.DB.prepare('SELECT id,requester_user_id FROM shop_labor_review_requests WHERE request_key=?').bind(key).first<{id:number;requester_user_id:number}>();
  if(previous){if(previous.requester_user_id!==user.id)throw new Error('Invalid request key.');return {ok:true,id:previous.id,duplicate:true}}
  const type=String(body.requestType||'');
  const details=detailOf(body.details);
  const requested=hoursOf(body.requestedHours);
  const techId=Number(user.technicianId);
  let entryId:number|null=null,sourceRepair:number|null=null,proposedRepair:number|null=null,unit='',title='',originalHours:number|null=null,originalRate:number|null=null,originalNotes='',workDate='',start='',end='';
  if(type==='correction'){
    entryId=idOf(body.entryId);const entry=await getEntry(entryId);
    if(!entry||entry.technician_id!==techId||entry.go_live_archived_at)throw new Error('Choose one of your own saved labor entries.');
    originalHours=Number(entry.hours);originalRate=Number(entry.rate);originalNotes=entry.notes;
    if(Math.abs(originalHours-requested)<0.001)throw new Error('Requested hours must differ from the saved hours.');
    sourceRepair=entry.repair_id;workDate=entry.labor_date;unit=entry.unit;title=entry.title;
    const proposed=idOf(body.targetRepairId);
    if(proposed){
      if(requested>=originalHours)throw new Error('You can only transfer hours removed from the original repair.');
      if(proposed===sourceRepair)throw new Error('Choose a different repair for transferred hours.');
      await checkRepair(proposed);proposedRepair=proposed;
    }
  }else if(type==='missed'){
    workDate=dateOf(body.workDate);start=clockOf(body.startedLocal);end=clockOf(body.endedLocal);
    if(Boolean(start)!==Boolean(end))throw new Error('Provide both the start and end time, or leave both blank.');
    unit=String(body.unit??'').trim().slice(0,45);title=String(body.workDescription??'').trim().slice(0,220);
    if(!unit&&!idOf(body.repairId))throw new Error('Enter the unit or select an existing work order.');
    if(!title)throw new Error('Describe what work was performed.');
    proposedRepair=idOf(body.repairId)||null;
    if(proposedRepair){const repair=await getRepair(proposedRepair);if(!repair||repair.go_live_archived_at||repair.source.trim().toLowerCase()==='roadside-breakdown')throw new Error('Select a valid shop repair.');unit=unit||repair.unit;}
  }else throw new Error('Choose correction or missed work.');
  const inserted=await env.DB.prepare("INSERT INTO shop_labor_review_requests(request_key,requester_user_id,technician_id,request_type,source_labor_entry_id,source_repair_id,proposed_repair_id,unit_snapshot,repair_snapshot,original_hours,original_rate,original_notes,requested_hours,labor_date,started_local,ended_local,details) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(key,user.id,techId,type,entryId,sourceRepair,proposedRepair,unit,title,originalHours,originalRate,originalNotes,requested,workDate,start,end,details).run();
  return {ok:true,id:Number(inserted.meta.last_row_id),status:'pending'};
}
async function clarify(user:User,body:Record<string,unknown>){
  if(!isTechnician(user))throw new Error('Only linked technicians can clarify their own requests.');
  const id=idOf(body.requestId),details=detailOf(body.details);
  const result=await env.DB.prepare("UPDATE shop_labor_review_requests SET details=?,status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND requester_user_id=? AND status='needs_info'").bind(details,id,user.id).run();
  if(result.meta.changes!==1)throw new Error('This request is no longer awaiting clarification.');
  return {ok:true,id,status:'pending'};
}
async function decision(user:User,body:Record<string,unknown>){
  if(!isManager(user))throw new Error('Managers only.');
  const id=idOf(body.requestId),action=String(body.action||''),note=String(body.managerNote||'').trim().slice(0,1000);
  if(!['reject','needs_info'].includes(action)||note.length<5)throw new Error('Provide a reason before rejecting or requesting clarification.');
  const ownRequest=await requestById(id);
  if(ownRequest&&(ownRequest.requester_user_id===user.id||(Boolean(user.technicianId)&&ownRequest.technician_id===user.technicianId)))throw new Error('Another manager must review your own labor request.');
  const result=await env.DB.prepare('UPDATE shop_labor_review_requests SET status=?,manager_note=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?').bind(action==='reject'?'rejected':'needs_info',note,user.id,id,'pending').run();
  if(result.meta.changes!==1)throw new Error('This request is no longer pending.');
  return {ok:true,id,status:action==='reject'?'rejected':'needs_info'};
}
async function approve(user:User,body:Record<string,unknown>){
  if(!isManager(user))throw new Error('Managers only.');
  const id=idOf(body.requestId),request=await requestById(id);
  if(!request||request.status!=='pending')throw new Error('This request is not pending.');
  if(request.requester_user_id===user.id||(Boolean(user.technicianId)&&request.technician_id===user.technicianId))throw new Error('Another manager must review your own labor request.');
  const note=String(body.managerNote??'').trim().slice(0,1000);
  const techId=request.technician_id;
  let source:Entry|null=null;
  if(request.request_type==='correction'){
    if(!request.source_labor_entry_id||!request.source_repair_id)throw new Error('The original labor entry is missing.');
    source=await getEntry(request.source_labor_entry_id);
    if(!source||source.technician_id!==techId||source.repair_id!==request.source_repair_id||Math.abs(Number(source.hours)-Number(request.original_hours))>0.00001)throw new Error('The original labor entry has changed. Return this request for review.');
    await checkRepair(source.repair_id);
  }
  const inputRepair=idOf(body.repairId),chosenRepair=inputRepair||request.proposed_repair_id||0;
  const movedHours=request.request_type==='correction'?Math.round((Number(request.original_hours)-request.requested_hours)*100)/100:0;
  if(request.request_type==='missed'&&!Boolean(body.acknowledgeOtherWork))throw new Error('Confirm that approval posts labor only. Parts and inspections require separate verification.');
  let target:Repair|null=null;
  if(chosenRepair){
    target=await checkRepair(chosenRepair);
    if(request.request_type==='correction'&&(chosenRepair===request.source_repair_id||movedHours<=0))throw new Error('A transfer requires removed hours and a different destination repair.');
  }
  if(request.request_type==='missed'&&!target)throw new Error('Select the existing shop repair for the missed work before approval.');
  const token=crypto.randomUUID(),claim=await env.DB.prepare("UPDATE shop_labor_review_requests SET status='processing',apply_token=?,manager_note=?,reviewed_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(token,note,user.id,id).run();
  if(claim.meta.changes!==1)throw new Error('Another manager already started reviewing this request.');
  const operations=[];
  try{
    if(source){
      operations.push(env.DB.prepare('UPDATE repair_labor_entries SET hours=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(request.requested_hours,source.id));
      operations.push(await logEvent(source.repair_id,user,techId,'Labor request #'+id+': '+source.hours+'h adjusted to '+request.requested_hours+'h. '+request.details));
    }
    if(target&&source&&movedHours>0){
      operations.push(env.DB.prepare('INSERT INTO repair_labor_entries(repair_id,technician_id,labor_date,hours,rate,notes) VALUES(?,?,?,?,?,?)').bind(target.id,techId,source.labor_date,movedHours,source.rate,('Manager-approved transfer from repair #'+source.repair_id+'; request #'+id+'. '+request.details).slice(0,500)));
      operations.push(await logEvent(target.id,user,techId,'Labor request #'+id+': received '+movedHours+'h transferred from repair #'+source.repair_id+'.'));
    }
    if(target&&request.request_type==='missed'){
      const rate=await getShopLaborRate(env.DB);
      const desc=('Late entry / request #'+id+'. '+request.repair_snapshot+'. '+request.details).slice(0,500);
      operations.push(env.DB.prepare('INSERT INTO repair_labor_entries(repair_id,technician_id,labor_date,hours,rate,notes) VALUES(?,?,?,?,?,?)').bind(target.id,techId,request.labor_date,request.requested_hours,rate,desc));
      operations.push(await logEvent(target.id,user,techId,'Missed work request #'+id+': '+request.requested_hours+'h on '+request.labor_date+'. Parts, PM/Annual proof and DVIR remain separate.'));
    }
    if(source)operations.push(updateTotals(source.repair_id));
    if(target&&(!source||target.id!==source.repair_id))operations.push(updateTotals(target.id));
    operations.push(env.DB.prepare("UPDATE shop_labor_review_requests SET status='approved',proposed_repair_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing' AND apply_token=?").bind(target?.id??null,id,token));
    await env.DB.batch(operations);
    return {ok:true,id,status:'approved',laborApplied:true,otherWorkStillRequiresVerification:request.request_type==='missed'};
  }catch(error){
    await env.DB.prepare("UPDATE shop_labor_review_requests SET status='pending',apply_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing' AND apply_token=?").bind(id,token).run().catch(()=>undefined);
    throw error;
  }
}

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)return problem('Sign in again.',401);
    const body=await request.json() as Record<string,unknown>;
    const action=String(body.action??'');
    if(action==='submit')return Response.json(await submit(user,body),{headers:{'cache-control':'no-store'}});
    if(action==='clarify')return Response.json(await clarify(user,body),{headers:{'cache-control':'no-store'}});
    if(action==='approve')return Response.json(await approve(user,body),{headers:{'cache-control':'no-store'}});
    if(action==='reject'||action==='needs_info')return Response.json(await decision(user,body),{headers:{'cache-control':'no-store'}});
    return problem('Unknown labor review action.');
  }catch(error){
    const message=error instanceof Error?error.message:'Unable to save labor request.';
    console.error(JSON.stringify({event:'shop_labor_review_post_failed',error:message}));
    return problem(message,message.includes('Sign in')?401:400);
  }
}