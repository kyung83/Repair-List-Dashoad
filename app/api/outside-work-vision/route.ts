import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { buildVisionInput } from '@/app/outside-work/vision-request.js';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type VisionField={value:string;confidence:number};
type ChargeField={label:string;amount:string;confidence:number};
type VisionPayload={
  vendorName:VisionField;
  vendorPhone:VisionField;
  invoiceNumber:VisionField;
  serviceDate:VisionField;
  unitNumber:VisionField;
  mileage:VisionField;
  totalAmount:VisionField;
  charges:ChargeField[];
  workPerformed:{value:string[];confidence:number};
};

const MAX_IMAGE_BYTES=4_500_000;
const OCR_MODEL='@cf/moondream/moondream3.1-9B-A2B';
const FALLBACK_MODEL='@cf/qwen/qwen3.8-27b';

function clean(value:unknown,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}
function confidence(value:unknown){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;}
function field(value:unknown):VisionField{
  if(!value||typeof value!=='object')return{value:'',confidence:0};
  const row=value as Record<string,unknown>;
  return{value:clean(row.value,220),confidence:confidence(row.confidence)};
}
function workField(value:unknown){
  if(!value||typeof value!=='object')return{value:[],confidence:0};
  const row=value as Record<string,unknown>;
  const raw=Array.isArray(row.value)?row.value:[];
  const lines=raw.map(item=>clean(item,260)).filter(Boolean).slice(0,16);
  return{value:lines,confidence:confidence(row.confidence)};
}
function chargeFields(value:unknown){
  if(!Array.isArray(value))return[];
  return value.map(item=>{
    const row=item&&typeof item==='object'?item as Record<string,unknown>:{};
    return{label:clean(row.label,80),amount:clean(row.amount,40),confidence:confidence(row.confidence)};
  }).filter(item=>item.label&&item.amount).slice(0,12);
}
function sanitizePayload(value:unknown):VisionPayload{
  const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return{
    vendorName:field(row.vendorName),
    vendorPhone:field(row.vendorPhone),
    invoiceNumber:field(row.invoiceNumber),
    serviceDate:field(row.serviceDate),
    unitNumber:field(row.unitNumber),
    mileage:field(row.mileage),
    totalAmount:field(row.totalAmount),
    charges:chargeFields(row.charges),
    workPerformed:workField(row.workPerformed),
  };
}
function bytesToBase64(bytes:Uint8Array){
  let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));
  return btoa(binary);
}
function parseJsonText(value:unknown):unknown{
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(!text)return null;
  try{return JSON.parse(text);}catch{}
  const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced?.[1]){try{return JSON.parse(fenced[1].trim());}catch{}}
  const object=text.match(/\{[\s\S]*\}/);
  if(object?.[0]){try{return JSON.parse(object[0]);}catch{}}
  return null;
}
function extractResultObject(result:unknown):unknown{
  if(!result||typeof result!=='object')return null;
  const row=result as Record<string,unknown>;
  const answerParsed=parseJsonText(row.answer);
  if(answerParsed)return answerParsed;
  if(row.response&&typeof row.response==='object')return row.response;
  const responseParsed=parseJsonText(row.response);
  if(responseParsed)return responseParsed;
  const choices=Array.isArray(row.choices)?row.choices:[];
  const first=choices[0] as Record<string,unknown>|undefined;
  const message=first?.message as Record<string,unknown>|undefined;
  const content=message?.content;
  if(content&&typeof content==='object')return content;
  const contentParsed=parseJsonText(content);
  if(contentParsed)return contentParsed;
  const parsed=message?.parsed;
  if(parsed&&typeof parsed==='object')return parsed;
  return null;
}
function responseDiagnostic(result:unknown){
  if(!result||typeof result!=='object')return`Workers AI returned ${typeof result}.`;
  const row=result as Record<string,unknown>;
  const keys=Object.keys(row).slice(0,12).join(',')||'<none>';
  let payload='';
  if(typeof row.answer==='string')payload=row.answer;
  else if(typeof row.response==='string')payload=row.response;
  else{
    const choices=Array.isArray(row.choices)?row.choices:[];
    const first=choices[0] as Record<string,unknown>|undefined;
    const message=first?.message as Record<string,unknown>|undefined;
    if(typeof message?.content==='string')payload=message.content;
  }
  const preview=clean(payload,320);
  return`Workers AI response keys: ${keys}.${preview?` Text preview: ${preview}`:' No text payload was returned.'}`;
}
function normalizedText(payload:VisionPayload){
  const lines:string[]=['VISION-VERIFIED SCANNED INVOICE'];
  if(payload.vendorName.confidence>=.68&&payload.vendorName.value)lines.push(`SERVICE VENDOR: ${payload.vendorName.value}`);
  if(payload.vendorPhone.confidence>=.68&&payload.vendorPhone.value)lines.push(`VENDOR PHONE: ${payload.vendorPhone.value}`);
  if(payload.invoiceNumber.confidence>=.68&&payload.invoiceNumber.value)lines.push(`INVOICE NUMBER: ${payload.invoiceNumber.value}`);
  if(payload.serviceDate.confidence>=.68&&payload.serviceDate.value)lines.push(`SERVICE DATE: ${payload.serviceDate.value}`);
  if(payload.unitNumber.confidence>=.68&&payload.unitNumber.value)lines.push(`UNIT: ${payload.unitNumber.value}`);
  if(payload.mileage.confidence>=.8&&payload.mileage.value)lines.push(`ODOMETER: ${payload.mileage.value}`);
  for(const charge of payload.charges){
    if(charge.confidence<.68)continue;
    const label=charge.label.toUpperCase().replace(/[^A-Z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
    if(label)lines.push(`${label}: ${charge.amount}`);
  }
  if(payload.totalAmount.confidence>=.68&&payload.totalAmount.value)lines.push(`INVOICE TOTAL: ${payload.totalAmount.value}`);
  if(payload.workPerformed.confidence>=.64&&payload.workPerformed.value.length){
    lines.push('WORK PERFORMED:');
    lines.push(...payload.workPerformed.value);
  }
  return lines.join('\n');
}
function usefulFieldCount(payload:VisionPayload){
  let count=0;
  for(const item of [payload.vendorName,payload.vendorPhone,payload.invoiceNumber,payload.serviceDate,payload.unitNumber,payload.totalAmount])if(item.value&&item.confidence>=.6)count++;
  if(payload.workPerformed.value.length&&payload.workPerformed.confidence>=.6)count++;
  return count;
}

const SYSTEM=`You read fleet repair invoices from photographs and scanned PDFs, including difficult handwriting. Extract only what is visibly supported by the page. Never guess. The customer may be Northern Logistics or Norloworld; that is not the repair vendor. Distinguish the company that performed the service from remit-to/payee/payment-processor names. For handwritten forms, use printed labels and spatial layout to interpret the handwritten value next to each label. Return concise repair-history actions, not legal boilerplate, prices, authorization text, headers, slogans, or footer terms. If a field is unclear, return an empty value and low confidence.`;

const USER=`Return ONLY JSON with this exact shape:
{
  "vendorName":{"value":"","confidence":0},
  "vendorPhone":{"value":"","confidence":0},
  "invoiceNumber":{"value":"","confidence":0},
  "serviceDate":{"value":"YYYY-MM-DD or empty","confidence":0},
  "unitNumber":{"value":"fleet unit number or empty","confidence":0},
  "mileage":{"value":"whole-number odometer or empty","confidence":0},
  "totalAmount":{"value":"decimal amount without $ or commas, or empty","confidence":0},
  "charges":[{"label":"SERVICE CALL or LABOR or PARTS or TAX","amount":"decimal amount","confidence":0}],
  "workPerformed":{"value":["short repair action"],"confidence":0}
}
Confidence is 0 to 1. Read handwriting carefully and use page layout, not just word proximity.
- vendorName is the servicing shop/company shown by business letterhead. Never use Northern Logistics, Norloworld, the customer, a slogan, phone/address text, or a payment processor as the vendor.
- vendorPhone is the servicing shop's printed phone number. Prefer a line labeled PHONE/TEL and never use a FAX number.
- invoiceNumber is the document invoice/receipt/repair-order serial. On old paper forms this may be a printed No. near the top business header.
- unitNumber is the customer's fleet unit/vehicle number. Never reuse the invoice number as the unit.
- serviceDate comes from the service/invoice/date field, never a due date.
- mileage must come only from a speedometer/odometer/mileage field. If blank or unclear, return empty.
- totalAmount is the final invoice total, not labor, parts, tax, service-call, or subtotal amounts.
- charges should include only clearly labeled SERVICE CALL, LABOR, PARTS, or TAX amounts when those lines exist. Do not include TOTAL as a charge.
- workPerformed contains only actual repair/service actions legible enough to trust. Do not copy the vendor header, 24 hour service, since 1991, authorization text, totals, or legal language.
Do not infer missing values.`;

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)return Response.json({error:'Authentication required.'},{status:401});
    if(user.role!=='manager'&&user.role!=='admin')return Response.json({error:'Manager or administrator access is required.'},{status:403});

    const ai=(env as unknown as {AI?:AiBinding}).AI;
    if(!ai)return Response.json({error:'Vision reader is not configured.'},{status:503});
    const body=await request.formData();
    const image=body.get('image');
    if(!(image instanceof File))return Response.json({error:'Invoice image is required.'},{status:400});
    if(image.size<=0||image.size>MAX_IMAGE_BYTES)return Response.json({error:'Invoice image must be between 1 byte and 4.5 MB.'},{status:400});
    if(!/^image\/(?:jpeg|png|webp)$/i.test(image.type))return Response.json({error:'Vision reader accepts JPEG, PNG, or WebP images.'},{status:400});
    const ocrHint=String(body.get('ocrText')??'').trim().slice(0,12_000);

    const bytes=new Uint8Array(await image.arrayBuffer());
    const imageBase64=bytesToBase64(bytes);
    const dataUri=`data:${image.type};base64,${imageBase64}`;
    const hint=ocrHint?`${USER}\n\nThe browser produced the following noisy OCR hint. It can help locate printed labels/numbers, but it may badly misread handwriting or logos. The image is authoritative; ignore OCR text that conflicts with the page image:\n--- OCR HINT ---\n${ocrHint}\n--- END OCR HINT ---`:USER;

    let primaryResult:unknown=null;
    let fallbackResult:unknown=null;
    try{
      primaryResult=await ai.run(OCR_MODEL,{task:'query',image:dataUri,question:`${SYSTEM}\n\n${hint}`,reasoning:false,temperature:0,max_tokens:2200,stream:false});
    }catch(error){
      console.warn('outside-work moondream read failed',error instanceof Error?error.message:String(error));
    }
    let parsed=sanitizePayload(extractResultObject(primaryResult));
    let model=OCR_MODEL;

    if(usefulFieldCount(parsed)<2){
      fallbackResult=await ai.run(FALLBACK_MODEL,buildVisionInput({system:SYSTEM,user:hint,imageBase64}));
      const fallbackParsed=sanitizePayload(extractResultObject(fallbackResult));
      if(usefulFieldCount(fallbackParsed)>usefulFieldCount(parsed)){
        parsed=fallbackParsed;
        model=FALLBACK_MODEL;
      }
    }

    const text=normalizedText(parsed);
    if(text.split('\n').length<=1){
      const detail=`Moondream: ${responseDiagnostic(primaryResult)} Qwen fallback: ${responseDiagnostic(fallbackResult)}`.slice(0,900);
      console.warn('outside-work vision returned no confident structured fields',detail);
      return Response.json({ok:false,error:'Vision reader could not identify any fields confidently.',detail,fields:parsed},{status:422,headers:{'cache-control':'no-store'}});
    }
    return Response.json({ok:true,fields:parsed,normalizedText:text,model},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const detail=error instanceof Error?error.message:String(error??'');
    console.error('outside-work vision extraction failed',detail);
    return Response.json({error:'The handwritten-invoice vision reader could not complete this scan.',detail:detail.slice(0,500)},{status:500,headers:{'cache-control':'no-store'}});
  }
}
