import { env } from 'cloudflare:workers';
import { getDriverBreakdownFollowup } from '@/lib/breakdown-driver-followup';
import {
  readOutsideWorkInvoice,
  OUTSIDE_WORK_MAX_IMAGES,
  OUTSIDE_WORK_MAX_IMAGE_BYTES,
  OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES,
  OUTSIDE_WORK_SAFE_IMAGE_TYPES,
  type OutsideWorkReading,
} from '@/lib/outside-work-ai-reader';

type AiBinding={run:(model:string,input:unknown,options?:unknown)=>Promise<unknown>};
type DriverAccessRow={
  id:number;
  repair_id:number;
  driver_access_token_hash:string|null;
  stage:number;
  status:string;
};
type ReceiptRow={id:number};

const RECEIPT_UPLOAD_MAX_FILE_BYTES=20*1024*1024;
const RECEIPT_UPLOAD_MAX_TOTAL_BYTES=40*1024*1024;
const RECEIPT_UPLOAD_TYPES=new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

async function tokenHash(token:string){
  const bytes=new TextEncoder().encode(token);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function verifiedDriverRow(breakdownId:number,token:string){
  if(!Number.isInteger(breakdownId)||breakdownId<=0||token.length<32||token.length>200){
    throw new Error('Breakdown follow-up link is invalid.');
  }
  const row=await env.DB.prepare(`
    SELECT id,repair_id,driver_access_token_hash,stage,status
    FROM roadside_breakdowns
    WHERE id=?
  `).bind(breakdownId).first<DriverAccessRow>();
  if(!row||!row.driver_access_token_hash)throw new Error('Breakdown follow-up link is invalid.');
  if(await tokenHash(token)!==row.driver_access_token_hash)throw new Error('Breakdown follow-up link is invalid.');
  return row;
}

async function receiptForBreakdown(breakdownId:number){
  return env.DB.prepare(`SELECT id FROM roadside_breakdown_receipts WHERE breakdown_id=?`).bind(breakdownId).first<ReceiptRow>();
}

function cleanFileName(value:string){
  return value.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-140)||'receipt-image';
}

async function replaceReceiptPages(receiptId:number,breakdownId:number,files:File[]){
  const old=await env.DB.prepare(`SELECT object_key FROM roadside_breakdown_receipt_pages WHERE receipt_id=?`).bind(receiptId).all<{object_key:string}>();
  const uploaded:{key:string;file:File;order:number}[]=[];

  try{
    for(let index=0;index<files.length;index+=1){
      const file=files[index];
      const bytes=await file.arrayBuffer();
      const key=`roadside-breakdown-receipts/${new Date().toISOString().slice(0,4)}/${breakdownId}/${crypto.randomUUID()}-${cleanFileName(file.name)}`;
      await env.FILES.put(key,bytes,{httpMetadata:{contentType:file.type||'application/octet-stream'}});
      uploaded.push({key,file,order:index+1});
    }

    const statements=[env.DB.prepare(`DELETE FROM roadside_breakdown_receipt_pages WHERE receipt_id=?`).bind(receiptId)];
    for(const page of uploaded){
      statements.push(env.DB.prepare(`
        INSERT INTO roadside_breakdown_receipt_pages(receipt_id,page_order,object_key,file_name,content_type)
        VALUES(?,?,?,?,?)
      `).bind(receiptId,page.order,page.key,page.file.name.slice(0,255),page.file.type||'application/octet-stream'));
    }
    await env.DB.batch(statements);

    const saved=await env.DB.prepare(`SELECT COUNT(*) AS count FROM roadside_breakdown_receipt_pages WHERE receipt_id=?`).bind(receiptId).first<{count:number}>();
    if(Number(saved?.count||0)!==uploaded.length)throw new Error('Receipt image storage could not be verified.');
  }catch(error){
    for(const page of uploaded){
      try{await env.FILES.delete(page.key);}catch(cleanupError){console.warn('Could not clean up failed breakdown receipt upload.',String(cleanupError));}
    }
    throw error;
  }

  for(const page of old.results){
    try{await env.FILES.delete(page.object_key);}catch(error){
      console.warn('Could not delete superseded breakdown receipt page.',String(error));
    }
  }
}

