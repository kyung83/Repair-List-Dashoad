import {env} from 'cloudflare:workers';
import {getSessionUser} from '@/lib/auth';

const LIMIT=500;
const photoUrl=(key:string)=>'/api/photos/'+key.split('/').map(encodeURIComponent).join('/');
export async function GET(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)return Response.json({error:'Authentication required.'},{status:401});
  if(user.role!=='manager'&&user.role!=='admin')return Response.json({error:'Manager or administrator access required.'},{status:403});
  const p=new URL(request.url).searchParams;
  const id=Number(p.get('id')),kind=p.get('kind');
  if(!Number.isSafeInteger(id)||id<=0||!['repair','historical','breakdown'].includes(kind||''))return Response.json({error:'Invalid report record.'},{status:400});
  const db=env.DB;
  try{
    if(kind==='historical'){
      const historical=await db.prepare(`SELECT h.id,h.ro_number,h.ro_date,e.unit,h.location,h.source_status,h.parts_cost,h.labor_cost,h.sublet_cost,h.total_cost,h.labor_hours FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id WHERE h.id=?`).bind(id).first();
      if(!historical)return Response.json({error:'Historical repair order not found.'},{status:404});
      const lines=await db.prepare(`SELECT major_category,system_code,assembly_code,vmrs_description,labor_hours,labor_cost,parts_cost,sublet_cost,total_cost FROM historical_repair_lines WHERE historical_repair_id=? ORDER BY id LIMIT ${LIMIT+1}`).bind(id).all();
      return Response.json({historical,lines:lines.results.slice(0,LIMIT),truncated:lines.results.length>LIMIT},{headers:{'cache-control':'no-store'}});
    }
    let repairId=id;
    if(kind==='breakdown'){
      const link=await db.prepare('SELECT repair_id FROM roadside_breakdowns WHERE id=?').bind(id).first<{repair_id:number}>();
      if(!link)return Response.json({error:'Breakdown not found.'},{status:404});
      repairId=link.repair_id;
    }
    const repair=await db.prepare(`SELECT r.id,r.equipment_id,COALESCE(e.unit,'') AS unit,r.title,r.description,r.status,r.source,r.location,r.opened_at,r.completed_at,r.review_note,r.parts_text,r.geotab_defect_id,r.labor_hours,r.labor_rate,r.outside_cost,COALESCE(t.name,'') AS assigned_technician FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id LEFT JOIN technicians t ON t.id=r.technician_id WHERE r.id=? AND COALESCE(r.source,'')<>'cutover-archive'`).bind(repairId).first();
    if(!repair)return Response.json({error:'Repair not found.'},{status:404});
    const [notes,parts,labor,photos,driverPhotos,breakdown,events]=await Promise.all([
      db.prepare(`SELECT e.id,e.detail,e.created_at,COALESCE(t.name,'Technician') AS technician FROM repair_job_events e LEFT JOIN technicians t ON t.id=e.technician_id WHERE e.repair_id=? AND e.action='technician_note' ORDER BY e.created_at,e.id LIMIT ${LIMIT+1}`).bind(repairId).all(),
      db.prepare(`SELECT p.part_number,p.description,rp.quantity,rp.unit_cost AS recorded_unit_cost,COALESCE(rp.unit_cost,p.unit_cost) AS reporting_unit_cost,COALESCE(rp.source_type,'stock') AS source_type,rp.quantity*COALESCE(rp.unit_cost,p.unit_cost) AS reporting_line_cost FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=? ORDER BY rp.id LIMIT ${LIMIT+1}`).bind(repairId).all(),
      db.prepare(`SELECT COALESCE(t.name,'Shop labor') AS technician,l.labor_date,l.hours,l.rate,l.hours*l.rate AS amount,l.notes,l.started_at,l.ended_at FROM repair_labor_entries l LEFT JOIN technicians t ON t.id=l.technician_id WHERE l.repair_id=? ORDER BY l.labor_date,l.id LIMIT ${LIMIT+1}`).bind(repairId).all(),
      db.prepare(`SELECT object_key,file_name,content_type,note,created_at FROM repair_work_photos WHERE repair_id=? ORDER BY id LIMIT ${LIMIT+1}`).bind(repairId).all<{object_key:string;file_name:string;content_type:string;note:string;created_at:string}>(),
      db.prepare(`SELECT object_key,file_name,content_type FROM attachments WHERE repair_id=? AND object_key LIKE 'roadside-breakdowns/%' ORDER BY id LIMIT ${LIMIT+1}`).bind(repairId).all<{object_key:string;file_name:string;content_type:string}>(),
      db.prepare(`SELECT id,repair_category,repair_needed,description,driver_name,service_provider,city,state,created_at,claimed_at,on_location_at,tech_arrived_at,repair_finished_at,rolling_at,rolling_confirmation_source,closeout_notes,closeout_invoice_number,closeout_invoice_date,status,stage FROM roadside_breakdowns WHERE repair_id=? ${kind==='breakdown'?'AND id=?':''} ORDER BY id LIMIT 1`).bind(...(kind==='breakdown'?[repairId,id]:[repairId])).first<{id:number;stage:number;status:string}>(),
      db.prepare(`SELECT action,detail,created_at FROM repair_job_events WHERE repair_id=? AND action IN ('breakdown_rolling_confirmed','breakdown_rolling_rejected','breakdown_closeout_corrected','breakdown_equipment_corrected') ORDER BY created_at,id LIMIT ${LIMIT+1}`).bind(repairId).all(),
    ]);
    const receipt=breakdown?await db.prepare(`SELECT id,reviewed_vendor,reviewed_invoice_number,reviewed_invoice_date,reviewed_total_amount,reviewed_service_summary FROM roadside_breakdown_receipts WHERE breakdown_id=?`).bind(breakdown.id).first<{id:number}>():null;
    const pages=receipt?await db.prepare('SELECT page_order,file_name,content_type FROM roadside_breakdown_receipt_pages WHERE receipt_id=? ORDER BY page_order LIMIT 101').bind(receipt.id).all<{page_order:number;file_name:string;content_type:string}>():null;
    return Response.json({repair,breakdown,receipt,notes:notes.results.slice(0,LIMIT),parts:parts.results.slice(0,LIMIT),labor:labor.results.slice(0,LIMIT),events:events.results.slice(0,LIMIT),
      photos:[...photos.results.slice(0,LIMIT),...driverPhotos.results.slice(0,LIMIT)].filter(x=>x.object_key.startsWith('repair-work/')||x.object_key.startsWith('roadside-breakdowns/')).map(x=>({...x,url:photoUrl(x.object_key)})),
      receiptPages:pages?.results.slice(0,100).map(x=>({...x,url:'/api/breakdowns/receipts/file?receiptId='+receipt!.id+'&page='+x.page_order}))??[],
      truncated:[notes,parts,labor,photos,driverPhotos,events].some(x=>x.results.length>LIMIT)||Boolean(pages&&pages.results.length>100)
    },{headers:{'cache-control':'no-store'}});
  }catch(error){console.error(JSON.stringify({event:'report_center_detail_failed',error:String(error)}));return Response.json({error:'Record details could not be loaded.'},{status:500,headers:{'cache-control':'no-store'}});}
}
