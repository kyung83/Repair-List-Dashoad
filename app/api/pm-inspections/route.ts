import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type PmHeaderRow = {
  run_id:number;
  repair_id:number;
  completed_at:string|null;
  ready_at:string|null;
  mileage_at_completion:number|null;
  mileage_at_start:number|null;
  unit:string;
  vin:string|null;
  license_plate:string|null;
  license_state:string|null;
  model_year:number|null;
  make:string|null;
  model:string|null;
  location:string;
  inspector_name:string|null;
};

async function requireUser(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  return user;
}

function reportNumber(runId:number){
  return `NLW-PM-${String(runId).padStart(6,'0')}`;
}

async function listForms(unit=''){
  const result=await env.DB.prepare(`
    SELECT c.id AS run_id,c.repair_id,c.completed_at,c.ready_at,
           c.mileage_at_completion,c.mileage_at_start,
           COALESCE(e.unit,'') AS unit,e.vin,e.license_plate,e.license_state,
           e.model_year,e.make,e.model,
           COALESCE(NULLIF(r.location,''),NULLIF(e.location,''),'') AS location,
           COALESCE(ts.name,us.display_name,tr.name,ur.display_name,'') AS inspector_name
    FROM maintenance_checklist_runs c
    JOIN repairs r ON r.id=c.repair_id
    JOIN equipment e ON e.id=c.equipment_id
    LEFT JOIN app_users us ON us.id=c.signed_by_user_id
    LEFT JOIN technicians ts ON ts.id=us.technician_id
    LEFT JOIN app_users ur ON ur.id=COALESCE(c.ready_by_user_id,c.started_by_user_id)
    LEFT JOIN technicians tr ON tr.id=ur.technician_id
    WHERE c.event_type='pm'
      AND c.status='completed'
      AND r.source='scheduled-pm'
      AND lower(COALESCE(r.status,'')) LIKE '%complete%'
      AND (? = '' OR e.unit = ? COLLATE NOCASE)
    ORDER BY COALESCE(c.completed_at,c.ready_at,c.started_at) DESC,c.id DESC
    LIMIT 1000
  `).bind(unit,unit).all<PmHeaderRow>();

  return result.results.map(row=>({
    reportNumber:reportNumber(row.run_id),
    runId:Number(row.run_id),
    repairId:`repair-${row.repair_id}`,
    inspectionDate:String(row.completed_at??row.ready_at??'').slice(0,10),
    completedAt:row.completed_at??'',
    certifiedAt:row.ready_at??row.completed_at??'',
    unit:row.unit,
    vin:row.vin??'',
    plate:[row.license_plate,row.license_state].filter(Boolean).join(' / '),
    modelYear:row.model_year,
    make:row.make??'',
    model:row.model??'',
    location:row.location,
    inspector:row.inspector_name??'',
    mileage:row.mileage_at_completion==null
      ? row.mileage_at_start==null?null:Number(row.mileage_at_start)
      : Number(row.mileage_at_completion),
    printUrl:`/annual-inspections/print?repairId=${encodeURIComponent(`repair-${row.repair_id}`)}`,
  }));
}

export async function GET(request:Request){
  try{
    await requireUser(request);
    const unit=new URL(request.url).searchParams.get('unit')?.trim()??'';
    return Response.json({forms:await listForms(unit),updatedAt:new Date().toISOString()},{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'pm_inspection_get_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'PM forms could not be loaded.'},{status:400});
  }
}
