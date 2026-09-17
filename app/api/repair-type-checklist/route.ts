import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type RepairRow={
  id:number;equipment_id:number|null;technician_id:number|null;status:string;source:string;location:string;unit:string;
  repair_type_id:number|null;repair_type_name:string|null;checklist_mode:'none'|'optional'|'required'|null;
};
type RunRow={id:number;repair_id:number;equipment_id:number;repair_type_id:number;template_id:number;template_version:number;status:'in_progress'|'completed';started_at:string;completed_at:string|null};
type ItemRow={
  id:number;item_number:number;section:string;item_text:string;result:'pending'|'pass'|'fail'|'na';notes:string|null;
  allow_pass:number;allow_fail:number;allow_na:number;require_notes:number;require_photo:number;require_measurement:number;
  measurement_label:string|null;measurement_unit:string|null;measurement_value:string|null;corrective_repair_id:number|null;updated_at:string;
};
type PhotoRow={id:number;checklist_item_id:number;object_key:string;file_name:string|null;content_type:string|null;created_at:string};

type TemplateItem={
  position:number;section:string;item_text:string;enabled:number;allow_pass:number;allow_fail:number;allow_na:number;
  require_notes:number;require_photo:number;require_measurement:number;measurement_label:string|null;measurement_unit:string|null;
};

function numericRepairId(value:unknown){const match=String(value??'').match(/^(?:repair-)?(\d+)$/);const id=match?Number(match[1]):0;if(!Number.isInteger(id)||id<=0)throw new Error('Repair was not found.');return id}
function canManage(user:AppUser){return user.role==='manager'||user.role==='admin'}
function completed(status:string){return status.toLowerCase().includes('complete')}
function photoUrl(key:string){return `/api/photos/${key.split('/').map(encodeURIComponent).join('/')}`}

async function requireUser(request:Request){const user=await getSessionUser(env.DB,request);if(!user)throw new Error('Authentication required.');return user}

async function loadRepair(id:number){
  const row=await env.DB.prepare(`
    SELECT r.id,r.equipment_id,r.technician_id,COALESCE(r.status,'') AS status,COALESCE(r.source,'manual') AS source,
           COALESCE(r.location,'') AS location,COALESCE(e.unit,'') AS unit,r.repair_type_id,
           rt.name AS repair_type_name,rt.checklist_mode
    FROM repairs r
    LEFT JOIN equipment e ON e.id=r.equipment_id
    LEFT JOIN repair_types rt ON rt.id=r.repair_type_id
    WHERE r.id=?
  `).bind(id).first<RepairRow>();
  if(!row)throw new Error('Repair was not found.');
  return row;
}

function requireWorkAccess(user:AppUser,repair:RepairRow){
  if(canManage(user))return;
  if(user.role!=='mechanic'||!user.technicianId||Number(repair.technician_id??0)!==Number(user.technicianId))throw new Error('This repair is not assigned to you.');
}

async function activeTemplate(repairTypeId:number){
  const template=await env.DB.prepare(`
    SELECT id,name,version FROM repair_type_checklist_templates
    WHERE repair_type_id=? AND active=1 ORDER BY version DESC LIMIT 1
  `).bind(repairTypeId).first<{id:number;name:string;version:number}>();
  if(!template)return null;
  const items=await env.DB.prepare(`
    SELECT position,section,item_text,enabled,allow_pass,allow_fail,allow_na,
           require_notes,require_photo,require_measurement,measurement_label,measurement_unit
    FROM repair_type_checklist_template_items
    WHERE template_id=? AND enabled=1 ORDER BY position
  `).bind(template.id).all<TemplateItem>();
  return {...template,items:items.results};
}

async function loadRun(repairId:number){
  return env.DB.prepare(`
    SELECT id,repair_id,equipment_id,repair_type_id,template_id,template_version,status,started_at,completed_at
    FROM repair_type_checklist_runs WHERE repair_id=?
  `).bind(repairId).first<RunRow>();
}

