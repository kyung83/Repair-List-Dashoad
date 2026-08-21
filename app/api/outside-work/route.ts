import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type EquipmentRow = {
  id:number;
  unit:string;
  vin:string|null;
  equipment_type:string;
  current_mileage:number|null;
};

type OutsideWorkRow = {
  id:number;
  equipment_id:number;
  repair_id:number;
  unit:string;
  vendor_name:string;
  invoice_number:string;
  invoice_date:string|null;
  mileage:number|null;
  total_amount:number;
  original_file_name:string;
  content_type:string;
  service_summary:string;
  created_at:string;
  uploaded_by:string;
};

type VendorRow={id:number;name:string};

const SAFE_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','image/bmp','image/tiff','image/heic','image/heif']);
const BAD_VENDOR_TEXT=/\b(?:NORTHERN\s+LOGISTICS|NORLOWORLD|SHOP\s+SUPPLIES|MISC(?:ELLANEOUS)?\s+SUPPLIES|LABOR|LABOUR|PARTS|SUBLET|PREPAY|SUB\s*TOTAL|SUBTOTAL|TAX|TOTAL|BALANCE|AMOUNT\s+DUE|ESTIMATED|BILLED|NET\s+SALE|AUTHORIZATION\s+FOR\s+REPAIRS|EXCLUSION\s+OF\s+WARRANTIES|WARRANTY|WARRANTIES|HEREBY|UNDERSIGNED|PURCHASER|MERCHANTABILITY|PARTICULAR\s+PURPOSE|CONSEQUENTIAL\s+DAMAGES|COMMERCIAL\s+LOSSES|MECHANIC'?S\s+LIEN|RESPONSIBLE\s+FOR\s+PAYMENT|PARTS\s+AND\/OR\s+ACCESSORIES|PARTS\s+OR\s+ACCESSORIES|ACCESSORIES\s+PURCHASED|PERMISSION\s+TO\s+OPERATE|UNAVAILABILITY\s+OF\s+PARTS|COMPLAINT|CAUSE|CORRECTION|WORK\s+PERFORMED|TECHNICIAN\s+COMMENTS)\b/i;

async function requireManager(request:Request):Promise<AppUser>{
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required for Outside Work Intake.');
  return user;
}

function positiveInteger(value:unknown,label:string){
  const number=Number(value);
  if(!Number.isInteger(number)||number<=0)throw new Error(`${label} is required.`);
  return number;
}

function optionalMileage(value:FormDataEntryValue|null){
  const raw=String(value??'').replace(/,/g,'').trim();
  if(!raw)return null;
  const number=Number(raw);
  if(!Number.isInteger(number)||number<0||number>10_000_000)throw new Error('Invoice mileage must be a whole number between 0 and 10,000,000.');
  return number;
}

function invoiceDate(value:FormDataEntryValue|null){
  const raw=String(value??'').trim();
  if(!raw)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw new Error('Service date must use YYYY-MM-DD.');
  const parsed=Date.parse(`${raw}T12:00:00Z`);
  if(!Number.isFinite(parsed))throw new Error('Service date is invalid.');
  return raw;
}

function cleanFileName(value:string){
  return value.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-140)||'outside-work';
}

function safeText(value:FormDataEntryValue|null,max:number){
  return String(value??'').trim().slice(0,max);
}

