import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

const MODEL='@cf/google/gemma-4-26b-a4b-it';
const MAX_IMAGES=3;
const MAX_IMAGE_BYTES=8*1024*1024;
const MAX_TOTAL_IMAGE_BYTES=18*1024*1024;
const SAFE_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp']);

type AiBinding={run:(model:string,input:unknown)=>Promise<unknown>};
type RawReading={
  vendorName?:unknown;
  invoiceNumber?:unknown;
  serviceDate?:unknown;
  unit?:unknown;
  mileage?:unknown;
  serviceCall?:unknown;
  labor?:unknown;
  parts?:unknown;
  tax?:unknown;
  totalAmount?:unknown;
  workPerformed?:unknown;
  uncertain?:unknown;
};

async function requireManager(request:Request):Promise<AppUser>{
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required for Outside Work Intake.');
  return user;
}

function base64FromBytes(bytes:Uint8Array){
  const chunks:string[]=[];
  for(let offset=0;offset<bytes.length;offset+=0x8000){
    chunks.push(String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length))));
  }
  return btoa(chunks.join(''));
}

async function imageDataUri(file:File){
  const type=String(file.type||'').toLowerCase();
  if(!SAFE_IMAGE_TYPES.has(type))throw new Error('AI handwriting reader accepts JPEG, PNG, or WebP page images.');
  if(file.size<=0||file.size>MAX_IMAGE_BYTES)throw new Error('Each invoice page sent to the AI reader must be 8 MB or smaller.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  return `data:${type};base64,${base64FromBytes(bytes)}`;
}

function responseText(result:unknown){
  const row=result as Record<string,any> | null;
  if(typeof result==='string')return result;
  if(!row)return'';
  if(typeof row.response==='string')return row.response;
  if(typeof row.result?.response==='string')return row.result.response;
  const content=row.choices?.[0]?.message?.content??row.result?.choices?.[0]?.message?.content;
  if(typeof content==='string')return content;
  if(Array.isArray(content))return content.map(item=>typeof item==='string'?item:String(item?.text??'')).filter(Boolean).join('\n');
  return'';
}

function jsonObjectFromText(text:string):RawReading{
  const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const start=cleaned.indexOf('{');
  const end=cleaned.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('AI handwriting reader returned an unreadable response. Try the invoice again.');
  try{return JSON.parse(cleaned.slice(start,end+1)) as RawReading;}catch{throw new Error('AI handwriting reader returned invalid structured data. Try the invoice again.');}
}

function textValue(value:unknown,max:number){
  if(value==null)return'';
  const text=String(value).replace(/\s+/g,' ').trim();
  if(!text||/^(?:null|unknown|uncertain|n\/a)$/i.test(text))return'';
  return text.slice(0,max);
}

function multilineValue(value:unknown,max:number){
  if(value==null)return'';
  const text=String(value).replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(!text||/^(?:null|unknown|uncertain|n\/a)$/i.test(text))return'';
  return text.slice(0,max);
}

function moneyValue(value:unknown){
  if(value==null||value==='')return'';
  const normalized=typeof value==='number'?value:Number(String(value).replace(/[$,\s]/g,''));
  if(!Number.isFinite(normalized)||normalized<0||normalized>1_000_000)return'';
  return normalized.toFixed(2);
}

function mileageValue(value:unknown){
  if(value==null||value==='')return'';
  const normalized=typeof value==='number'?value:Number(String(value).replace(/[,\s]/g,''));
  if(!Number.isInteger(normalized)||normalized<0||normalized>10_000_000)return'';
  return String(normalized);
}

function dateValue(value:unknown){
  const text=textValue(value,20);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(text))return'';
  const parsed=Date.parse(`${text}T12:00:00Z`);
  return Number.isFinite(parsed)?text:'';
}

function uncertainValues(value:unknown){
  if(!Array.isArray(value))return[] as string[];
  const output:string[]=[];
  for(const item of value){
    const text=textValue(item,180);
    if(text&&!output.includes(text))output.push(text);
    if(output.length>=10)break;
  }
  return output;
}

