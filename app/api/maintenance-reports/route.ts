import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type EventType = 'pm' | 'annual';
type HeaderRow = {
  run_id: number; repair_id: number; event_type: EventType; checklist_status: string; repair_status: string;
  started_at: string; ready_at: string | null; completed_at: string | null;
  mileage_at_start: number | null; mileage_at_completion: number | null; mileage_source: string | null;
  signature_strokes: string | null; signed_at: string | null; pm_brake_notes: string | null; pm_comments: string | null; pm_tire_data_json: string | null;
  unit: string; vin: string | null; license_plate: string | null; license_state: string | null; model_year: number | null; make: string | null; model: string | null;
  equipment_type: string | null; category: string | null; location: string; inspector_name: string | null;
};
type ItemRow = { item_number:number; section:string; item_text:string; result:'pending'|'pass'|'fail'|'na'; notes:string|null; corrective_repair_id:number|null; corrective_status:string|null; corrective_completed_at:string|null };
type Point={x:number;y:number};

function repairId(value:unknown){const match=String(value??'').match(/^(?:repair-)?(\d+)$/);const id=match?Number(match[1]):0;if(!Number.isInteger(id)||id<=0)throw new Error('Maintenance inspection was not found.');return id}
async function requireUser(request:Request){const user=await getSessionUser(env.DB,request);if(!user)throw new Error('Authentication required.');return user}
function parseJson<T>(value:string|null,fallback:T):T{if(!value)return fallback;try{return JSON.parse(value) as T}catch{return fallback}}

export async function GET(request:Request){
  try{
    await requireUser(request);
    const id=repairId(new URL(request.url).searchParams.get('repairId'));
    const row=await env.DB.prepare(`
      SELECT c.id AS run_id, c.repair_id, c.event_type, c.status AS checklist_status,
             COALESCE(r.status,'') AS repair_status, c.started_at, c.ready_at, c.completed_at,
             c.mileage_at_start, c.mileage_at_completion, c.mileage_source,
             c.signature_strokes, c.signed_at, c.pm_brake_notes, c.pm_comments, c.pm_tire_data_json,
             COALESCE(e.unit,'') AS unit, e.vin, e.license_plate, e.license_state,
             e.model_year, e.make, e.model, e.equipment_type, e.category,
             COALESCE(NULLIF(r.location,''), NULLIF(e.location,''), '') AS location,
             COALESCE(ts.name, us.display_name, tr.name, ur.display_name, '') AS inspector_name
      FROM maintenance_checklist_runs c
      JOIN repairs r ON r.id=c.repair_id
      JOIN equipment e ON e.id=c.equipment_id
      LEFT JOIN app_users us ON us.id=c.signed_by_user_id
      LEFT JOIN technicians ts ON ts.id=us.technician_id
      LEFT JOIN app_users ur ON ur.id=COALESCE(c.ready_by_user_id,c.started_by_user_id)
      LEFT JOIN technicians tr ON tr.id=ur.technician_id
      WHERE c.repair_id=? AND c.event_type IN ('pm','annual')
      LIMIT 1
    `).bind(id).first<HeaderRow>();
    if(!row)throw new Error('Maintenance inspection was not found.');
    if(row.checklist_status!=='ready'&&row.checklist_status!=='completed')throw new Error('Finish and sign the PM/Annual inspection before printing the truck copy.');
    const items=await env.DB.prepare(`
      SELECT i.item_number,i.section,i.item_text,i.result,i.notes,
             cr.id AS corrective_repair_id,cr.status AS corrective_status,cr.completed_at AS corrective_completed_at
      FROM maintenance_checklist_items i
      LEFT JOIN repairs cr ON cr.maintenance_checklist_item_id=i.id AND cr.source='maintenance-checklist'
      WHERE i.checklist_run_id=? ORDER BY i.item_number
    `).bind(row.run_id).all<ItemRow>();
    if(items.results.some(item=>item.result==='pending'||item.result==='fail'))throw new Error('The stored inspection still contains an unresolved item and cannot be printed as final.');
    return Response.json({
      reportNumber:`NLW-${row.event_type==='annual'?'ANNUAL':'PM'}-${String(row.run_id).padStart(6,'0')}`,
      runId:row.run_id,repairId:`repair-${row.repair_id}`,eventType:row.event_type,startedAt:row.started_at,readyAt:row.ready_at??'',completedAt:row.completed_at??'',inspectionDate:String(row.completed_at??row.ready_at??row.started_at).slice(0,10),
      inspector:row.inspector_name??'',signedAt:row.signed_at??row.ready_at??row.completed_at??'',signatureStrokes:parseJson<Point[][]>(row.signature_strokes,[]),
      vehicle:{unit:row.unit,vin:row.vin??'',plate:row.license_plate??'',plateState:row.license_state??'',year:row.model_year,make:row.make??'',model:row.model??'',type:row.equipment_type??'',category:row.category??'',location:row.location,odometer:row.mileage_at_completion??row.mileage_at_start,mileageSource:row.mileage_source??''},
      pmDetails:{brakeNotes:row.pm_brake_notes??'',comments:row.pm_comments??'',tireData:parseJson<Record<string,string>>(row.pm_tire_data_json,{})},
      items:items.results.map(item=>({number:item.item_number,section:item.section,text:item.item_text,result:item.result,notes:item.notes??'',hadRepair:item.corrective_repair_id!=null,correctiveRepair:item.corrective_repair_id==null?null:{id:`repair-${item.corrective_repair_id}`,status:item.corrective_status??'',completedAt:item.corrective_completed_at??''}})),
    },{headers:{'cache-control':'no-store'}});
  }catch(error){console.error(JSON.stringify({event:'maintenance_report_failed',error:String(error)}));return Response.json({error:error instanceof Error?error.message:'Maintenance report could not be loaded.'},{status:400})}
}