async function ensureRun(user:AppUser,repair:RepairRow){
  requireWorkAccess(user,repair);
  if(completed(repair.status))throw new Error('That repair is already completed.');
  if(!repair.repair_type_id||!repair.repair_type_name||repair.checklist_mode==='none'||!repair.checklist_mode)throw new Error('This repair type does not use a checklist.');
  if(!repair.equipment_id)throw new Error('Checklist work must be attached to a unit.');
  const existing=await loadRun(repair.id);if(existing)return existing;
  const template=await activeTemplate(repair.repair_type_id);
  if(!template)throw new Error(`${repair.repair_type_name} requires a checklist, but no checklist has been published in Setup → Repair Types.`);
  if(!template.items.length)throw new Error('The published checklist has no enabled items.');
  await env.DB.prepare(`
    INSERT OR IGNORE INTO repair_type_checklist_runs(
      repair_id,equipment_id,repair_type_id,template_id,template_version,status,started_by_user_id,started_at,updated_at
    ) VALUES(?,?,?,?,?,'in_progress',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `).bind(repair.id,repair.equipment_id,repair.repair_type_id,template.id,template.version,user.id).run();
  const run=await loadRun(repair.id);if(!run)throw new Error('Checklist could not be started.');
  await env.DB.prepare(`
    INSERT OR IGNORE INTO repair_type_checklist_items(
      checklist_run_id,item_number,section,item_text,result,allow_pass,allow_fail,allow_na,
      require_notes,require_photo,require_measurement,measurement_label,measurement_unit,updated_at
    )
    SELECT ?,position,section,item_text,'pending',allow_pass,allow_fail,allow_na,
           require_notes,require_photo,require_measurement,measurement_label,measurement_unit,CURRENT_TIMESTAMP
    FROM repair_type_checklist_template_items
    WHERE template_id=? AND enabled=1 ORDER BY position
  `).bind(run.id,run.template_id).run();
  return run;
}

async function payloadFor(repair:RepairRow){
  const available=Boolean(repair.repair_type_id&&repair.repair_type_name&&repair.checklist_mode&&repair.checklist_mode!=='none');
  if(!available)return {available:false,repairId:`repair-${repair.id}`};
  const template=await activeTemplate(Number(repair.repair_type_id));
  const run=await loadRun(repair.id);
  if(!run){
    return {
      available:true,configured:Boolean(template),required:repair.checklist_mode==='required',checklistMode:repair.checklist_mode,
      repairId:`repair-${repair.id}`,repairTypeId:repair.repair_type_id,repairType:repair.repair_type_name,equipmentId:repair.equipment_id,unit:repair.unit,
      started:false,status:'not_started',templateName:template?.name??'',templateVersion:template?.version??null,
      items:(template?.items??[]).map(item=>({
        id:null,number:item.position,section:item.section,text:item.item_text,result:'pending',notes:'',measurementValue:'',correctiveRepair:null,photos:[],
        allowPass:Boolean(item.allow_pass),allowFail:Boolean(item.allow_fail),allowNa:Boolean(item.allow_na),
        requireNotes:Boolean(item.require_notes),requirePhoto:Boolean(item.require_photo),requireMeasurement:Boolean(item.require_measurement),
        measurementLabel:item.measurement_label??'',measurementUnit:item.measurement_unit??'',
      })),
    };
  }
  const [itemsResult,photosResult]=await Promise.all([
    env.DB.prepare(`
      SELECT id,item_number,section,item_text,result,notes,allow_pass,allow_fail,allow_na,
             require_notes,require_photo,require_measurement,measurement_label,measurement_unit,measurement_value,corrective_repair_id,updated_at
      FROM repair_type_checklist_items WHERE checklist_run_id=? ORDER BY item_number
    `).bind(run.id).all<ItemRow>(),
    env.DB.prepare(`SELECT id,checklist_item_id,object_key,file_name,content_type,created_at FROM repair_type_checklist_photos WHERE checklist_run_id=? ORDER BY created_at,id`).bind(run.id).all<PhotoRow>(),
  ]);
  const photosByItem=new Map<number,PhotoRow[]>();
  for(const photo of photosResult.results){const current=photosByItem.get(photo.checklist_item_id)??[];current.push(photo);photosByItem.set(photo.checklist_item_id,current)}
  const correctiveIds=itemsResult.results.map(item=>item.corrective_repair_id).filter((id):id is number=>id!==null);
  const correctiveStatus=new Map<number,string>();
  if(correctiveIds.length){
    const placeholders=correctiveIds.map(()=>'?').join(',');
    const rows=await env.DB.prepare(`SELECT id,COALESCE(status,'') AS status FROM repairs WHERE id IN (${placeholders})`).bind(...correctiveIds).all<{id:number;status:string}>();
    for(const row of rows.results)correctiveStatus.set(row.id,row.status);
  }
  const items=itemsResult.results.map(item=>({
    id:item.id,number:item.item_number,section:item.section,text:item.item_text,result:item.result,notes:item.notes??'',measurementValue:item.measurement_value??'',updatedAt:item.updated_at,
    allowPass:Boolean(item.allow_pass),allowFail:Boolean(item.allow_fail),allowNa:Boolean(item.allow_na),
    requireNotes:Boolean(item.require_notes),requirePhoto:Boolean(item.require_photo),requireMeasurement:Boolean(item.require_measurement),
    measurementLabel:item.measurement_label??'',measurementUnit:item.measurement_unit??'',
    correctiveRepair:item.corrective_repair_id?{id:`repair-${item.corrective_repair_id}`,status:correctiveStatus.get(item.corrective_repair_id)??''}:null,
    photos:(photosByItem.get(item.id)??[]).map(photo=>({id:photo.id,fileName:photo.file_name??'Photo',contentType:photo.content_type??'',createdAt:photo.created_at,url:photoUrl(photo.object_key)})),
  }));
  return {
    available:true,configured:true,required:repair.checklist_mode==='required',checklistMode:repair.checklist_mode,
    repairId:`repair-${repair.id}`,repairTypeId:repair.repair_type_id,repairType:repair.repair_type_name,equipmentId:repair.equipment_id,unit:repair.unit,
    started:true,runId:run.id,status:run.status,startedAt:run.started_at,completedAt:run.completed_at,templateVersion:run.template_version,
    pendingCount:items.filter(item=>item.result==='pending').length,failedCount:items.filter(item=>item.result==='fail').length,items,
  };
}

