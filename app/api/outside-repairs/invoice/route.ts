import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

const SAFE_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','image/bmp','image/tiff','image/heic','image/heif']);

type Assignment = {
  repair_id:number;
  equipment_id:number|null;
  unit:string;
  repair_status:string;
  assignment_status:string;
  outside_vendor_id:number;
  vendor_name:string;
};

async function requireManager(request:Request) {
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required.');
  return user;
}

function repairId(value:unknown){const match=String(value??'').match(/^(?:repair-)?(\d+)$/);return match?Number(match[1]):0;}
function cleanFileName(value:string){return value.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-140)||'outside-work';}
function text(value:FormDataEntryValue|null,max:number){return String(value??'').trim().slice(0,max);}
function normalizeVendor(value:string){return value.toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim().replace(/\s+(?:INCORPORATED|INC|LLC|LTD|CORPORATION|CORP|COMPANY|CO)$/,'').trim();}
function optionalMileage(value:FormDataEntryValue|null){const raw=String(value??'').replace(/,/g,'').trim();if(!raw)return null;const number=Number(raw);if(!Number.isInteger(number)||number<0||number>10_000_000)throw new Error('Invoice mileage must be a whole number between 0 and 10,000,000.');return number;}
function invoiceDate(value:FormDataEntryValue|null){const raw=String(value??'').trim();if(!raw)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!Number.isFinite(Date.parse(`${raw}T12:00:00Z`)))throw new Error('Service date is invalid.');return raw;}
async function sha256Hex(bytes:ArrayBuffer){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');}

export async function POST(request:Request){
  let objectKey='';
  try{
    const user=await requireManager(request);
    const form=await request.formData();
    const id=repairId(form.get('repairId'));
    if(!id)throw new Error('Choose the Outside Repair this invoice belongs to.');

    const assignment=await env.DB.prepare(`
      SELECT a.repair_id,r.equipment_id,COALESCE(e.unit,'') AS unit,COALESCE(r.status,'') AS repair_status,
             a.status AS assignment_status,a.outside_vendor_id,v.name AS vendor_name
      FROM outside_repair_assignments a
      JOIN repairs r ON r.id=a.repair_id
      LEFT JOIN equipment e ON e.id=r.equipment_id
      JOIN outside_work_vendors v ON v.id=a.outside_vendor_id
      WHERE a.repair_id=?
    `).bind(id).first<Assignment>();
    if(!assignment||!['waiting_vendor','waiting_invoice'].includes(assignment.assignment_status))throw new Error('This repair is not currently active in Outside Repairs.');
    if(!assignment.equipment_id)throw new Error('This repair is not linked to Master Equipment.');

    const submittedEquipmentId=Number(form.get('equipmentId')??0);
    if(submittedEquipmentId&&submittedEquipmentId!==Number(assignment.equipment_id))throw new Error(`This invoice is assigned to unit ${assignment.unit}. Choose that same unit before saving.`);
    const submittedVendor=text(form.get('vendorName'),180);
    if(submittedVendor&&normalizeVendor(submittedVendor)!==normalizeVendor(assignment.vendor_name))throw new Error(`This repair is assigned to ${assignment.vendor_name}. Correct the vendor or return the repair to the shop before using a different vendor.`);

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
    if(!isPdf&&!isImage)throw new Error('Upload a PDF or common photo/image file.');
    const contentType=isPdf?'application/pdf':suppliedType||'application/octet-stream';

    const invoiceNumber=text(form.get('invoiceNumber'),100);
    const date=invoiceDate(form.get('invoiceDate'));
    const mileage=optionalMileage(form.get('mileage'));
    const totalRaw=String(form.get('totalAmount')??'').replace(/[$,]/g,'').trim();
    const totalAmount=totalRaw===''?0:Number(totalRaw);
    if(!Number.isFinite(totalAmount)||totalAmount<0||totalAmount>1_000_000)throw new Error('Invoice total must be between $0 and $1,000,000.');
    const serviceSummary=text(form.get('serviceSummary'),8000);
    if(!serviceSummary)throw new Error('Enter the work performed before saving the invoice.');
    const ocrText=text(form.get('ocrText'),60000);

    const bytes=await file.arrayBuffer();
    const fileHash=await sha256Hex(bytes);
    const duplicate=await env.DB.prepare(`
      SELECT d.id,COALESCE(e.unit,'') AS unit,d.invoice_number
      FROM outside_work_documents d LEFT JOIN equipment e ON e.id=d.equipment_id
      WHERE d.file_sha256=? LIMIT 1
    `).bind(fileHash).first<{id:number;unit:string;invoice_number:string}>();
    if(duplicate)throw new Error(`This exact file was already recorded for unit ${duplicate.unit}${duplicate.invoice_number?` as invoice ${duplicate.invoice_number}`:''}.`);

    const year=(date||new Date().toISOString().slice(0,10)).slice(0,4);
    objectKey=`outside-work/${year}/${assignment.equipment_id}/${crypto.randomUUID()}-${originalName}`;
    await env.FILES.put(objectKey,bytes,{httpMetadata:{contentType}});

    const completedAt=date?`${date} 12:00:00`:null;
    const batch=await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO outside_work_documents (
          equipment_id,repair_id,outside_vendor_id,vendor_name,invoice_number,invoice_date,mileage,total_amount,
          original_file_name,content_type,object_key,file_sha256,ocr_text,service_summary,uploaded_by_user_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        assignment.equipment_id,id,assignment.outside_vendor_id,assignment.vendor_name,invoiceNumber,date,mileage,totalAmount,
        originalName,contentType,objectKey,fileHash,ocrText,serviceSummary,user.id,
      ),
      env.DB.prepare(`INSERT INTO attachments (repair_id,object_key,file_name,content_type) VALUES (?,?,?,?)`)
        .bind(id,objectKey,originalName,contentType),
      env.DB.prepare(`
        UPDATE repairs
        SET status='Completed',outside_cost=?,completed_at=COALESCE(?,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(totalAmount,completedAt,id),
      env.DB.prepare(`
        UPDATE outside_repair_assignments
        SET status='completed',vendor_finished_at=COALESCE(vendor_finished_at,CURRENT_TIMESTAMP),
            invoice_received_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE repair_id=?
      `).bind(user.id,id),
      env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
        VALUES (?,?,?,'outside_invoice_attached',?)
      `).bind(id,user.id,user.technicianId,`${user.displayName} attached ${assignment.vendor_name}${invoiceNumber?` invoice ${invoiceNumber}`:''} to existing repair #${id}; total $${totalAmount.toFixed(2)}. Repair completed.`.slice(0,500)),
    ]);

    const documentId=Number(batch[0]?.meta.last_row_id??0);
    return Response.json({ok:true,documentId,repairId:`repair-${id}`,unit:assignment.unit,vendorName:assignment.vendor_name,attachedToExistingRepair:true});
  }catch(error){
    if(objectKey){try{await env.FILES.delete(objectKey);}catch{}}
    const message=error instanceof Error?error.message:'Outside repair invoice could not be saved.';
    const status=message==='Authentication required.'?401:message.includes('Manager or administrator')?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