async function saveReading(receiptId:number,model:string,reading:OutsideWorkReading){
  await env.DB.prepare(`
    UPDATE roadside_breakdown_receipts
    SET ai_status='read',ai_model=?,ai_vendor=?,ai_invoice_number=?,ai_invoice_date=?,ai_unit=?,ai_mileage=?,
        ai_total_amount=?,ai_service_summary=?,ai_costs_json=?,ai_uncertain_json=?,ai_error='',review_status='pending',updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    model,reading.vendor,reading.invoiceNumber,reading.invoiceDate,reading.unit,reading.mileage,
    reading.totalAmount,reading.serviceSummary,JSON.stringify(reading.costs),JSON.stringify(reading.uncertain),receiptId,
  ).run();
}

export async function uploadAndReadDriverBreakdownReceipt(breakdownId:number,token:string,files:File[]){
  const row=await verifiedDriverRow(breakdownId,token);
  if(row.stage>=5||row.status==='not_breakdown')throw new Error('This breakdown is already closed.');
  if(!files.length)throw new Error('Choose a receipt image first.');
  if(files.length>OUTSIDE_WORK_MAX_IMAGES)throw new Error(`Upload up to ${OUTSIDE_WORK_MAX_IMAGES} receipt pages.`);

  const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
  if(totalBytes>RECEIPT_UPLOAD_MAX_TOTAL_BYTES)throw new Error('Receipt images are too large to upload.');
  for(const file of files){
    const type=String(file.type||'').toLowerCase();
    if(!RECEIPT_UPLOAD_TYPES.has(type))throw new Error('Receipt upload accepts JPEG, PNG, WebP, HEIC, or HEIF images.');
    if(file.size<=0||file.size>RECEIPT_UPLOAD_MAX_FILE_BYTES)throw new Error('Each receipt image must be 20 MB or smaller.');
  }

  let receipt=await receiptForBreakdown(breakdownId);
  const createdNewReceipt=!receipt;
  if(!receipt){
    await env.DB.prepare(`
      INSERT INTO roadside_breakdown_receipts(breakdown_id,repair_id,ai_status,review_status,updated_at)
      VALUES(?,?,'uploading','pending',CURRENT_TIMESTAMP)
    `).bind(breakdownId,row.repair_id).run();
    receipt=await receiptForBreakdown(breakdownId);
  }
  if(!receipt)throw new Error('Receipt record could not be created.');

  try{
    // The upload is not considered successful until the new R2 objects and D1 page rows both exist.
    // Existing receipt rows are left untouched until this replacement succeeds.
    await replaceReceiptPages(receipt.id,breakdownId,files);
  }catch(error){
    if(createdNewReceipt){
      const message=error instanceof Error?error.message:String(error);
      await env.DB.prepare(`
        UPDATE roadside_breakdown_receipts
        SET ai_status='upload_failed',ai_error=?,review_status='pending',updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(message.slice(0,1000),receipt.id).run();
    }
    throw new Error('Receipt could not be saved. Please try the upload again before leaving this screen.');
  }

  await env.DB.prepare(`
    UPDATE roadside_breakdown_receipts
    SET repair_id=?,ai_status='uploaded',ai_model='',ai_vendor='',ai_invoice_number='',ai_invoice_date='',ai_unit='',ai_mileage='',
        ai_total_amount='',ai_service_summary='',ai_costs_json='{}',ai_uncertain_json='[]',ai_error='',
        review_status='pending',reviewed_vendor='',reviewed_invoice_number='',reviewed_invoice_date='',reviewed_total_amount='',
        reviewed_service_summary='',reviewed_at=NULL,reviewed_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(row.repair_id,receipt.id).run();

  const aiReadable=files.every(file=>{
    const type=String(file.type||'').toLowerCase();
    return OUTSIDE_WORK_SAFE_IMAGE_TYPES.has(type)&&file.size>0&&file.size<=OUTSIDE_WORK_MAX_IMAGE_BYTES;
  })&&totalBytes<=OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES;

  if(!aiReadable){
    await env.DB.prepare(`
      UPDATE roadside_breakdown_receipts
      SET ai_status='manual_review',
          ai_error='Original receipt uploaded successfully. This image needs office review because it is not in the AI reader safe format/size.',
          review_status='pending',updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(receipt.id).run();
    return getDriverBreakdownFollowup(breakdownId,token);
  }

  await env.DB.prepare(`UPDATE roadside_breakdown_receipts SET ai_status='reading',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(receipt.id).run();

  try{
    const ai=(env as unknown as {AI?:AiBinding}).AI;
    const result=await readOutsideWorkInvoice(ai,env.DB,files);
    await saveReading(receipt.id,result.model,result.reading);
  }catch(error){
    const aiError=error instanceof Error?error.message:String(error);
    console.warn(JSON.stringify({event:'breakdown_receipt_server_ai_read_failed',breakdownId,error:aiError}));
    await env.DB.prepare(`
      UPDATE roadside_breakdown_receipts
      SET ai_status='failed',ai_error=?,review_status='pending',updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(aiError.slice(0,1000),receipt.id).run();
  }

  return getDriverBreakdownFollowup(breakdownId,token);
}