async function syncCorrectiveRepair(user:AppUser,repair:RepairRow,item:ItemRow,result:string,notes:string){
  const label=repair.repair_type_name||'Inspection';
  if(result==='fail'){
    const title=`${label} checklist #${item.item_number} failed: ${item.item_text}${notes?` - ${notes}`:''}`.slice(0,500);
    let childId=item.corrective_repair_id;
    if(!childId){
      const inserted=await env.DB.prepare(`
        INSERT INTO repairs(equipment_id,title,description,status,priority,source,location,technician_id,updated_at)
        VALUES(?,?,?,'Open','2','repair-type-checklist',?,?,CURRENT_TIMESTAMP)
      `).bind(repair.equipment_id,title,notes||null,repair.location,repair.technician_id).run();
      childId=Number(inserted.meta.last_row_id);
      if(!childId)throw new Error('Corrective repair could not be created.');
      await env.DB.prepare('UPDATE repair_type_checklist_items SET corrective_repair_id=? WHERE id=?').bind(childId,item.id).run();
      await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'created_from_repair_type_checklist',?)`)
        .bind(childId,user.id,repair.technician_id,`${label} checklist item #${item.item_number} failed on Unit ${repair.unit}.`.slice(0,500)).run();
    }else{
      await env.DB.prepare(`
        UPDATE repairs SET title=?,description=?,status=CASE WHEN lower(COALESCE(status,'')) LIKE '%complete%' THEN 'Open' ELSE status END,
          completed_at=CASE WHEN lower(COALESCE(status,'')) LIKE '%complete%' THEN NULL ELSE completed_at END,
          technician_id=COALESCE(technician_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(title,notes||null,repair.technician_id,childId).run();
    }
    return;
  }
  if(item.result==='fail'&&item.corrective_repair_id&&(result==='pass'||result==='na')){
    const closed=await env.DB.prepare(`
      UPDATE repairs SET status='Completed',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    `).bind(item.corrective_repair_id).run();
    if(Number(closed.meta.changes??0)>0){
      await env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'completed_from_repair_type_checklist',?)`)
        .bind(item.corrective_repair_id,user.id,repair.technician_id,`Checklist item #${item.item_number} changed from Fail to ${result==='pass'?'Pass':'N/A'}.`).run();
    }
  }
}

