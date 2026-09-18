import { matchPartReference } from './part-cross-references';

export const PARTS_RECEIVING_PRIMARY_MODEL='openai/gpt-5.6-sol';
export const PARTS_RECEIVING_FALLBACK_MODEL='@cf/qwen/qwen3.8-27b';
export const PARTS_RECEIVING_MAX_IMAGES=3;
export const PARTS_RECEIVING_MAX_IMAGE_BYTES=8*1024*1024;
export const PARTS_RECEIVING_MAX_TOTAL_IMAGE_BYTES=18*1024*1024;
const SAFE_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp']);

type AiBinding={run:(model:string,input:unknown,options?:unknown)=>Promise<unknown>};
type RawLine={partNumber?:unknown;description?:unknown;quantity?:unknown;unitCost?:unknown;lineTotal?:unknown};
type RawReading={vendorName?:unknown;invoiceNumber?:unknown;invoiceDate?:unknown;totalAmount?:unknown;lineItems?:unknown;uncertain?:unknown};

export type ReceivingLine={
  partNumber:string;
  description:string;
  quantity:number;
  unitCost:number|null;
  lineTotal:number|null;
  matchedPartId:number|null;
  canonicalPartNumber:string;
  canonicalDescription:string;
  matchedBy:string;
  matchCount:number;
};
export type PartsReceivingReading={
  vendor:string;
  invoiceNumber:string;
  invoiceDate:string;
  totalAmount:number|null;
  lineItems:ReceivingLine[];
  uncertain:string[];
};

const cleanText=(value:unknown,max=240)=>{
  const text=String(value??'').replace(/\s+/g,' ').trim();
  return !text||/^(?:null|unknown|uncertain|n\/a)$/i.test(text)?'':text.slice(0,max);
};
const positive=(value:unknown)=>{
  const number=typeof value==='number'?value:Number(String(value??'').replace(/[$,\s]/g,''));
  return Number.isFinite(number)&&number>0&&number<1_000_000?number:0;
};
const money=(value:unknown)=>{
  if(value==null||value==='')return null;
  const number=typeof value==='number'?value:Number(String(value).replace(/[$,\s]/g,''));
  return Number.isFinite(number)&&number>=0&&number<10_000_000?Number(number.toFixed(4)):null;
};
const dateValue=(value:unknown)=>{
  const text=cleanText(value,20);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(text))return'';
  return Number.isFinite(Date.parse(`${text}T12:00:00Z`))?text:'';
};

function base64FromBytes(bytes:Uint8Array){
  const chunks:string[]=[];
  for(let offset=0;offset<bytes.length;offset+=0x8000){
    chunks.push(String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length))));
  }
  return btoa(chunks.join(''));
}

async function imageDataUri(file:File){
  const type=String(file.type||'').toLowerCase();
  if(!SAFE_IMAGE_TYPES.has(type))throw new Error('Parts receiving AI accepts JPEG, PNG, or WebP page images.');
  if(file.size<=0||file.size>PARTS_RECEIVING_MAX_IMAGE_BYTES)throw new Error('Each invoice page must be 8 MB or smaller.');
  return `data:${type};base64,${base64FromBytes(new Uint8Array(await file.arrayBuffer()))}`;
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
  const direct=[row.output_text,row.response,row.result?.output_text,row.result?.response].map(contentText).find(Boolean);
  if(direct)return direct;
  const output=contentText(row.output)||contentText(row.result?.output);
  if(output)return output;
  return contentText(row.choices?.[0]?.message?.content??row.result?.choices?.[0]?.message?.content);
}

function parseJson(text:string):RawReading{
  const cleaned=text.trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'').trim();
  const start=cleaned.indexOf('{'),end=cleaned.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('AI invoice reader returned an unreadable response.');
  try{return JSON.parse(cleaned.slice(start,end+1)) as RawReading;}
  catch{throw new Error('AI invoice reader returned invalid structured data.');}
}

function uncertain(value:unknown){
  if(!Array.isArray(value))return[] as string[];
  return value.map((item)=>cleanText(item,180)).filter(Boolean).slice(0,12);
}

function cleanLines(value:unknown){
  if(!Array.isArray(value))return[] as Array<{partNumber:string;description:string;quantity:number;unitCost:number|null;lineTotal:number|null}>;
  const output:Array<{partNumber:string;description:string;quantity:number;unitCost:number|null;lineTotal:number|null}>=[];
  for(const raw of value.slice(0,80)){
    if(!raw||typeof raw!=='object')continue;
    const line=raw as RawLine;
    const partNumber=cleanText(line.partNumber,120);
    const description=cleanText(line.description,300);
    const quantity=positive(line.quantity);
    const unitCost=money(line.unitCost);
    const lineTotal=money(line.lineTotal);
    if(!partNumber&&!description)continue;
    if(quantity<=0)continue;
    output.push({partNumber,description,quantity,unitCost,lineTotal});
  }
  return output;
}

