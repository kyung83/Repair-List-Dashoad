import { env } from 'cloudflare:workers';
import { notifyBreakdownEmailGroup } from '@/lib/notifications';
import {
  readOutsideWorkInvoice,
  OUTSIDE_WORK_MAX_IMAGES,
  OUTSIDE_WORK_MAX_IMAGE_BYTES,
  OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES,
  OUTSIDE_WORK_SAFE_IMAGE_TYPES,
  type OutsideWorkReading,
} from '@/lib/outside-work-ai-reader';

type AiBinding={run:(model:string,input:unknown,options?:unknown)=>Promise<unknown>};

const BREAKDOWN_ALERT_GROUP='Breakdown Alerts';

export type DriverBreakdownAction='tech_arrived'|'repair_finished'|'rolling';

type DriverAccessRow={
  id:number;
  repair_id:number;
  driver_access_token_hash:string|null;
  driver_status:string;
  tech_arrived_at:string|null;
  repair_finished_at:string|null;
  rolling_at:string|null;
  ready_for_review_at:string|null;
  stage:number;
  status:string;
  driver_name:string;
  unit:string;
  equipment_type:string;
};

type ReceiptRow={
  id:number;
  breakdown_id:number;
  repair_id:number;
  ai_status:string;
  ai_model:string;
  ai_vendor:string;
  ai_invoice_number:string;
  ai_invoice_date:string;
  ai_unit:string;
  ai_mileage:string;
  ai_total_amount:string;
  ai_service_summary:string;
  ai_costs_json:string;
  ai_uncertain_json:string;
  ai_error:string;
  review_status:string;
  reviewed_vendor:string;
  reviewed_invoice_number:string;
  reviewed_invoice_date:string;
  reviewed_total_amount:string;
  reviewed_service_summary:string;
  reviewed_at:string|null;
  created_at:string;
  updated_at:string;
};

type ReceiptPageRow={id:number;receipt_id:number;page_order:number;object_key:string;file_name:string;content_type:string};

function randomToken(){
  const bytes=new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function tokenHash(token:string){
  const bytes=new TextEncoder().encode(token);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
}

function escapeHtml(value:unknown){
  return String(value??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function easternTimestamp(value:string|null){
  if(!value)return'';
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;
  const parsed=new Date(normalized);
  if(Number.isNaN(parsed.getTime()))return value;
  return new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Detroit',
    month:'long',
    day:'numeric',
    year:'numeric',
    hour:'numeric',
    minute:'2-digit',
    timeZoneName:'short',
  }).format(parsed);
}

async function sendDriverProgressEmail(row:DriverAccessRow,action:'tech_arrived'|'rolling'){
  const unitType=row.equipment_type==='trailer'?'Trailer':'Truck';
  const eventTime=action==='tech_arrived'?row.tech_arrived_at:row.rolling_at;
  const heading=action==='tech_arrived'?'TECH HAS ARRIVED':'DRIVER IS ROLLING';
  const html=[
    `<strong>${heading}</strong>`,
    '',
    `<strong>Driver:</strong> ${escapeHtml(row.driver_name)}`,
    `<strong>${unitType}:</strong> ${escapeHtml(row.unit)}`,
    `<strong>Time:</strong> ${escapeHtml(easternTimestamp(eventTime))}`,
    `<strong>Breakdown #:</strong> ${row.id}`,
    action==='rolling'?'<strong>Status:</strong> Ready for office review':'',
  ].filter(Boolean).join('<br>');
  await notifyBreakdownEmailGroup(
    row.id,
    BREAKDOWN_ALERT_GROUP,
    `Breakdown - ${row.driver_name}`,
    html,
  );
}

async function driverRow(breakdownId:number){
  return env.DB.prepare(`
    SELECT b.id,b.repair_id,b.driver_access_token_hash,
           COALESCE(b.driver_status,'waiting') AS driver_status,
           b.tech_arrived_at,b.repair_finished_at,b.rolling_at,b.ready_for_review_at,
           b.stage,b.status,b.driver_name,e.unit,e.equipment_type
    FROM roadside_breakdowns b
    JOIN equipment e ON e.id=b.equipment_id
    WHERE b.id=?
  `).bind(breakdownId).first<DriverAccessRow>();
}

async function verifiedDriverRow(breakdownId:number,token:string){
  if(!Number.isInteger(breakdownId)||breakdownId<=0||token.length<32||token.length>200)throw new Error('Breakdown follow-up link is invalid.');
  const row=await driverRow(breakdownId);
  if(!row||!row.driver_access_token_hash)throw new Error('Breakdown follow-up link is invalid.');
  if(await tokenHash(token)!==row.driver_access_token_hash)throw new Error('Breakdown follow-up link is invalid.');
  return row;
}

async function receiptForBreakdown(breakdownId:number){
  return env.DB.prepare(`SELECT * FROM roadside_breakdown_receipts WHERE breakdown_id=?`).bind(breakdownId).first<ReceiptRow>();
}

function safeJsonArray(value:string){
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(item=>String(item)).slice(0,10):[] as string[];}catch{return[] as string[];}
}
function safeJsonObject(value:string){
  try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return{};}
}

