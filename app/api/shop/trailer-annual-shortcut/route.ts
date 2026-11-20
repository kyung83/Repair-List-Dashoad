import {env} from 'cloudflare:workers';
import {getSessionUser,type AppUser} from '@/lib/auth';
import {isRepairTeamMember} from '@/lib/repair-team';
import {VERIFIED_TRAILER_PM_ANNUAL_V1,canReuseTrailerPmAnnual} from '@/lib/trailer-pm-annual-shared-items';

type PmRow={id:number;equipment_id:number;unit:string;equipment_type:string;source:string;status:string;technician_id:number|null;annual_date:string|null;annual_interval:number;annual_enabled:number;location:string;driver:string};
type AnnualRow={id:number;technician_id:number|null;status:string};
type Run={id:number;repair_id:number;event_type:string;status:string;template_key:string;template_version:number;started_at:string;signed_at:string|null};
type Answer={item_number:number;item_text:string;result:string;notes:string|null;updated_by_user_id:number|null;updated_at:string;require_photo:number;require_measurement:number;require_notes:number};
const dayMs=86400000;
function numberId(raw:unknown){
  const m=/^(?:repair-)?([1-9][0-9]*)$/.exec(String(raw??''));
  const n=m?Number(m[1]):0;
  if(!Number.isSafeInteger(n)||n<=0)throw new Error('Choose a valid trailer PM work order.');
  return n;
}
function error(message:string,status=400){return Response.json({ok:false,error:message},{status,headers:{'cache-control':'no-store'}})}
async function userFor(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Sign in again.');
  if(!user.technicianId||!['mechanic','manager','admin'].includes(user.role))throw new Error('Only a linked technician or working manager can use this shortcut.');
  return user;
}
async function pmFor(id:number,user:AppUser){
  const pm=await env.DB.prepare(`
    SELECT r.id,r.equipment_id,COALESCE(e.unit,'') AS unit,COALESCE(e.equipment_type,'') AS equipment_type,
           COALESCE(r.source,'') AS source,COALESCE(r.status,'') AS status,r.technician_id,
           COALESCE(ps.annual_date,e.annual_date) AS annual_date,
           COALESCE(a.interval_days,365) AS annual_interval,
           CASE WHEN a.active=0 THEN 0 ELSE 1 END AS annual_enabled,
           COALESCE(r.location,e.location,'') AS location,COALESCE(e.driver,'') AS driver
    FROM repairs r JOIN equipment e ON e.id=r.equipment_id AND e.active=1
    LEFT JOIN pm_status ps ON ps.equipment_id=e.id
    LEFT JOIN equipment_annual_settings a ON a.equipment_id=e.id
    WHERE r.id=?
  `).bind(id).first<PmRow>();
  if(!pm||pm.source!=='scheduled-pm'||pm.equipment_type.toLowerCase()!=='trailer')
    throw new Error('The Annual shortcut is only available on an active Trailer PM.');
  if(!(await isRepairTeamMember(env.DB,id,Number(user.technicianId))))
    throw new Error('This Trailer PM is not assigned to you.');
  return pm;
}
async function existingAnnual(equipmentId:number){
  return env.DB.prepare(`
    SELECT id,technician_id,COALESCE(status,'') AS status FROM repairs
    WHERE equipment_id=? AND source='scheduled-annual'
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    ORDER BY id DESC LIMIT 1
  `).bind(equipmentId).first<AnnualRow>();
}
async function runFor(repairId:number){
  return env.DB.prepare(`
    SELECT c.id,c.repair_id,c.event_type,c.status,c.started_at,c.signed_at,
           COALESCE(t.template_key,'') AS template_key,COALESCE(c.template_version,0) AS template_version
    FROM maintenance_checklist_runs c
    LEFT JOIN maintenance_checklist_templates t ON t.id=c.template_id
    WHERE c.repair_id=?
  `).bind(repairId).first<Run>();
}
function annualDates(pm:PmRow){
  const raw=pm.annual_date?.slice(0,10)||'';
  const base=/^\d{4}-\d\d-\d\d$/.test(raw)?Date.parse(raw+'T12:00:00Z'):NaN;
  const due=Number.isFinite(base)?new Date(base+pm.annual_interval*dayMs).toISOString().slice(0,10):null;
  const daysRemaining=Number.isFinite(base)?Math.ceil((base+pm.annual_interval*dayMs-Date.now())/dayMs):null;
  return {lastAnnualDate:raw||null,nextAnnualDue:due,daysRemaining,annualIntervalDays:pm.annual_interval,
    annualEnabled:Boolean(pm.annual_enabled)};
}
async function countReusable(pmRepairId:number,actorId:number){
  const pmRun=await runFor(pmRepairId);
  if(!pmRun||pmRun.template_key!=='trailer-service'||pmRun.template_version!==1)return 0;
  const a=await env.DB.prepare(`
    SELECT item_number,item_text,result,notes,updated_by_user_id,updated_at,
           require_photo,require_measurement,require_notes
    FROM maintenance_checklist_items WHERE checklist_run_id=?
  `).bind(pmRun.id).all<Answer>();
  const byNumber=new Map(a.results.map(i=>[i.item_number,i]));
  return VERIFIED_TRAILER_PM_ANNUAL_V1.filter(pair=>{
    const item=byNumber.get(pair.pm);
    return item?.result==='pass'&&item.updated_by_user_id===actorId&&item.item_text===pair.pmText&&
      !item.require_photo&&!item.require_measurement&&!item.require_notes;
  }).length;
}
async function context(user:AppUser,id:number){
  const pm=await pmFor(id,user);
  const annual=await existingAnnual(pm.equipment_id);
  const pmRun=await runFor(pm.id);
  const possible=await countReusable(pm.id,user.id);
  return {ok:true,unit:pm.unit,pmRepairId:'repair-'+id,annualRepairId:annual?'repair-'+annual.id:null,
    pmStarted:Boolean(pmRun),pmStatus:pmRun?.status??'not_started',pmCompleted:pm.status.toLowerCase().includes('complete'),
    ...annualDates(pm),reusablePmAnswers:possible,verifiedMappingCount:VERIFIED_TRAILER_PM_ANNUAL_V1.length};
}
async function start(user:AppUser,pm:PmRow){
  if(pm.status.toLowerCase().includes('complete'))throw new Error('Start the Annual shortcut before this PM work order is closed.');
  if(pm.annual_enabled===0)throw new Error('Annual scheduling is disabled for this trailer. Contact maintenance management.');
  if(!(await runFor(pm.id)))throw new Error('Start the Trailer PM checklist before opening remaining Annual questions.');
  let annual=await existingAnnual(pm.equipment_id);
  if(!annual&&pm.annual_date){
    const annualDoneAt=Date.parse(pm.annual_date.slice(0,10)+'T12:00:00Z');
    const recent=Date.now()-annualDoneAt;
    if(Number.isFinite(annualDoneAt)&&recent>=0&&recent<30*dayMs)
      throw new Error('This trailer Annual was completed within the last 30 days. Do not create another Annual for this visit.');
  }
  if(!annual){
    // SELECT with NOT EXISTS is a single SQLite write statement; repeat requests
    // use the existing annual instead of creating duplicate open work orders.
    const inserted=await env.DB.prepare(`
      INSERT INTO repairs (equipment_id,title,description,status,priority,source,driver,location,technician_id,opened_at,updated_at)
      SELECT e.id,'Trailer Annual - remaining inspection questions',
             'Optional separate Annual opened during Trailer PM #${pm.id}. PM labor stays on the PM; this Annual requires separate inspection and sign-off.',
             'Assigned','2','scheduled-annual',?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      FROM equipment e WHERE e.id=? AND e.active=1
        AND NOT EXISTS(SELECT 1 FROM repairs previous WHERE previous.equipment_id=e.id
          AND previous.source='scheduled-annual'
          AND lower(COALESCE(previous.status,'')) NOT LIKE '%complete%')
    `).bind(pm.driver,pm.location,user.technicianId,pm.equipment_id).run();
    annual=await existingAnnual(pm.equipment_id);
    if(Number(inserted.meta.changes??0)>0&&annual){
      await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
        VALUES (?,?,?,'annual_started_from_pm',?)`).bind(
          annual.id,user.id,user.technicianId,
          `Separate Annual started while working Trailer PM #${pm.id}. No additional labor timer was created.`
        ).run();
    }
  }
  if(!annual)throw new Error('The separate Annual work order could not be created.');
  if(annual.technician_id!==null&&Number(annual.technician_id)!==Number(user.technicianId)&&
      !(await isRepairTeamMember(env.DB,annual.id,Number(user.technicianId))))
    throw new Error('An Annual work order already exists and belongs to another technician. Ask a manager to assign it.');
  if(annual.technician_id===null){
    const assigned=await env.DB.prepare(`UPDATE repairs SET technician_id=?,status='Assigned',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND technician_id IS NULL`).bind(user.technicianId,annual.id).run();
    if(!Number(assigned.meta.changes??0)&&!(await isRepairTeamMember(env.DB,annual.id,Number(user.technicianId))))
      throw new Error('The Annual was assigned to another technician. Refresh the PM.');
  }
  return annual.id;
}
async function reuse(user:AppUser,pm:PmRow,annualId:number){
  const annual=await existingAnnual(pm.equipment_id);
  if(!annual||annual.id!==annualId)throw new Error('That Annual work order is not open for this trailer.');
  if(!(await isRepairTeamMember(env.DB,annualId,Number(user.technicianId))))
    throw new Error('The Annual is not assigned to you.');
  const pmRun=await runFor(pm.id),annualRun=await runFor(annualId);
  if(!pmRun||!annualRun||!canReuseTrailerPmAnnual(pmRun,annualRun))
    throw new Error('This Annual needs its own inspection answers. Reuse requires the matching v1 templates, same visit, and an unsigned in-progress Annual.');
  const pmAnswers=await env.DB.prepare(`
    SELECT item_number,item_text,result,notes,updated_by_user_id,updated_at,
           require_photo,require_measurement,require_notes
    FROM maintenance_checklist_items WHERE checklist_run_id=?
  `).bind(pmRun.id).all<Answer>();
  const byNumber=new Map(pmAnswers.results.map(i=>[i.item_number,i]));
  const actions=[];
  for(const pair of VERIFIED_TRAILER_PM_ANNUAL_V1){
    const answer=byNumber.get(pair.pm);
    // A technician may only attest to checks they personally marked PASS on this visit.
    if(!answer||answer.item_text!==pair.pmText||answer.result!=='pass'||
       answer.updated_by_user_id!==user.id||answer.require_photo||answer.require_measurement||answer.require_notes)continue;
    const evidence=(`Checked during Trailer PM #${pm.id} item #${pair.pm}; reused for Annual by ${user.displayName} on this visit.`+
      (answer.notes?.trim()?' PM notes: '+answer.notes.trim():'' )).slice(0,1000);
    actions.push(env.DB.prepare(`
      UPDATE maintenance_checklist_items
      SET result='pass',notes=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP,revision=revision+1
      WHERE checklist_run_id=? AND item_number=? AND item_text=? AND result='pending'
        AND allow_pass=1 AND require_photo=0 AND require_measurement=0 AND require_notes=0
        AND EXISTS(SELECT 1 FROM maintenance_checklist_runs c
          WHERE c.id=? AND c.status='in_progress' AND c.signed_at IS NULL)
        AND EXISTS(SELECT 1 FROM maintenance_checklist_items pmi
          WHERE pmi.checklist_run_id=? AND pmi.item_number=? AND pmi.item_text=?
          AND pmi.result='pass' AND pmi.updated_by_user_id=? AND pmi.require_photo=0
          AND pmi.require_measurement=0 AND pmi.require_notes=0)
    `).bind(evidence,user.id,annualRun.id,pair.annual,pair.annualText,annualRun.id,
      pmRun.id,pair.pm,pair.pmText,user.id));
  }
  if(!actions.length)return {reused:0,remaining:null};
  const results=await env.DB.batch(actions);
  const reused=results.reduce((n,r)=>n+Number(r.meta.changes??0),0);
  if(reused){
    await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,?,'annual_pm_answers_reused',?)`).bind(
        annualId,user.id,user.technicianId,
        `${reused} independently verified same-visit PM question answers carried to the separate Annual from PM #${pm.id}; remaining Annual answers and Annual signature required.`
      ).run();
  }
  const total=await env.DB.prepare(`SELECT COUNT(*) AS remaining FROM maintenance_checklist_items
    WHERE checklist_run_id=? AND result='pending'`).bind(annualRun.id).first<{remaining:number}>();
  return {reused,remaining:Number(total?.remaining??0)};
}
async function complete(user:AppUser,pm:PmRow,annualId:number){
  const annual=await existingAnnual(pm.equipment_id);
  if(!annual||annual.id!==annualId)throw new Error('This Annual is already complete or does not belong to the trailer.');
  if(!(await isRepairTeamMember(env.DB,annualId,Number(user.technicianId))))
    throw new Error('Only the Annual inspector or assigned team may finish this Annual.');
  const run=await env.DB.prepare(`SELECT id,status,signed_by_user_id,signed_at,signature_strokes
    FROM maintenance_checklist_runs WHERE repair_id=? AND event_type='annual'`).bind(annualId)
    .first<{id:number;status:string;signed_by_user_id:number|null;signed_at:string|null;signature_strokes:string|null}>();
  if(!run||run.status!=='ready'||!run.signed_at||!run.signature_strokes)
    throw new Error('Complete and sign the separate Annual inspection before finishing it.');
  if(run.signed_by_user_id!==user.id)
    throw new Error('The technician who signed the Annual must finish it.');
  const closed=await env.DB.prepare(`
    UPDATE repairs SET status='Completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND source='scheduled-annual'
      AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
      AND NOT EXISTS(SELECT 1 FROM repair_labor_timers WHERE repair_id=repairs.id)
      AND EXISTS(SELECT 1 FROM maintenance_checklist_runs c WHERE c.repair_id=repairs.id
        AND c.status='ready' AND c.signed_at IS NOT NULL AND c.signature_strokes IS NOT NULL
        AND c.signed_by_user_id=?)
  `).bind(annualId,user.id).run();
  if(Number(closed.meta.changes??0)!==1)throw new Error('The Annual could not be closed. Confirm its checklist is signed and there are no open required repairs.');
  await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail)
    VALUES(?,?,?,'completed',?)`).bind(annualId,user.id,user.technicianId,
    `Separate Trailer Annual completed from PM #${pm.id} after independent Annual sign-off. Existing PM labor was not duplicated.`).run();
  return {completed:true,annualRepairId:'repair-'+annualId};
}
export async function GET(request:Request){
  try{
    const user=await userFor(request);
    const id=numberId(new URL(request.url).searchParams.get('pmRepairId'));
    return Response.json(await context(user,id),{headers:{'cache-control':'no-store'}});
  }catch(e){return error(e instanceof Error?e.message:'Unable to load Annual details.',403)}
}
export async function POST(request:Request){
  try{
    const user=await userFor(request);
    const body=await request.json() as Record<string,unknown>;
    const id=numberId(body.pmRepairId),pm=await pmFor(id,user);
    const action=String(body.action??'');
    if(action==='start'){const annualRepairId=await start(user,pm);return Response.json({ok:true,annualRepairId:'repair-'+annualRepairId},{headers:{'cache-control':'no-store'}})}
    const annualId=numberId(body.annualRepairId);
    if(action==='reuse'){return Response.json({ok:true,...await reuse(user,pm,annualId)},{headers:{'cache-control':'no-store'}})}
    if(action==='complete'){return Response.json({ok:true,...await complete(user,pm,annualId)},{headers:{'cache-control':'no-store'}})}
    return error('Unknown Annual shortcut action.');
  }catch(e){console.error(JSON.stringify({event:'trailer_pm_annual_shortcut_failed',error:String(e)}));return error(e instanceof Error?e.message:'Annual shortcut failed.')}
}