const SYSTEM_PROMPT=`You read vendor parts invoices and packing slips for a fleet maintenance inventory receiving system. Accuracy is more important than filling fields. Never invent part numbers, quantities, or prices. Northern Logistics/Norlow is the customer, not the vendor.`;
const USER_PROMPT=`Read every supplied invoice page and return ONLY one JSON object:
{
  "vendorName": string|null,
  "invoiceNumber": string|null,
  "invoiceDate": string|null,
  "totalAmount": number|null,
  "lineItems": [
    {
      "partNumber": string|null,
      "description": string|null,
      "quantity": number|null,
      "unitCost": number|null,
      "lineTotal": number|null
    }
  ],
  "uncertain": string[]
}
Rules:
- Capture actual merchandise/part lines only. Ignore subtotal, freight, tax, core-charge-only, payment, and summary rows unless they are clearly a stocked part line.
- partNumber must be the vendor/manufacturer part number exactly as shown, preserving useful dashes.
- quantity is the quantity received/shipped/invoiced for that line. Do not use pack size as quantity unless the document clearly says it is the received quantity.
- unitCost is per-unit price when clearly shown. lineTotal is that line's extended merchandise amount.
- invoiceDate must be YYYY-MM-DD only when the full date is clear.
- If a line is unreadable, omit it or explain the uncertainty. Never guess.
- Do not add prose outside the JSON object.`;

function primaryInput(images:string[]){
  return{instructions:SYSTEM_PROMPT,input:[{role:'user',content:[{type:'input_text',text:USER_PROMPT},...images.map(image_url=>({type:'input_image',image_url,detail:'high'}))]}],max_output_tokens:4500,reasoning:{effort:'low'},store:false};
}
function fallbackInput(images:string[]){
  return{messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:[{type:'text',text:USER_PROMPT},...images.map(url=>({type:'image_url',image_url:{url}}))]}],max_completion_tokens:4500,response_format:{type:'json_object'},temperature:0};
}

async function runModel(ai:AiBinding,model:string,input:unknown,options?:unknown){
  const result=await ai.run(model,input,options);
  const text=responseText(result);
  if(!text)throw new Error(`${model} returned no readable text.`);
  const raw=parseJson(text);
  return{
    vendor:cleanText(raw.vendorName,180),
    invoiceNumber:cleanText(raw.invoiceNumber,100),
    invoiceDate:dateValue(raw.invoiceDate),
    totalAmount:money(raw.totalAmount),
    lineItems:cleanLines(raw.lineItems),
    uncertain:uncertain(raw.uncertain),
  };
}

export async function readPartsReceivingInvoice(ai:AiBinding|undefined,db:D1Database,images:File[]){
  if(!ai?.run)throw new Error('Automatic parts invoice reader is not configured.');
  if(!images.length)throw new Error('Invoice image is required.');
  if(images.length>PARTS_RECEIVING_MAX_IMAGES)throw new Error(`Parts receiving supports up to ${PARTS_RECEIVING_MAX_IMAGES} invoice pages at a time.`);
  if(images.reduce((sum,file)=>sum+file.size,0)>PARTS_RECEIVING_MAX_TOTAL_IMAGE_BYTES)throw new Error('Invoice pages are too large for the automatic reader.');

  const imageUrls:string[]=[];
  for(const image of images)imageUrls.push(await imageDataUri(image));

  let base:any=null;
  let model='';
  const errors:string[]=[];
  try{
    base=await runModel(ai,PARTS_RECEIVING_PRIMARY_MODEL,primaryInput(imageUrls),{gateway:{id:'default'}});
    model=PARTS_RECEIVING_PRIMARY_MODEL;
  }catch(error){
    errors.push(`primary: ${error instanceof Error?error.message:String(error)}`);
  }
  if(!base){
    try{
      base=await runModel(ai,PARTS_RECEIVING_FALLBACK_MODEL,fallbackInput(imageUrls));
      model=PARTS_RECEIVING_FALLBACK_MODEL;
    }catch(error){
      errors.push(`fallback: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  if(!base)throw new Error(`Automatic parts invoice reader failed. ${errors.join(' | ').slice(0,500)}`);
  if(!base.lineItems.length)throw new Error('The invoice reader did not find any reliable parts lines.');

  const lineItems:ReceivingLine[]=[];
  for(const line of base.lineItems){
    const match=line.partNumber?await matchPartReference(db,line.partNumber):{matches:[]};
    const only=match.matches.length===1?match.matches[0]:null;
    lineItems.push({
      ...line,
      matchedPartId:only?.id??null,
      canonicalPartNumber:only?.partNumber??'',
      canonicalDescription:only?.description??'',
      matchedBy:only?.matchedBy??'',
      matchCount:match.matches.length,
    });
  }

  return{model,reading:{...base,lineItems} as PartsReceivingReading};
}