export async function issueDriverAccessToken(breakdownId:number){
  const token=randomToken();
  const hash=await tokenHash(token);
  const result=await env.DB.prepare(`
    UPDATE roadside_breakdowns
    SET driver_access_token_hash=?,driver_status=COALESCE(NULLIF(driver_status,''),'waiting'),updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(hash,breakdownId).run();
  if(Number(result.meta.changes||0)!==1)throw new Error('Could not create the driver follow-up link.');
  return token;
}

export async function getDriverBreakdownFollowup(breakdownId:number,token:string){
  const row=await verifiedDriverRow(breakdownId,token);
  const receipt=await receiptForBreakdown(breakdownId);
  return{
    breakdownId:row.id,
    unit:row.unit,
    equipmentType:row.equipment_type,
    driverName:row.driver_name,
    driverStatus:row.driver_status||'waiting',
    techArrivedAt:row.tech_arrived_at,
    repairFinishedAt:row.repair_finished_at,
    rollingAt:row.rolling_at,
    readyForReviewAt:row.ready_for_review_at,
    closed:row.stage>=5,
    status:row.status,
    receipt:{
      uploaded:Boolean(receipt),
      aiStatus:receipt?.ai_status||'',
      reviewStatus:receipt?.review_status||'',
    },
  };
}

export async function recordDriverBreakdownAction(breakdownId:number,token:string,action:DriverBreakdownAction){
  const row=await verifiedDriverRow(breakdownId,token);
  if(row.stage>=5||row.status==='not_breakdown')throw new Error('This breakdown is already closed.');

  if(action==='tech_arrived'){
    const result=await env.DB.prepare(`
      UPDATE roadside_breakdowns
      SET driver_status='tech_arrived',
          tech_arrived_at=CURRENT_TIMESTAMP,
          stage=CASE WHEN stage<4 THEN 4 ELSE stage END,
          status='on_location',
          on_location_at=COALESCE(on_location_at,CURRENT_TIMESTAMP),
          updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tech_arrived_at IS NULL
    `).bind(breakdownId).run();
    if(Number(result.meta.changes||0)===1){
      const updated=await driverRow(breakdownId);
      if(updated)await sendDriverProgressEmail(updated,'tech_arrived');
    }
  }else if(action==='repair_finished'){
    if(!row.tech_arrived_at)throw new Error('Tap Tech Has Arrived first.');
    await env.DB.prepare(`
      UPDATE roadside_breakdowns
      SET driver_status=CASE WHEN rolling_at IS NOT NULL THEN 'rolling' ELSE 'repair_finished' END,
          repair_finished_at=COALESCE(repair_finished_at,CURRENT_TIMESTAMP),
          stage=CASE WHEN stage<4 THEN 4 ELSE stage END,
          status=CASE WHEN rolling_at IS NOT NULL THEN 'ready_for_review' ELSE 'repair_finished' END,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(breakdownId).run();
  }else if(action==='rolling'){
    if(!row.tech_arrived_at)throw new Error('Tap Tech Has Arrived first.');
    const result=await env.DB.prepare(`
      UPDATE roadside_breakdowns
      SET driver_status='rolling',
          repair_finished_at=COALESCE(repair_finished_at,CURRENT_TIMESTAMP),
          rolling_at=CURRENT_TIMESTAMP,
          ready_for_review_at=COALESCE(ready_for_review_at,CURRENT_TIMESTAMP),
          stage=CASE WHEN stage<4 THEN 4 ELSE stage END,
          status='ready_for_review',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND rolling_at IS NULL
    `).bind(breakdownId).run();
    if(Number(result.meta.changes||0)===1){
      const updated=await driverRow(breakdownId);
      if(updated)await sendDriverProgressEmail(updated,'rolling');
    }
  }else{
    throw new Error('Unknown driver breakdown action.');
  }

  return getDriverBreakdownFollowup(breakdownId,token);
}

function cleanFileName(value:string){return value.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-140)||'receipt.jpg';}

