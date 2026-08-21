import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { buildVisionInput } from '@/app/outside-work/vision-request.js';

type AiBinding={run:(model:string,input:Record<string,unknown>)=>Promise<unknown>};
type VisionField={value:string;confidence:number};
type VisionPayload={
  vendorName:VisionField;
  invoiceNumber:VisionField;
  serviceDate:VisionField;
  unitNumber:VisionField;
  mileage:VisionField;
  totalAmount:VisionField;
  workPerformed:{value:string[];confidence:number};
};

const MAX_IMAGE_BYTES=4_500_000;
const MODEL='@cf/qwen/qwen3.8-27b';

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
function sanitizePayload(value:unknown):VisionPayload{
  const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return{
    vendorName:field(row.vendorName),
    invoiceNumber:field(row.invoiceNumber),
    serviceDate:field(row.serviceDate),
    unitNumber:field(row.unitNumber),
    mileage:field(row.mileage),
    totalAmount:field(row.totalAmount),
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
  if(typeof row.response==='string')payload=row.response;
  else{
    const choices=Array.isArray(row.choices)?row.choices:[];
    const first=choices[0] as Record<string,unknown>|undefined;
    const message=first?.message as Record<string,unknown>|undefined;
    if(typeof message?.content==='string')payload=message.content;
  }
  const preview=clean(payload,260);
  return`Workers AI response keys: ${keys}.${preview?` Text preview: ${preview}`:' No text payload was returned.'}`;
}
function normalizedText(payload:VisionPayload){
  const lines:string[]=['VISION-VERIFIED SCANNED INVOICE'];
  if(payload.vendorName.confidence>=.72&&payload.vendorName.value)lines.push(`SERVICE VENDOR: ${payload.vendorName.value}`);
  if(payload.invoiceNumber.confidence>=.72&&payload.invoiceNumber.value)lines.push(`INVOICE NUMBER: ${payload.invoiceNumber.value}`);
  if(payload.serviceDate.confidence>=.72&&payload.serviceDate.value)lines.push(`SERVICE DATE: ${payload.serviceDate.value}`);
  if(payload.unitNumber.confidence>=.72&&payload.unitNumber.value)lines.push(`UNIT: ${payload.unitNumber.value}`);
  if(payload.mileage.confidence>=.8&&payload.mileage.value)lines.push(`ODOMETER: ${payload.mileage.value}`);
  if(payload.totalAmount.confidence>=.72&&payload.totalAmount.value)lines.push(`INVOICE TOTAL: ${payload.totalAmount.value}`);
  if(payload.workPerformed.confidence>=.68&&payload.workPerformed.value.length){
    lines.push('WORK PERFORMED:');
    lines.push(...payload.workPerformed.value);
  }
  return lines.join('\n');
}

const SYSTEM=`You read fleet repair invoices from photographs and scanned PDFs, including difficult handwriting. Extract only what is visibly supported by the page. Never guess. The customer may be Northern Logistics or Norloworld; that is not the repair vendor. Distinguish the company that performed the service from remit-to/payee/payment-processor names. For handwritten forms, use the printed labels and spatial layout to interpret the handwritten value next to each label. Return concise repair-history actions, not legal boilerplate, prices, authorization text, headers, slogans, or footer terms. If a field is unclear, return an empty value and low confidence.`;

const USER=`Return only the requested structured invoice fields. Confidence is 0 to 1. Read handwriting carefully and use page layout, not just word proximity.
- vendorName is the servicing shop/company shown by the business letterhead; never use the customer, slogan, phone/address, or payment processor.
- invoiceNumber is the document's invoice/receipt/repair-order serial. On old paper forms this may be a printed "No." near the top business header.
- unitNumber is the customer's fleet unit/vehicle number. A separate handwritten "NO.", "UNIT", "TRUCK", or vehicle field in the customer/service area may be the unit. Never reuse the invoice number as the unit.
- serviceDate comes from the service/invoice/date field, never a due date.
- mileage must come only from a speedometer/odometer/mileage field. If that field is blank or unclear, return empty.
- totalAmount is the final invoice total, not labor, parts, tax, service-call, or subtotal amounts.
- workPerformed contains only actual repair/service actions that are legible enough to trust. Do not copy the vendor header, "24 hour service", "since 1991", authorization text, totals, or legal language.
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
    const hint=ocrHint?`${USER}\n\nThe browser produced the following noisy OCR hint. It can help locate printed labels/numbers, but it may badly misread handwriting or logos. The image is authoritative; ignore OCR text that conflicts with the page image:\n--- OCR HINT ---\n${ocrHint}\n--- END OCR HINT ---`:USER;
    const result=await ai.run(MODEL,buildVisionInput({system:SYSTEM,user:hint,imageBase64}));
    const parsed=sanitizePayload(extractResultObject(result));
    const text=normalizedText(parsed);
    if(text.split('\n').length<=1){
      const detail=responseDiagnostic(result);
      console.warn('outside-work vision returned no confident structured fields',detail);
      return Response.json({ok:false,error:'Vision reader could not identify any fields confidently.',detail,fields:parsed},{status:422,headers:{'cache-control':'no-store'}});
    }
    return Response.json({ok:true,fields:parsed,normalizedText:text,model:MODEL},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const detail=error instanceof Error?error.message:String(error??'');
    console.error('outside-work vision extraction failed',detail);
    return Response.json({error:'The handwritten-invoice vision reader could not complete this scan.',detail:detail.slice(0,300)},{status:500,headers:{'cache-control':'no-store'}});
  }
}
