export const OUTSIDE_WORK_PRIMARY_MODEL='openai/gpt-5.6-sol';
export const OUTSIDE_WORK_FALLBACK_MODEL='@cf/qwen/qwen3.8-27b';
export const OUTSIDE_WORK_MAX_IMAGES=3;
export const OUTSIDE_WORK_MAX_IMAGE_BYTES=8*1024*1024;
export const OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES=18*1024*1024;
export const OUTSIDE_WORK_SAFE_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp']);

type AiBinding={run:(model:string,input:unknown,options?:unknown)=>Promise<unknown>};
type D1Like={prepare:(query:string)=>any};
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
export type OutsideWorkReading={
  vendor:string;
  invoiceNumber:string;
  invoiceDate:string;
  unit:string;
  mileage:string;
  totalAmount:string;
  serviceSummary:string;
  costs:{serviceCall:string;labor:string;parts:string;tax:string;total:string};
  uncertain:string[];
};
type EquipmentRow={unit:string;vin:string|null};

function base64FromBytes(bytes:Uint8Array){
  const chunks:string[]=[];
  for(let offset=0;offset<bytes.length;offset+=0x8000){
    chunks.push(String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length))));
  }
  return btoa(chunks.join(''));
}

async function imageDataUri(file:File){
  const type=String(file.type||'').toLowerCase();
  if(!OUTSIDE_WORK_SAFE_IMAGE_TYPES.has(type))throw new Error('AI handwriting reader accepts JPEG, PNG, or WebP page images.');
  if(file.size<=0||file.size>OUTSIDE_WORK_MAX_IMAGE_BYTES)throw new Error('Each invoice page sent to the AI reader must be 8 MB or smaller.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  return `data:${type};base64,${base64FromBytes(bytes)}`;
}

function contentText(value:unknown):string{
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(contentText).filter(Boolean).join('\n');
  if(!value||typeof value!=='object')return'';
  const row=value as Record<string,any>;
  if(typeof row.text==='string')return row.text;
  if(typeof row.output_text==='string')return row.output_text;
  if(typeof row.response==='string')return row.response;
  if(row.content)return contentText(row.content);
  return'';
}

function responseText(result:unknown){
  if(typeof result==='string')return result;
  const row=result as Record<string,any>|null;
  if(!row)return'';
  const direct=[row.output_text,row.response,row.result?.output_text,row.result?.response]
    .map(contentText).find(Boolean);
  if(direct)return direct;
  const fromOutput=contentText(row.output)||contentText(row.result?.output);
  if(fromOutput)return fromOutput;
  const choice=row.choices?.[0]?.message?.content??row.result?.choices?.[0]?.message?.content;
  return contentText(choice);
}

function jsonObjectFromText(text:string):RawReading{
  const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const start=cleaned.indexOf('{');
  const end=cleaned.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('AI handwriting reader returned an unreadable response.');
  try{return JSON.parse(cleaned.slice(start,end+1)) as RawReading;}catch{throw new Error('AI handwriting reader returned invalid structured data.');}
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

function buildReading(raw:RawReading):OutsideWorkReading{
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

  return{vendor,invoiceNumber,invoiceDate,unit,mileage,totalAmount,serviceSummary,costs:{serviceCall,labor,parts,tax,total:totalAmount},uncertain};
}

function normalizeUnit(value:string){return value.toUpperCase().replace(/[^A-Z0-9]/g,'');}
function numericUnit(value:string){return (value.match(/\b\d{2,6}\b/)||[])[0]||'';}

async function canonicalizeUnit(db:D1Like,reading:OutsideWorkReading){
  if(!reading.unit)return reading;
  const result=await db.prepare(`
    SELECT unit,vin FROM equipment
    WHERE active=1 AND archived_at IS NULL AND merged_into_equipment_id IS NULL
    ORDER BY unit
  `).all() as {results:EquipmentRow[]};
  const raw=normalizeUnit(reading.unit);
  const exact=result.results.filter(row=>normalizeUnit(row.unit)===raw);
  if(exact.length===1){reading.unit=exact[0].unit;return reading;}

  const vinMatch=result.results.some(row=>row.vin&&normalizeUnit(row.vin)===raw);
  const number=numericUnit(reading.unit);
  if(number){
    const numericMatches=result.results.filter(row=>numericUnit(row.unit)===number);
    if(numericMatches.length===1){reading.unit=numericMatches[0].unit;return reading;}
  }

  const warning=vinMatch
    ?`AI read a VIN as the unit (${reading.unit}). Verify the fleet unit from the invoice.`
    :`AI read unit ${reading.unit}, but it does not match one active Master Equipment unit. Verify it from the invoice.`;
  if(!reading.uncertain.includes(warning))reading.uncertain.push(warning);
  reading.unit='';
  return reading;
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
- vendorName is the OUTSIDE repair company/provider shown by the vendor letterhead or service company identity, never Northern Logistics/Norlow.
- invoiceNumber is the vendor invoice/repair-order number. On service forms, a printed "No." near the vendor letterhead is often the invoice number.
- unit is the fleet unit/truck/tractor/trailer number only when clearly supported by the invoice. A handwritten "NO.", "UNIT", "TRUCK", "TRACTOR", or "VEHICLE" field in the customer/service area can be the unit. Never use a VIN, phone number, invoice number, amount, OCR artifact, or random alphanumeric string as the unit.
- Keep invoiceNumber and unit distinct even if both are labeled "No." in different parts of the form.
- serviceDate must be YYYY-MM-DD only when month, day, AND year are clearly present. If the year is absent or unclear, return null and explain it in uncertain.
- mileage is the invoice odometer/speedometer reading only when clearly readable.
- money values are numbers without dollar signs or commas. Read the service-call/labor/parts/tax/total box carefully and preserve the exact values shown.
- workPerformed should contain only actual complaint, diagnosis, repair, recommendation, and service lines. Preserve useful line breaks. Exclude warranty/legal boilerplate, payment terms, addresses, signatures, and generic form labels.
- If handwriting could reasonably be read two ways, use null for that field and add a short explanation to uncertain.
- Do not guess from context. Do not add any prose outside the JSON object.`;

function primaryInput(imageUrls:string[]){
  return{instructions:SYSTEM_PROMPT,input:[{role:'user',content:[{type:'input_text',text:USER_PROMPT},...imageUrls.map(image_url=>({type:'input_image',image_url,detail:'high'}))]}],max_output_tokens:1800,reasoning:{effort:'low'},store:false};
}

function fallbackInput(imageUrls:string[]){
  return{messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:[{type:'text',text:USER_PROMPT},...imageUrls.map(url=>({type:'image_url',image_url:{url}}))]}],max_completion_tokens:1800,response_format:{type:'json_object'},temperature:0};
}

async function tryModel(ai:AiBinding,db:D1Like,model:string,input:unknown,options?:unknown){
  const result=await ai.run(model,input,options);
  const raw=responseText(result);
  if(!raw)throw new Error(`${model} returned no readable text.`);
  const reading=buildReading(jsonObjectFromText(raw));
  const safeCount=[reading.vendor,reading.invoiceNumber,reading.invoiceDate,reading.unit,reading.mileage,reading.totalAmount,reading.serviceSummary].filter(Boolean).length;
  if(!safeCount)throw new Error(`${model} did not return enough reliable invoice fields.`);
  return canonicalizeUnit(db,reading);
}

export async function readOutsideWorkInvoice(ai:AiBinding|undefined,db:D1Like,images:File[]){
  if(!ai?.run)throw new Error('Automatic AI invoice reader is not configured.');
  if(!images.length)throw new Error('Invoice image is required.');
  if(images.length>OUTSIDE_WORK_MAX_IMAGES)throw new Error(`Automatic invoice reader supports up to ${OUTSIDE_WORK_MAX_IMAGES} invoice pages at a time.`);
  const totalBytes=images.reduce((sum,file)=>sum+file.size,0);
  if(totalBytes>OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES)throw new Error('Invoice pages are too large for the automatic AI reader.');

  const imageUrls:string[]=[];
  for(const image of images)imageUrls.push(await imageDataUri(image));

  let reading:OutsideWorkReading|null=null;
  let model='';
  const errors:string[]=[];
  try{
    reading=await tryModel(ai,db,OUTSIDE_WORK_PRIMARY_MODEL,primaryInput(imageUrls),{gateway:{id:'default'}});
    model=OUTSIDE_WORK_PRIMARY_MODEL;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    errors.push(`primary: ${message}`);
    console.warn('Outside Work GPT-5.6 Sol invoice reader failed; using Workers AI fallback.',message);
  }
  if(!reading){
    try{
      reading=await tryModel(ai,db,OUTSIDE_WORK_FALLBACK_MODEL,fallbackInput(imageUrls));
      model=OUTSIDE_WORK_FALLBACK_MODEL;
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      errors.push(`fallback: ${message}`);
      console.warn('Outside Work fallback invoice reader failed.',message);
    }
  }
  if(!reading){
    console.error('Outside Work automatic invoice reader failed.',errors.join(' | '));
    const primaryBillingIssue=errors.some(item=>/credit|billing|payment|quota|unified/i.test(item));
    throw new Error(primaryBillingIssue
      ?'GPT-5.6 Sol is not available through this Cloudflare AI Gateway billing setup, and the fallback reader also failed. Check AI Gateway Unified Billing credits.'
      :'The automatic invoice reader could not read this document with either AI model. Try again or review the invoice manually.');
  }
  return{model,reading};
}
