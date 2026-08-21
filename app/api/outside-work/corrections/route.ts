import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { normalizePhone } from '@/app/outside-work/invoice-validation.js';
import { LEARNABLE_FIELDS, normalizeCorrectionValue } from '@/app/outside-work/correction-memory.js';

type VendorRow={id:number;name:string;phone:string|null};
type RuleRow={id:number;vendor_id:number;field_name:string;detected_key:string;corrected_value:string;confirmations:number};

function normalizeVendor(value:string){
  return value.toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim().replace(/\s+(?:INCORPORATED|INC|LLC|LTD|CORPORATION|CORP|COMPANY|CO)$/,'').trim();
}

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required.');
  return user;
}

async function resolveVendor(name:string,phone:string){
  const result=await env.DB.prepare(`SELECT id,name,phone FROM vendors WHERE COALESCE(active,1)=1 ORDER BY id`).all<VendorRow>();
  const digits=normalizePhone(phone);
  if(digits){
    const matches=result.results.filter(row=>normalizePhone(row.phone??'')===digits);
    if(matches.length===1)return matches[0];
  }
  const key=normalizeVendor(name);
  if(key){
    const matches=result.results.filter(row=>normalizeVendor(row.name)===key);
    if(matches.length===1)return matches[0];
  }
  return null;
}

function errorStatus(message:string){
  if(message==='Authentication required.')return 401;
  if(message.includes('Manager or administrator'))return 403;
  return 400;
}

export async function GET(request:Request){
  try{
    await requireManager(request);
    const result=await env.DB.prepare(`
      SELECT id,vendor_id,field_name,detected_key,corrected_value,confirmations
      FROM outside_work_correction_memory
      WHERE confirmations>=2
      ORDER BY confirmations DESC,last_seen_at DESC,id DESC
      LIMIT 500
    `).all<RuleRow>();
    return Response.json({rules:result.results.map(row=>({
      id:Number(row.id),vendorId:Number(row.vendor_id),fieldName:row.field_name,detectedKey:row.detected_key,
      correctedValue:row.corrected_value,confirmations:Number(row.confirmations||0),
    }))},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Correction memory could not be loaded.';
    return Response.json({error:message},{status:errorStatus(message),headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request:Request){
  try{
    await requireManager(request);
    const body=await request.json() as Record<string,unknown>;
    const vendorName=String(body.vendorName??'').trim();
    const vendorPhone=String(body.vendorPhone??'').trim();
    const detected=(body.detected&&typeof body.detected==='object'?body.detected:{}) as Record<string,unknown>;
    const reviewed=(body.reviewed&&typeof body.reviewed==='object'?body.reviewed:{}) as Record<string,unknown>;
    const vendor=await resolveVendor(vendorName,vendorPhone);
    if(!vendor)return Response.json({ok:true,learned:0,reason:'Vendor could not be resolved uniquely; no correction rule was learned.'},{headers:{'cache-control':'no-store'}});

    let learned=0;
    for(const fieldName of LEARNABLE_FIELDS){
      const detectedValue=String(detected[fieldName]??'').trim();
      const correctedValue=String(reviewed[fieldName]??'').trim();
      const detectedKey=normalizeCorrectionValue(fieldName,detectedValue);
      const correctedKey=normalizeCorrectionValue(fieldName,correctedValue);
      if(!detectedKey||!correctedKey||detectedKey===correctedKey)continue;
      await env.DB.prepare(`
        INSERT INTO outside_work_correction_memory
          (vendor_id,field_name,detected_value,detected_key,corrected_value,corrected_key,confirmations,first_seen_at,last_seen_at)
        VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(vendor_id,field_name,detected_key,corrected_key)
        DO UPDATE SET confirmations=confirmations+1,detected_value=excluded.detected_value,corrected_value=excluded.corrected_value,last_seen_at=CURRENT_TIMESTAMP
      `).bind(vendor.id,fieldName,detectedValue,detectedKey,correctedValue,correctedKey).run();
      learned++;
    }
    return Response.json({ok:true,learned,vendorId:Number(vendor.id),vendorName:vendor.name},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Correction memory could not be updated.';
    return Response.json({error:message},{status:errorStatus(message),headers:{'cache-control':'no-store'}});
  }
}