function normalizeVendor(value:string){
  return value
    .toUpperCase()
    .replace(/&/g,' AND ')
    .replace(/[^A-Z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .replace(/\s+(?:INCORPORATED|INC|LLC|LTD|CORPORATION|CORP|COMPANY|CO)$/,'')
    .trim();
}

function vendorSimilarity(left:string,right:string){
  const a=new Set(normalizeVendor(left).split(' ').filter(Boolean));
  const b=new Set(normalizeVendor(right).split(' ').filter(Boolean));
  if(!a.size||!b.size)return 0;
  let common=0;
  for(const token of a)if(b.has(token))common++;
  return (2*common)/(a.size+b.size);
}

function validateVendorName(value:string){
  const name=value.replace(/\s+/g,' ').trim();
  if(name.length<2)throw new Error('Review the Outside vendor field before saving.');
  if(name.length>180)throw new Error('Outside vendor name is too long.');
  const words=name.match(/[A-Za-z][A-Za-z'&.-]*/g)||[];
  if(words.length>10||/[.!?].*[.!?]/.test(name)||BAD_VENDOR_TEXT.test(name)||/\$\s*\d/.test(name)){
    throw new Error('Outside vendor looks like invoice text instead of a company name. Correct the vendor field before saving.');
  }
  return name;
}

async function resolveOrCreateVendor(value:string){
  const submitted=validateVendorName(value);
  const key=normalizeVendor(submitted);
  if(key.length<2)throw new Error('Review the Outside vendor field before saving.');

  const result=await env.DB.prepare(`
    SELECT id,name FROM vendors WHERE COALESCE(active,1)=1 ORDER BY name,id
  `).all<VendorRow>();
  const exact=result.results.filter(row=>normalizeVendor(row.name)===key);
  if(exact.length===1)return{id:Number(exact[0].id),name:exact[0].name,created:false};
  if(exact.length>1)throw new Error('More than one active vendor has that name. Correct the vendor master before saving this Outside Work record.');

  const similar=result.results
    .map(row=>({row,score:vendorSimilarity(submitted,row.name)}))
    .filter(item=>item.score>=0.72)
    .sort((a,b)=>b.score-a.score)
    .slice(0,3);
  if(similar.length){
    throw new Error(`Outside vendor is similar to an existing vendor: ${similar.map(item=>item.row.name).join(', ')}. Use the existing vendor name if it is the same company; otherwise change the name enough to identify the new road vendor.`);
  }

  const inserted=await env.DB.prepare(`
    INSERT INTO vendors (name,notes,supplier_type,active)
    VALUES (?,?,'Outside Work / Road Repair',1)
  `).bind(submitted,'Created from a reviewed Outside Work invoice. May be a one-time over-the-road repair vendor.').run();
  const id=Number(inserted.meta.last_row_id??0);
  if(!id)throw new Error('The new Outside Work vendor could not be created.');
  return{id,name:submitted,created:true};
}

async function sha256Hex(bytes:ArrayBuffer){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function originalUrl(id:number){return `/api/outside-work?fileId=${id}`;}

export async function GET(request:Request){
  try{
    await requireManager(request);
    const url=new URL(request.url);
    const fileId=Number(url.searchParams.get('fileId')??0);
    if(Number.isInteger(fileId)&&fileId>0){
      const row=await env.DB.prepare(`
        SELECT id,object_key,original_file_name,content_type
        FROM outside_work_documents WHERE id=?
      `).bind(fileId).first<{id:number;object_key:string;original_file_name:string;content_type:string}>();
      if(!row)return new Response('Outside-work document not found.',{status:404});
      const object=await env.FILES.get(row.object_key);
      if(!object)return new Response('Original outside-work document is missing from file storage.',{status:404});
      const headers=new Headers();
      object.writeHttpMetadata(headers);
      headers.set('content-type',row.content_type||headers.get('content-type')||'application/octet-stream');
      headers.set('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.original_file_name||'outside-work')}`);
      headers.set('x-content-type-options','nosniff');
      headers.set('cache-control','private, no-store');
      return new Response(object.body,{headers});
    }

    const[equipmentResult,documentsResult]=await Promise.all([
      env.DB.prepare(`
        SELECT id,unit,vin,equipment_type,current_mileage
        FROM equipment
        WHERE active=1 AND archived_at IS NULL AND merged_into_equipment_id IS NULL
        ORDER BY unit
      `).all<EquipmentRow>(),
      env.DB.prepare(`
        SELECT d.id,d.equipment_id,d.repair_id,e.unit,d.vendor_name,d.invoice_number,d.invoice_date,
               d.mileage,d.total_amount,d.original_file_name,d.content_type,d.service_summary,d.created_at,
               COALESCE(NULLIF(u.display_name,''),NULLIF(u.username,''),'') AS uploaded_by
        FROM outside_work_documents d
        JOIN equipment e ON e.id=d.equipment_id
        LEFT JOIN app_users u ON u.id=d.uploaded_by_user_id
        ORDER BY d.created_at DESC,d.id DESC
        LIMIT 100
      `).all<OutsideWorkRow>(),
    ]);

    return Response.json({
      equipment:equipmentResult.results.map(row=>({
        id:row.id,unit:row.unit,vin:row.vin??'',equipmentType:row.equipment_type,currentMileage:row.current_mileage,
      })),
      records:documentsResult.results.map(row=>({
        id:row.id,equipmentId:row.equipment_id,repairId:`repair-${row.repair_id}`,unit:row.unit,
        vendorName:row.vendor_name,invoiceNumber:row.invoice_number,invoiceDate:row.invoice_date??'',
        mileage:row.mileage,totalAmount:Number(row.total_amount||0),fileName:row.original_file_name,
        contentType:row.content_type,serviceSummary:row.service_summary,createdAt:row.created_at,
        uploadedBy:row.uploaded_by,originalUrl:originalUrl(row.id),
      })),
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Outside Work Intake could not be loaded.';
    const status=message==='Authentication required.'?401:message.includes('Manager or administrator')?403:500;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request:Request){
  let objectKey='';
  let repairId=0;
  try{
    const user=await requireManager(request);
    const form=await request.formData();
    const fileValue=form.get('file');
    if(!(fileValue instanceof File))throw new Error('Choose the outside-work invoice or work-order file.');
    const file=fileValue;
    if(!file.size||file.size>15*1024*1024)throw new Error('Outside-work files must be between 1 byte and 15 MB.');
    const originalName=cleanFileName(file.name||'outside-work');
    const lowerName=originalName.toLowerCase();
    const suppliedType=String(file.type||'').toLowerCase();
    const isPdf=suppliedType==='application/pdf'||lowerName.endsWith('.pdf');
    const imageExtension=/\.(?:jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(lowerName);
    const isImage=SAFE_IMAGE_TYPES.has(suppliedType)||(!suppliedType&&imageExtension);
    if(!isPdf&&!isImage)throw new Error('Upload a PDF or common photo/image file. SVG and HTML files are not accepted.');
    const contentType=isPdf?'application/pdf':suppliedType||'application/octet-stream';

    const equipmentId=positiveInteger(form.get('equipmentId'),'Master Equipment unit');
    const equipment=await env.DB.prepare(`
      SELECT id,unit FROM equipment
      WHERE id=? AND active=1 AND archived_at IS NULL AND merged_into_equipment_id IS NULL
    `).bind(equipmentId).first<{id:number;unit:string}>();
    if(!equipment)throw new Error('The selected Master Equipment unit is not active or no longer exists.');

    const vendor=await resolveOrCreateVendor(safeText(form.get('vendorName'),180));
    const vendorName=vendor.name;
    const invoiceNumber=safeText(form.get('invoiceNumber'),100);
    const date=invoiceDate(form.get('invoiceDate'));
    const mileage=optionalMileage(form.get('mileage'));
    const totalRaw=String(form.get('totalAmount')??'').replace(/[$,]/g,'').trim();
    const totalAmount=totalRaw===''?0:Number(totalRaw);
    if(!Number.isFinite(totalAmount)||totalAmount<0||totalAmount>1_000_000)throw new Error('Invoice total must be between $0 and $1,000,000.');
    const serviceSummary=safeText(form.get('serviceSummary'),8000);
    if(!serviceSummary)throw new Error('Enter the work performed before creating the repair record.');
    const ocrText=safeText(form.get('ocrText'),60000);

    const bytes=await file.arrayBuffer();
    const fileHash=await sha256Hex(bytes);
    const duplicate=await env.DB.prepare(`
      SELECT d.id,e.unit,d.invoice_number
      FROM outside_work_documents d JOIN equipment e ON e.id=d.equipment_id
      WHERE d.file_sha256=? LIMIT 1
    `).bind(fileHash).first<{id:number;unit:string;invoice_number:string}>();
    if(duplicate){
      return Response.json({
        error:`This exact file was already recorded for unit ${duplicate.unit}${duplicate.invoice_number?` as invoice ${duplicate.invoice_number}`:''}.`,
        duplicateId:duplicate.id,
      },{status:409,headers:{'cache-control':'no-store'}});
    }

    const year=(date||new Date().toISOString().slice(0,10)).slice(0,4);
    objectKey=`outside-work/${year}/${equipment.id}/${crypto.randomUUID()}-${originalName}`;
    await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType}});

    const firstLine=serviceSummary.split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'Vendor service';
    const title=`Outside work - ${vendorName}: ${firstLine}`.slice(0,500);
    const provenance=[
      serviceSummary,
      '',
      `Outside vendor: ${vendorName} (vendor #${vendor.id})`,
      invoiceNumber?`Vendor invoice / RO: ${invoiceNumber}`:'Vendor invoice / RO: not entered',
      date?`Service date: ${date}`:'Service date: not entered',
      mileage==null?'Vendor invoice mileage: not entered':`Vendor invoice mileage: ${mileage.toLocaleString()} mi (invoice record only; not Geotab mileage)`,
      `Outside invoice total: $${totalAmount.toFixed(2)}`,
    ].join('\n');
    const completedAt=date?`${date} 12:00:00`:null;
    const inserted=await env.DB.prepare(`
      INSERT INTO repairs (
        equipment_id,title,description,status,priority,source,outside_cost,opened_at,completed_at,updated_at
      ) VALUES (?, ?, ?, 'Completed', 'normal', 'outside-work', ?, COALESCE(?,CURRENT_TIMESTAMP), COALESCE(?,CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    `).bind(equipment.id,title,provenance,totalAmount,completedAt,completedAt).run();
    repairId=Number(inserted.meta.last_row_id??0);
    if(!repairId)throw new Error('The outside-work repair record could not be created.');

    const batch=await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO outside_work_documents (
          equipment_id,repair_id,vendor_id,vendor_name,invoice_number,invoice_date,mileage,total_amount,
          original_file_name,content_type,object_key,file_sha256,ocr_text,service_summary,uploaded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        equipment.id,repairId,vendor.id,vendorName,invoiceNumber,date,mileage,totalAmount,
        originalName,contentType,objectKey,fileHash,ocrText,serviceSummary,user.id,
      ),
      env.DB.prepare(`
        INSERT INTO attachments (repair_id,object_key,file_name,content_type)
        VALUES (?, ?, ?, ?)
      `).bind(repairId,objectKey,originalName,contentType),
      env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
        VALUES (?, ?, ?, 'outside_work_imported', ?)
      `).bind(
        repairId,user.id,user.technicianId,
        `${user.displayName||user.username} recorded outside work for unit ${equipment.unit} from ${vendorName} (vendor #${vendor.id})${vendor.created?' [new road vendor]':''}${invoiceNumber?` invoice ${invoiceNumber}`:''}; total $${totalAmount.toFixed(2)}.`.slice(0,500),
      ),
    ]);
    const documentId=Number(batch[0]?.meta.last_row_id??0);

    return Response.json({ok:true,documentId,repairId:`repair-${repairId}`,unit:equipment.unit,vendorId:vendor.id,vendorName,vendorCreated:vendor.created});
  }catch(error){
    if(repairId){try{await env.DB.prepare('DELETE FROM repairs WHERE id=?').bind(repairId).run();}catch{}}
    if(objectKey){try{await env.FILES.delete(objectKey);}catch{}}
    const message=error instanceof Error?error.message:'Outside-work record could not be created.';
    const status=message==='Authentication required.'?401:message.includes('Manager or administrator')?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