function buildReading(raw:RawReading){
  const vendor=textValue(raw.vendorName,180);
  const invoiceNumber=textValue(raw.invoiceNumber,100);
  const invoiceDate=dateValue(raw.serviceDate);
  const unit=textValue(raw.unit,80);
  const mileage=mileageValue(raw.mileage);
  const serviceCall=moneyValue(raw.serviceCall);
  const labor=moneyValue(raw.labor);
  const parts=moneyValue(raw.parts);
  const tax=moneyValue(raw.tax);
  const totalAmount=moneyValue(raw.totalAmount);
  const uncertain=uncertainValues(raw.uncertain);
  let serviceSummary=multilineValue(raw.workPerformed,4000);

  const breakdown=[
    serviceCall&&`Service call $${serviceCall}`,
    labor&&`Labor $${labor}`,
    parts&&`Parts $${parts}`,
    tax&&`Tax $${tax}`,
    totalAmount&&`Total $${totalAmount}`,
  ].filter(Boolean).join(' · ');
  if(breakdown)serviceSummary=`${serviceSummary}${serviceSummary?'\n\n':''}Cost breakdown: ${breakdown}`;

  const componentValues=[serviceCall,labor,parts,tax].filter(Boolean).map(Number);
  if(totalAmount&&componentValues.length>=2){
    const sum=componentValues.reduce((acc,value)=>acc+value,0);
    if(Math.abs(sum-Number(totalAmount))>0.05){
      const warning=`Cost components shown add to $${sum.toFixed(2)}, which does not match total $${totalAmount}. Verify the invoice.`;
      if(!uncertain.includes(warning))uncertain.push(warning);
    }
  }

  if(raw.serviceDate&&!invoiceDate&&!uncertain.some(item=>/date/i.test(item))){
    uncertain.push('Service date was not a clearly readable full YYYY-MM-DD date. Verify it from the original invoice.');
  }

  return{
    vendor,
    invoiceNumber,
    invoiceDate,
    unit,
    mileage,
    totalAmount,
    serviceSummary,
    costs:{serviceCall,labor,parts,tax,total:totalAmount},
    uncertain,
  };
}

const SYSTEM_PROMPT=`You read scanned outside-repair invoices for a fleet maintenance system. Read printed text and handwriting carefully. Accuracy is more important than filling every field. Never invent or infer missing values. Northern Logistics/Norlow is the customer, not the outside repair vendor.`;

const USER_PROMPT=`Read every supplied invoice page and return ONLY one JSON object with exactly these keys:
{
  "vendorName": string|null,
  "invoiceNumber": string|null,
  "serviceDate": string|null,
  "unit": string|null,
  "mileage": number|null,
  "serviceCall": number|null,
  "labor": number|null,
  "parts": number|null,
  "tax": number|null,
  "totalAmount": number|null,
  "workPerformed": string|null,
  "uncertain": string[]
}
Rules:
- vendorName is the OUTSIDE repair company/provider, never Northern Logistics/Norlow.
- serviceDate must be YYYY-MM-DD only when month, day, AND year are clearly present. If the year is absent or unclear, return null and explain it in uncertain.
- unit is the fleet unit/truck/tractor/trailer number only when clearly supported by the invoice.
- mileage is the invoice odometer/speedometer reading only when clearly readable.
- money values are numbers without dollar signs or commas.
- workPerformed should contain only actual complaint/diagnosis/repair/service lines. Exclude warranty/legal boilerplate, payment terms, addresses, signatures, and generic form labels.
- If handwriting could reasonably be read two ways, use null for that field and add a short explanation to uncertain.
- Do not guess from context. Do not add any prose outside the JSON object.`;

export async function POST(request:Request){
  try{
    await requireManager(request);
    const ai=(env as unknown as {AI?:AiBinding}).AI;
    if(!ai?.run)return Response.json({error:'Cloudflare AI handwriting reader is not configured.'},{status:503,headers:{'cache-control':'no-store'}});

    const body=await request.formData();
    const images=body.getAll('image').filter((entry):entry is File=>entry instanceof File);
    if(!images.length)return Response.json({error:'Invoice image is required.'},{status:400,headers:{'cache-control':'no-store'}});
    if(images.length>MAX_IMAGES)return Response.json({error:`AI handwriting reader supports up to ${MAX_IMAGES} invoice pages at a time.`},{status:400,headers:{'cache-control':'no-store'}});
    const totalBytes=images.reduce((sum,file)=>sum+file.size,0);
    if(totalBytes>MAX_TOTAL_IMAGE_BYTES)return Response.json({error:'Invoice pages are too large for the AI handwriting reader.'},{status:413,headers:{'cache-control':'no-store'}});

    const content:Array<Record<string,unknown>>=[{type:'text',text:USER_PROMPT}];
    for(const image of images){
      content.push({type:'image_url',image_url:{url:await imageDataUri(image)}});
    }

    const result=await ai.run(MODEL,{
      messages:[
        {role:'system',content:SYSTEM_PROMPT},
        {role:'user',content},
      ],
      temperature:0,
      max_completion_tokens:1400,
    });

    const raw=responseText(result);
    if(!raw)throw new Error('AI handwriting reader returned no response.');
    const reading=buildReading(jsonObjectFromText(raw));
    const safeCount=[reading.vendor,reading.invoiceNumber,reading.invoiceDate,reading.unit,reading.mileage,reading.totalAmount,reading.serviceSummary].filter(Boolean).length;
    if(!safeCount)return Response.json({error:'AI handwriting reader could not read enough reliable information. Review the invoice manually.'},{status:422,headers:{'cache-control':'no-store'}});

    return Response.json({ok:true,model:MODEL,reading},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'AI handwriting reader failed.';
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:500;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