async function validateRun(runId:number){
  const row=await env.DB.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN result='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN require_notes=1 AND result<>'pending' AND trim(COALESCE(notes,''))='' THEN 1 ELSE 0 END) AS missing_notes,
      SUM(CASE WHEN require_measurement=1 AND result<>'pending' AND trim(COALESCE(measurement_value,''))='' THEN 1 ELSE 0 END) AS missing_measurement,
      SUM(CASE WHEN require_photo=1 AND result<>'pending' AND NOT EXISTS(SELECT 1 FROM repair_type_checklist_photos p WHERE p.checklist_item_id=repair_type_checklist_items.id) THEN 1 ELSE 0 END) AS missing_photo
    FROM repair_type_checklist_items WHERE checklist_run_id=?
  `).bind(runId).first<{total:number;pending:number;failed:number;missing_notes:number;missing_measurement:number;missing_photo:number}>();
  if(Number(row?.total??0)<=0)throw new Error('This checklist has no inspection items.');
  if(Number(row?.pending??0)>0)throw new Error('Finish every checklist item first.');
  if(Number(row?.failed??0)>0)throw new Error('Failed items must be repaired and changed to Pass before completing this checklist.');
  if(Number(row?.missing_notes??0)>0)throw new Error('Add the required notes before completing this checklist.');
  if(Number(row?.missing_measurement??0)>0)throw new Error('Enter the required measurements before completing this checklist.');
  if(Number(row?.missing_photo??0)>0)throw new Error('Add the required photos before completing this checklist.');
}

export async function GET(request:Request){
  try{
    const user=await requireUser(request),id=numericRepairId(new URL(request.url).searchParams.get('repairId')),repair=await loadRepair(id);
    requireWorkAccess(user,repair);
    return Response.json(await payloadFor(repair),{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Repair checklist could not be loaded.'},{status:400})}
}

export async function POST(request:Request){
  try{
    const user=await requireUser(request);
    const contentType=request.headers.get('content-type')??'';
    let body:Record<string,unknown>={},form:FormData|null=null;
    if(contentType.includes('multipart/form-data')){form=await request.formData();for(const [key,value] of form.entries())if(typeof value==='string')body[key]=value}else body=await request.json() as Record<string,unknown>;
    const id=numericRepairId(body.repairId),repair=await loadRepair(id);requireWorkAccess(user,repair);
    const action=String(body.action??'');

    if(action==='startChecklist'){
      await ensureRun(user,repair);
      return Response.json({ok:true,...await payloadFor(repair)});
    }

    if(action==='setItem'){
      const run=await ensureRun(user,repair);if(run.status==='completed')throw new Error('Completed checklists cannot be changed.');
      const itemNumber=Number(body.itemNumber??0),result=String(body.result??'');
      if(!Number.isInteger(itemNumber)||itemNumber<=0)throw new Error('Checklist item was not found.');
      if(!['pending','pass','fail','na'].includes(result))throw new Error('Choose Pass, Fail, or N/A.');
      const notes=String(body.notes??'').trim().slice(0,1000),measurement=String(body.measurement??'').trim().slice(0,120);
      const item=await env.DB.prepare(`
        SELECT id,item_number,section,item_text,result,notes,allow_pass,allow_fail,allow_na,require_notes,require_photo,require_measurement,
               measurement_label,measurement_unit,measurement_value,corrective_repair_id,updated_at
        FROM repair_type_checklist_items WHERE checklist_run_id=? AND item_number=?
      `).bind(run.id,itemNumber).first<ItemRow>();
      if(!item)throw new Error('Checklist item was not found.');
      if(result==='pass'&&!item.allow_pass)throw new Error('Pass is not allowed for this checklist item.');
      if(result==='fail'&&!item.allow_fail)throw new Error('Fail is not allowed for this checklist item.');
      if(result==='na'&&!item.allow_na)throw new Error('N/A is not allowed for this checklist item.');
      if(result==='fail'&&!notes)throw new Error('Add a note explaining the failed item.');
      if(result!=='pending'&&item.require_notes&&!notes)throw new Error('A note is required for this checklist item.');
      if(result!=='pending'&&item.require_measurement&&!measurement)throw new Error('A measurement is required for this checklist item.');
      if(result!=='pending'&&item.require_photo){const photo=await env.DB.prepare('SELECT id FROM repair_type_checklist_photos WHERE checklist_item_id=? LIMIT 1').bind(item.id).first<{id:number}>();if(!photo)throw new Error('A photo is required for this checklist item.');}
      await syncCorrectiveRepair(user,repair,item,result,notes);
      await env.DB.prepare(`
        UPDATE repair_type_checklist_items SET result=?,notes=?,measurement_value=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND checklist_run_id=?
      `).bind(result,notes||null,measurement||null,user.id,item.id,run.id).run();
      return Response.json({ok:true,...await payloadFor(await loadRepair(id))});
    }

    if(action==='uploadPhoto'){
      if(!form)throw new Error('Photo upload data is missing.');
      const run=await ensureRun(user,repair);if(run.status==='completed')throw new Error('Completed checklists cannot be changed.');
      const itemNumber=Number(body.itemNumber??0);
      const item=await env.DB.prepare('SELECT id FROM repair_type_checklist_items WHERE checklist_run_id=? AND item_number=?').bind(run.id,itemNumber).first<{id:number}>();
      if(!item)throw new Error('Checklist item was not found.');
      const value=form.get('photo');if(!value||typeof value==='string')throw new Error('Choose a photo to upload.');
      const file=value as File;if(!file.size||file.size>12*1024*1024)throw new Error('Checklist photos must be between 1 byte and 12 MB.');
      if(!String(file.type||'').toLowerCase().startsWith('image/'))throw new Error('Checklist uploads must be image files.');
      const clean=String(file.name||'photo').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-120)||'photo';
      const key=`repair-type-checklists/${run.id}/${itemNumber}/${crypto.randomUUID()}-${clean}`;
      await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});
      try{await env.DB.prepare(`INSERT INTO repair_type_checklist_photos(checklist_run_id,checklist_item_id,object_key,file_name,content_type,uploaded_by_user_id) VALUES(?,?,?,?,?,?)`).bind(run.id,item.id,key,file.name||clean,file.type||null,user.id).run()}catch(error){await env.FILES.delete(key);throw error}
      return Response.json({ok:true,...await payloadFor(repair)});
    }

    if(action==='removePhoto'){
      const run=await ensureRun(user,repair);if(run.status==='completed')throw new Error('Completed checklists cannot be changed.');
      const photoId=Number(body.photoId??0);
      const photo=await env.DB.prepare(`SELECT id,checklist_item_id,object_key FROM repair_type_checklist_photos WHERE id=? AND checklist_run_id=?`).bind(photoId,run.id).first<{id:number;checklist_item_id:number;object_key:string}>();
      if(!photo)throw new Error('Checklist photo was not found.');
      const item=await env.DB.prepare('SELECT result,require_photo FROM repair_type_checklist_items WHERE id=?').bind(photo.checklist_item_id).first<{result:string;require_photo:number}>();
      if(item?.require_photo&&item.result!=='pending'){
        const other=await env.DB.prepare('SELECT id FROM repair_type_checklist_photos WHERE checklist_item_id=? AND id<>? LIMIT 1').bind(photo.checklist_item_id,photoId).first<{id:number}>();
        if(!other)throw new Error('This answered item requires a photo. Add another photo or change the answer first.');
      }
      await env.DB.prepare('DELETE FROM repair_type_checklist_photos WHERE id=?').bind(photoId).run();
      try{await env.FILES.delete(photo.object_key)}catch(error){console.error(JSON.stringify({event:'repair_type_checklist_orphaned_photo',photoId,error:String(error)}))}
      return Response.json({ok:true,...await payloadFor(repair)});
    }

    if(action==='completeChecklist'){
      const run=await ensureRun(user,repair);if(run.status==='completed')return Response.json({ok:true,...await payloadFor(repair)});
      await validateRun(run.id);
      await env.DB.batch([
        env.DB.prepare(`UPDATE repair_type_checklist_runs SET status='completed',completed_by_user_id=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(user.id,run.id),
        env.DB.prepare(`INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'repair_type_checklist_completed',?)`).bind(repair.id,user.id,repair.technician_id,`${repair.repair_type_name||'Repair'} checklist completed by ${user.displayName}.`.slice(0,500)),
      ]);
      return Response.json({ok:true,...await payloadFor(await loadRepair(id))});
    }

    return Response.json({error:'Unknown repair checklist action.'},{status:400});
  }catch(error){
    console.error(JSON.stringify({event:'repair_type_checklist_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair checklist change failed.'},{status:400});
  }
}