async function replaceReceiptPages(receiptId:number,breakdownId:number,files:File[]){
  const old=await env.DB.prepare(`SELECT object_key FROM roadside_breakdown_receipt_pages WHERE receipt_id=?`).bind(receiptId).all<{object_key:string}>();
  for(const page of old.results){try{await env.FILES.delete(page.object_key);}catch(error){console.warn('Could not delete superseded breakdown receipt page.',String(error));}}

  const uploaded:{key:string;file:File;order:number}[]=[];
  for(let index=0;index<files.length;index++){
    const file=files[index];
    const bytes=await file.arrayBuffer();
    const key=`roadside-breakdown-receipts/${new Date().toISOString().slice(0,4)}/${breakdownId}/${crypto.randomUUID()}-${cleanFileName(file.name)}`;
    await env.FILES.put(key,bytes,{httpMetadata:{contentType:file.type}});
    uploaded.push({key,file,order:index+1});
  }

  const statements=[env.DB.prepare(`DELETE FROM roadside_breakdown_receipt_pages WHERE receipt_id=?`).bind(receiptId)];
  for(const page of uploaded){
    statements.push(env.DB.prepare(`
      INSERT INTO roadside_breakdown_receipt_pages(receipt_id,page_order,object_key,file_name,content_type)
      VALUES(?,?,?,?,?)
    `).bind(receiptId,page.order,page.key,page.file.name.slice(0,255),page.file.type));
  }
  await env.DB.batch(statements);
}

