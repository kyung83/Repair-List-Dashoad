import {env} from 'cloudflare:workers';
import {getSessionUser} from '@/lib/auth';

// Only shop-created, unreviewed repairs may be reopened by their primary
// technician or the user who recorded their completion. Existing labor,
// parts and previous completion events are retained.
const eligibleRepair=[
  'r.id=?',
  "lower(trim(COALESCE(r.status,'')))='completed'",
  "lower(trim(COALESCE(r.source,'')))='manual'",
  'r.go_live_archived_at IS NULL',
  'r.reviewed_at IS NULL',
  'r.maintenance_checklist_item_id IS NULL',
  'r.maintenance_source_id IS NULL',
  "r.completed_at>=datetime('now','-90 days')",
  'NOT EXISTS (SELECT 1 FROM repair_labor_timers t WHERE t.repair_id=r.id)',
  'NOT EXISTS (SELECT 1 FROM invoices i WHERE i.repair_id=r.id)',
  'NOT EXISTS (SELECT 1 FROM invoice_repair_links irl WHERE irl.repair_id=r.id)',
  "(r.technician_id=? OR (SELECT ev.user_id FROM repair_job_events ev WHERE ev.repair_id=r.id AND ev.action='completed' ORDER BY ev.id DESC LIMIT 1)=?)",
].join(' AND ');

function problem(error:string,status=400){
  return Response.json({ok:false,error},{status,headers:{'cache-control':'no-store'}});
}
function parseRepairId(value:unknown){
  const match=/^(?:repair-)?([1-9][0-9]*)$/.exec(String(value??'').trim());
  const id=match?Number(match[1]):0;
  return Number.isSafeInteger(id)&&id>0?id:0;
}

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)return problem('Sign in again.',401);
    if(!user.technicianId||!(user.role==='mechanic'||user.role==='manager')){
      return problem('Only working technicians or linked working managers can reopen their own repairs.',403);
    }
    const body=await request.json() as Record<string,unknown>;
    const id=parseRepairId(body.repairId);
    const reason=String(body.reason??'').trim();
    if(!id)return problem('Choose a completed work order.');
    if(reason.length<8||reason.length>450)return problem('Explain why the repair must be reopened (8–450 characters).');

    // Explain any lock to the technician without changing completion or inventory.
    const repair=await env.DB.prepare(
      "SELECT r.id,r.status,r.source,r.technician_id,r.completed_at,r.reviewed_at,"+
      "r.go_live_archived_at,r.maintenance_checklist_item_id,r.maintenance_source_id,"+
      "EXISTS(SELECT 1 FROM invoices i WHERE i.repair_id=r.id) AS direct_invoice,"+
      "EXISTS(SELECT 1 FROM invoice_repair_links l WHERE l.repair_id=r.id) AS linked_invoice,"+
      "EXISTS(SELECT 1 FROM repair_labor_timers t WHERE t.repair_id=r.id) AS timer_running,"+
      "((SELECT e.user_id FROM repair_job_events e WHERE e.repair_id=r.id AND e.action='completed' ORDER BY e.id DESC LIMIT 1)=?) AS completed_by_me "+
      "FROM repairs r WHERE r.id=?"
    ).bind(user.id,id).first<{
      id:number;status:string;source:string;technician_id:number|null;completed_at:string|null;
      reviewed_at:string|null;go_live_archived_at:string|null;maintenance_checklist_item_id:number|null;
      maintenance_source_id:string|null;direct_invoice:number;linked_invoice:number;
      timer_running:number;completed_by_me:number;
    }>();
    if(!repair)return problem('This repair was not found.',404);
    if(repair.technician_id!==user.technicianId&&!repair.completed_by_me){
      return problem('Only the assigned technician or the person who completed this repair may reopen it.',403);
    }
    if(repair.reviewed_at)return problem('Management has approved this work order. Ask a manager to make the correction.',409);
    if(repair.direct_invoice||repair.linked_invoice)return problem('This repair is linked to an invoice. Ask management to make the correction.',409);
    if(repair.go_live_archived_at)return problem('Archived repairs cannot be reopened.',409);
    if(String(repair.status||'').trim().toLowerCase()!=='completed')return problem('This repair is not currently completed.',409);
    if(String(repair.source||'').trim().toLowerCase()!=='manual'||repair.maintenance_checklist_item_id||repair.maintenance_source_id){
      return problem('PM, annual, DVIR, roadside, and other externally linked repairs need management review.',409);
    }
    if(!repair.completed_at||Date.parse(repair.completed_at.replace(' ','T')+'Z')<Date.now()-90*86400000){
      return problem('Older completed repairs must be corrected through management.',409);
    }
    if(repair.timer_running)return problem('This repair has an active labor timer. Ask management to investigate.',409);

    const technicianId=Number(user.technicianId);
    const actor=String(user.displayName||user.username||'Technician').trim().slice(0,70);
    const detail=(actor+' reopened this completed repair to correct an entry: '+reason).slice(0,500);

    // D1.batch is transactional. Both statements require unchanged eligibility,
    // so a concurrent manager review, invoice or prior reopen cannot be bypassed.
    const results=await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) "+
        "SELECT r.id,?,?,'reopened_for_correction',? FROM repairs r WHERE "+eligibleRepair
      ).bind(user.id,technicianId,detail,id,technicianId,user.id),
      env.DB.prepare(
        "UPDATE repairs SET status='Open',completed_at=NULL,updated_at=CURRENT_TIMESTAMP "+
        "WHERE id IN (SELECT r.id FROM repairs r WHERE "+eligibleRepair+")"
      ).bind(id,technicianId,user.id),
    ]);
    if(Number(results[0]?.meta.changes??0)!==1||Number(results[1]?.meta.changes??0)!==1){
      return problem('This repair changed or is no longer eligible. Refresh Completed; ask a manager if it remains locked.',409);
    }
    return Response.json({ok:true,reopened:true,repairId:'repair-'+id,message:'Reopened. Existing labor, parts and the original completion are preserved. Return to My Units to add missing parts, then mark REPAIRED again.'},{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'shop_reopen_completed_failed',error:String(error)}));
    return problem('Reopening failed. No change was confirmed; refresh Completed and try again.',500);
  }
}