export async function uploadDriverBreakdownReceipt(breakdownId:number,token:string,files:File[]){
  const row=await verifiedDriverRow(breakdownId,token);
  if(row.stage>=5||row.status==='not_breakdown')throw new Error('This breakdown is already closed.');
  if(!files.length)throw new Error('Choose a receipt image first.');
  if(files.length>OUTSIDE_WORK_MAX_IMAGES)throw new Error(`Upload up to ${OUTSIDE_WORK_MAX_IMAGES} receipt pages.`);
  const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
  if(totalBytes>OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES)throw new Error('Receipt pages are too large to upload.');
  for(const file of files){
    const type=String(file.type||'').toLowerCase();
    if(!OUTSIDE_WORK_SAFE_IMAGE_TYPES.has(type))throw new Error('Receipt upload accepts JPEG, PNG, or WebP images.');
    if(file.size<=0||file.size>OUTSIDE_WORK_MAX_IMAGE_BYTES)throw new Error('Each receipt page must be 8 MB or smaller.');
  }

  await env.DB.prepare(`
    INSERT INTO roadside_breakdown_receipts(breakdown_id,repair_id,ai_status,review_status,updated_at)
    VALUES(?,?,'reading','pending',CURRENT_TIMESTAMP)
    ON CONFLICT(breakdown_id) DO UPDATE SET
      repair_id=excluded.repair_id,ai_status='reading',ai_error='',review_status='pending',reviewed_at=NULL,reviewed_by_user_id=NULL,updated_at=CURRENT_TIMESTAMP
  `).bind(breakdownId,row.repair_id).run();
  const receipt=await receiptForBreakdown(breakdownId);
  if(!receipt)throw new Error('Receipt record could not be created.');

  await replaceReceiptPages(receipt.id,breakdownId,files);

  let reading:OutsideWorkReading|null=null;
  let model='';
  let aiError='';
  try{
    const ai=(env as unknown as {AI?:AiBinding}).AI;
    const result=await readOutsideWorkInvoice(ai,env.DB,files);
    reading=result.reading;
    model=result.model;
  }catch(error){
    aiError=error instanceof Error?error.message:String(error);
    console.warn(JSON.stringify({event:'breakdown_receipt_ai_read_failed',breakdownId,error:aiError}));
  }

  if(reading){
    await env.DB.prepare(`
      UPDATE roadside_breakdown_receipts
      SET ai_status='read',ai_model=?,ai_vendor=?,ai_invoice_number=?,ai_invoice_date=?,ai_unit=?,ai_mileage=?,
          ai_total_amount=?,ai_service_summary=?,ai_costs_json=?,ai_uncertain_json=?,ai_error='',review_status='pending',updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      model,reading.vendor,reading.invoiceNumber,reading.invoiceDate,reading.unit,reading.mileage,
      reading.totalAmount,reading.serviceSummary,JSON.stringify(reading.costs),JSON.stringify(reading.uncertain),receipt.id,
    ).run();
  }else{
    await env.DB.prepare(`
      UPDATE roadside_breakdown_receipts
      SET ai_status='failed',ai_error=?,review_status='pending',updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(aiError.slice(0,1000),receipt.id).run();
  }

  return getDriverBreakdownFollowup(breakdownId,token);
}

export async function getBreakdownReceiptReview(breakdownId:number){
  const breakdown=await driverRow(breakdownId);
  if(!breakdown)return null;
  const receipt=await receiptForBreakdown(breakdownId);
  let pages:ReceiptPageRow[]=[];
  if(receipt){
    const result=await env.DB.prepare(`
      SELECT id,receipt_id,page_order,object_key,file_name,content_type
      FROM roadside_breakdown_receipt_pages WHERE receipt_id=? ORDER BY page_order
    `).bind(receipt.id).all<ReceiptPageRow>();
    pages=result.results;
  }
  return{
    breakdownId,
    driverStatus:breakdown.driver_status||'waiting',
    techArrivedAt:breakdown.tech_arrived_at,
    repairFinishedAt:breakdown.repair_finished_at,
    rollingAt:breakdown.rolling_at,
    readyForReviewAt:breakdown.ready_for_review_at,
    receipt:receipt?{
      id:receipt.id,
      aiStatus:receipt.ai_status,
      model:receipt.ai_model,
      vendor:receipt.reviewed_vendor||receipt.ai_vendor,
      invoiceNumber:receipt.reviewed_invoice_number||receipt.ai_invoice_number,
      invoiceDate:receipt.reviewed_invoice_date||receipt.ai_invoice_date,
      unit:receipt.ai_unit,
      mileage:receipt.ai_mileage,
      totalAmount:receipt.reviewed_total_amount||receipt.ai_total_amount,
      serviceSummary:receipt.reviewed_service_summary||receipt.ai_service_summary,
      costs:safeJsonObject(receipt.ai_costs_json),
      uncertain:safeJsonArray(receipt.ai_uncertain_json),
      aiError:receipt.ai_error,
      reviewStatus:receipt.review_status,
      reviewedAt:receipt.reviewed_at,
      pages:pages.map(page=>({
        pageOrder:page.page_order,
        fileName:page.file_name,
        contentType:page.content_type,
        url:`/api/breakdowns/receipts/file?receiptId=${receipt.id}&page=${page.page_order}`,
      })),
    }:null,
  };
}

export async function getBreakdownReceiptPage(receiptId:number,pageOrder:number){
  const row=await env.DB.prepare(`
    SELECT p.object_key,p.file_name,p.content_type
    FROM roadside_breakdown_receipt_pages p
    JOIN roadside_breakdown_receipts r ON r.id=p.receipt_id
    WHERE p.receipt_id=? AND p.page_order=?
  `).bind(receiptId,pageOrder).first<{object_key:string;file_name:string;content_type:string}>();
  return row||null;
}

function reviewedText(value:unknown,max:number){return String(value??'').trim().slice(0,max);}
function reviewedMoney(value:unknown){
  const text=String(value??'').replace(/[$,\s]/g,'').trim();
  if(!text)return'';
  const number=Number(text);
  if(!Number.isFinite(number)||number<0||number>1_000_000)throw new Error('Receipt total must be a valid positive dollar amount.');
  return number.toFixed(2);
}

export async function confirmBreakdownReceiptAndClose(breakdownId:number,userId:number,input:Record<string,unknown>){
  const row=await driverRow(breakdownId);
  if(!row)throw new Error('Breakdown not found.');
  if(row.status==='not_breakdown')throw new Error('This report was cleared as not a breakdown.');
  if(row.stage>=5)return{closed:true,alreadyClosed:true};
  if(!row.rolling_at)throw new Error('The driver has not marked Rolling yet.');

  const receipt=await receiptForBreakdown(breakdownId);
  const vendor=reviewedText(input.vendor,180);
  const invoiceNumber=reviewedText(input.invoiceNumber,100);
  const invoiceDate=reviewedText(input.invoiceDate,20);
  const totalAmount=reviewedMoney(input.totalAmount);
  const serviceSummary=reviewedText(input.serviceSummary,4000);

  const statements:any[]=[];
  if(receipt){
    statements.push(env.DB.prepare(`
      UPDATE roadside_breakdown_receipts
      SET review_status='confirmed',reviewed_vendor=?,reviewed_invoice_number=?,reviewed_invoice_date=?,
          reviewed_total_amount=?,reviewed_service_summary=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(vendor,invoiceNumber,invoiceDate,totalAmount,serviceSummary,userId,receipt.id));
  }
  statements.push(env.DB.prepare(`
    UPDATE roadside_breakdowns SET stage=5,status='complete',updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).bind(breakdownId));
  if(totalAmount){
    statements.push(env.DB.prepare(`
      UPDATE repairs SET status='Completed',outside_cost=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(Number(totalAmount),row.repair_id));
  }else{
    statements.push(env.DB.prepare(`
      UPDATE repairs SET status='Completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(row.repair_id));
  }
  await env.DB.batch(statements);
  return{closed:true,alreadyClosed:false};
}
