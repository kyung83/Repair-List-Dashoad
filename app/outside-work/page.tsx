"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ModuleTabs from "../module-tabs";

type Equipment = { id:number; unit:string; vin:string; equipmentType:string; currentMileage:number|null };
type OutsideRecord = {
  id:number; equipmentId:number; repairId:string; unit:string; vendorName:string; invoiceNumber:string;
  invoiceDate:string; mileage:number|null; totalAmount:number; fileName:string; contentType:string;
  serviceSummary:string; createdAt:string; uploadedBy:string; originalUrl:string;
};
type Payload = { equipment:Equipment[]; records:OutsideRecord[]; error?:string };
type FormState = { equipmentId:string; vendorName:string; invoiceNumber:string; invoiceDate:string; mileage:string; totalAmount:string; serviceSummary:string };
type Detected = Partial<FormState> & { equipment?:Equipment };
type TesseractStatus = { status?:string; progress?:number };
type TesseractWorker = {
  recognize:(source:unknown)=>Promise<{data:{text:string}}>;
  setParameters?:(params:Record<string,string>)=>Promise<unknown>;
  terminate:()=>Promise<void>;
};
type TesseractOptions = {
  logger?:(status:TesseractStatus)=>void;
  workerPath?:string;
  corePath?:string;
  langPath?:string;
};
type PdfTextItem = { str?:string; hasEOL?:boolean; transform?:number[]; width?:number };
type BrowserTools = Window & {
  Tesseract?: { createWorker:(language?:string,oem?:number,options?:TesseractOptions)=>Promise<TesseractWorker> };
  pdfjsLib?: { GlobalWorkerOptions:{workerSrc:string}; getDocument:(options:{data:Uint8Array})=>{promise:Promise<any>} };
};

const emptyForm:FormState={equipmentId:"",vendorName:"",invoiceNumber:"",invoiceDate:"",mileage:"",totalAmount:"0",serviceSummary:""};
const READER_BASE="/api/outside-work-reader";
const TESSERACT_SCRIPT=`${READER_BASE}/tesseract.min.js`;
const TESSERACT_WORKER=`${READER_BASE}/tesseract-worker.min.js`;
const TESSERACT_CORE=`${READER_BASE}/core`;
const TESSERACT_LANG=`${READER_BASE}/lang`;
const PDF_SCRIPT=`${READER_BASE}/pdf.min.js`;
const PDF_WORKER=`${READER_BASE}/pdf.worker.min.js`;

function normalizeUnit(value:string){return value.toUpperCase().replace(/[^A-Z0-9]/g,"");}
function normalizeVin(value:string){return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,"");}
function cleanLine(value:string){return value.replace(/[|]+/g," ").replace(/\s+/g," ").trim();}
function linesFrom(text:string){return text.split(/\r?\n/).map(cleanLine).filter(Boolean);}
function money(value:number){return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD"});}
function when(value:string){if(!value)return"—";const parsed=new Date(value.includes("T")?value:`${value.replace(" ","T")}Z`);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}
function unique<T>(values:T[]){return [...new Set(values)];}

function parseDateToken(token:string){
  const raw=token.trim().replace(/\.$/,"");
  let year=0,month=0,day=0;
  let match=raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if(match){year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);}
  else{
    match=raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if(match){
      month=Number(match[1]);day=Number(match[2]);year=Number(match[3]);
      if(year<100)year=year<70?2000+year:1900+year;
    }else{
      const months:Record<string,number>={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
      const named=raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{2,4})$/i)
        ||raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/i);
      if(!named)return"";
      if(/^\d/.test(named[1])){day=Number(named[1]);month=months[String(named[2]).slice(0,4).toLowerCase()]??months[String(named[2]).slice(0,3).toLowerCase()]??0;year=Number(named[3]);}
      else{month=months[String(named[1]).slice(0,4).toLowerCase()]??months[String(named[1]).slice(0,3).toLowerCase()]??0;day=Number(named[2]);year=Number(named[3]);}
      if(year<100)year=year<70?2000+year:1900+year;
    }
  }
  const date=new Date(Date.UTC(year,month-1,day));
  if(!month||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return"";
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function dateTokens(line:string){
  const matches=line.match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{2,4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4})\b/gi)||[];
  return matches.map(parseDateToken).filter(Boolean);
}

function amountValues(line:string){
  const matches=line.match(/(?:\$\s*)?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|(?:\$\s*)?-?\d+\.\d{2}/g)||[];
  return matches.map(raw=>Number(raw.replace(/[$,\s]/g,""))).filter(value=>Number.isFinite(value)&&value>=0&&value<=1_000_000);
}

function valueAfterLabel(line:string,label:RegExp){
  const match=line.match(label);
  if(!match||match.index===undefined)return"";
  return cleanLine(line.slice(match.index+match[0].length).replace(/^[\s:#=.-]+/,""));
}

function cleanReference(value:string){
  const token=(value.match(/[A-Z0-9][A-Z0-9./_-]{2,30}/i)||[])[0]||"";
  if(!token||/^(?:DATE|TOTAL|DUE|AMOUNT|CUSTOMER|NUMBER|NO|PAGE)$/i.test(token))return"";
  if(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(token))return"";
  return token;
}

function matchEquipment(lines:string[],text:string,equipment:Equipment[]){
  const vinMap=new Map<string,Equipment>();
  const fullUnitMap=new Map<string,Equipment|null>();
  const numericUnitMap=new Map<string,Equipment|null>();
  for(const row of equipment){
    if(row.vin)vinMap.set(normalizeVin(row.vin),row);
    const full=normalizeUnit(row.unit);
    if(full){fullUnitMap.set(full,fullUnitMap.has(full)?null:row);}
    const numeric=(row.unit.match(/\d{2,6}/)||[])[0]||"";
    if(numeric)numericUnitMap.set(numeric,numericUnitMap.has(numeric)?null:row);
  }

  const compactUpper=text.toUpperCase();
  const vinCandidates=compactUpper.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g)||[];
  for(const candidate of vinCandidates){const found=vinMap.get(normalizeVin(candidate));if(found)return found;}

  const label=/\b(?:UNIT|UNIT\s*NO|TRUCK|TRACTOR|TRAILER|VEHICLE|EQUIPMENT|ASSET|FLEET|STOCK)\b/i;
  for(let i=0;i<lines.length;i++){
    if(!label.test(lines[i]))continue;
    const nearby=[lines[i],lines[i+1]||""].join(" ");
    const normalized=normalizeUnit(valueAfterLabel(nearby,label)||nearby);
    for(const [key,row] of fullUnitMap){if(row&&key.length>=3&&normalized.includes(key))return row;}
    const numbers=nearby.match(/\b\d{2,6}\b/g)||[];
    for(const number of numbers){const row=numericUnitMap.get(number);if(row)return row;}
  }

  return undefined;
}

function detectInvoiceNumber(lines:string[]){
  const labels=[
    /\bINVOICE\s*(?:NUMBER|NO\.?|#)\b/i,
    /\bINV\s*(?:NUMBER|NO\.?|#)\b/i,
    /\bREPAIR\s*ORDER\s*(?:NUMBER|NO\.?|#)?\b/i,
    /\bR\.?O\.?\s*(?:NUMBER|NO\.?|#)\b/i,
    /\bWORK\s*ORDER\s*(?:NUMBER|NO\.?|#)?\b/i,
    /\bW\.?O\.?\s*(?:NUMBER|NO\.?|#)\b/i,
    /\bDOCUMENT\s*(?:NUMBER|NO\.?|#)\b/i,
  ];
  for(const label of labels){
    for(let i=0;i<lines.length;i++){
      if(!label.test(lines[i]))continue;
      const same=cleanReference(valueAfterLabel(lines[i],label));
      if(same)return same;
      const next=cleanReference(lines[i+1]||"");
      if(next)return next;
    }
  }
  for(const line of lines.slice(0,40)){
    const match=line.match(/\b(?:INVOICE|INV)\s*[:#-]\s*([A-Z0-9][A-Z0-9./_-]{2,30})\b/i);
    const value=match?.[1]||"";
    if(value&&!/DATE|TOTAL/i.test(value))return value;
  }
  return"";
}

function detectDate(lines:string[]){
  const labels=[/\bSERVICE\s*DATE\b/i,/\bINVOICE\s*DATE\b/i,/\bREPAIR\s*DATE\b/i,/\bCLOSED\s*DATE\b/i,/\bCOMPLETED\s*DATE\b/i,/\bDATE\b/i];
  for(const label of labels){
    for(let i=0;i<Math.min(lines.length,80);i++){
      if(!label.test(lines[i]))continue;
      const same=dateTokens(valueAfterLabel(lines[i],label));
      if(same[0])return same[0];
      const next=dateTokens(lines[i+1]||"");
      if(next[0])return next[0];
    }
  }
  return"";
}

function detectMileage(lines:string[]){
  const label=/\b(?:ODOMETER|ODOM|ODO|MILEAGE|MILES|METER)(?:\s*(?:IN|OUT|ENDING|END))?\b/i;
  for(let i=0;i<lines.length;i++){
    if(!label.test(lines[i]))continue;
    const source=[lines[i],lines[i+1]||""].join(" ");
    const after=valueAfterLabel(source,label);
    const rawNumbers=(after.match(/\b\d[\d,]{2,9}\b/g)||[]).map(value=>Number(value.replace(/,/g,""))).filter(value=>Number.isInteger(value)&&value>=0&&value<=10_000_000);
    if(!rawNumbers.length)continue;
    if(/\bOUT\b/i.test(source)||rawNumbers.length>1)return String(Math.max(...rawNumbers));
    return String(rawNumbers[0]);
  }
  return"";
}

function detectTotal(lines:string[]){
  const labels=[/\bAMOUNT\s*DUE\b/i,/\bBALANCE\s*DUE\b/i,/\bINVOICE\s*TOTAL\b/i,/\bGRAND\s*TOTAL\b/i,/\bTOTAL\s*DUE\b/i,/\bNET\s*DUE\b/i,/\bTOTAL\b/i];
  for(const label of labels){
    for(let i=lines.length-1;i>=0;i--){
      if(!label.test(lines[i])||/\bSUB\s*TOTAL\b|\bSUBTOTAL\b|\bTAX\s*TOTAL\b/i.test(lines[i]))continue;
      const values=amountValues(valueAfterLabel(lines[i],label));
      if(values.length)return values.at(-1)!.toFixed(2);
      const next=amountValues(lines[i+1]||"");
      if(next.length)return next.at(-1)!.toFixed(2);
    }
  }
  return"";
}

function detectVendor(lines:string[]){
  let best="";let bestScore=-999;
  for(let i=0;i<Math.min(lines.length,22);i++){
    const line=lines[i];
    if(line.length<3||line.length>110||!/[A-Z]/i.test(line))continue;
    if(/NORTHERN\s+LOGISTICS|NORLOWORLD|INVOICE|REPAIR\s+ORDER|WORK\s+ORDER|BILL\s+TO|SHIP\s+TO|CUSTOMER|ACCOUNT|PAGE\s+\d|\bDATE\b|PHONE|FAX|WWW\.|HTTPS?:|@|TERMS|SALESPERSON|PO\s*#|PURCHASE\s+ORDER/i.test(line))continue;
    if(/^\d+\s+\S+|\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|BLVD|BOULEVARD|DRIVE|DR|HWY|HIGHWAY|ZIP)\b/i.test(line))continue;
    const letters=(line.match(/[A-Z]/gi)||[]).length;
    const digits=(line.match(/\d/g)||[]).length;
    if(letters<3||digits>letters)continue;
    let score=30-i;
    if(/\b(?:TRUCK|DIESEL|TIRE|SERVICE|REPAIR|MOTOR|FLEET|AUTO|AUTOMOTIVE|CENTER|CENTRE|DEALER|INC\.?|LLC|LTD|CORP|COMPANY|CO\.)\b/i.test(line))score+=40;
    if(line===line.toUpperCase())score+=8;
    if(line.length>=8&&line.length<=55)score+=8;
    if(score>bestScore){bestScore=score;best=line;}
  }
  return bestScore>=25?best:"";
}

function detectServiceLines(lines:string[]){
  const metadata=/\b(?:INVOICE|REPAIR\s*ORDER|WORK\s*ORDER|CUSTOMER|BILL\s+TO|SHIP\s+TO|PHONE|FAX|TERMS|SALESPERSON|PAYMENT|AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|INVOICE\s+TOTAL|SUB\s*TOTAL|SUBTOTAL|SALES\s+TAX|TAX\b|PART\s+NUMBER|PART\s*#|QTY|QUANTITY|UNIT\s+PRICE|EXTENDED|PAGE\s+\d)\b/i;
  const stop=/\b(?:AMOUNT\s+DUE|BALANCE\s+DUE|GRAND\s+TOTAL|INVOICE\s+TOTAL|SUB\s*TOTAL|SUBTOTAL|PAYMENT\s+METHOD|TERMS|SIGNATURE)\b/i;
  const heading=/\b(?:WORK\s+PERFORMED|SERVICE\s+DESCRIPTION|DESCRIPTION\s+OF\s+WORK|REPAIR\s+DESCRIPTION|LABOR\s+DETAIL|LABOUR\s+DETAIL|JOB\s+DESCRIPTION|CORRECTION|CAUSE|COMMENTS|TECHNICIAN\s+COMMENTS|RECOMMENDATIONS)\b/i;
  const keyword=/\b(?:REPLACE|REPLACED|REPAIR|REPAIRED|R&R|REMOVE|REMOVED|INSTALL|INSTALLED|SERVICE|SERVICED|DIAGNOS|INSPECT|ADJUST|REBUILD|RENEW|CHANGE|CHANGED|MOUNT|BALANCE|ALIGN|TIRE|BRAKE|OIL|COOLANT|FILTER|BELT|BATTERY|ALTERNATOR|STARTER|AIR\s+LEAK|WHEEL\s+SEAL|KINGPIN|TURBO|RADIATOR|HOSE|LAMP|LIGHT|WELD|DPF|DEF|CLUTCH|TRANSMISSION|ENGINE|AXLE|HUB|BEARING|SEAL|SENSOR|VALVE|CHAMBER|SPRING|SHOCK|MUDFLAP|AIRBAG|AIR\s+BAG|FIFTH\s+WHEEL|DOT|PM\b|INSPECTION|TOW|TOWED)\b/i;
  const candidates:string[]=[];

  for(let i=0;i<lines.length;i++){
    if(!heading.test(lines[i]))continue;
    for(let j=i+1;j<Math.min(lines.length,i+35);j++){
      const line=lines[j];
      if(j>i+1&&stop.test(line))break;
      if(metadata.test(line)||line.length<4||line.length>220||!/[A-Za-z]{3}/.test(line))continue;
      const moneyCount=amountValues(line).length;
      const letters=(line.match(/[A-Za-z]/g)||[]).length;
      if(moneyCount>=2&&letters<16)continue;
      candidates.push(line);
    }
    if(candidates.length)break;
  }

  for(const line of lines){
    if(line.length<4||line.length>220||metadata.test(line)||!keyword.test(line))continue;
    candidates.push(line);
  }

  return unique(candidates.map(cleanLine)).slice(0,30).join("\n");
}

function detectDocument(text:string,equipment:Equipment[]):Detected{
  const lines=linesFrom(text);
  return {
    equipment:matchEquipment(lines,text,equipment),
    invoiceNumber:detectInvoiceNumber(lines)||undefined,
    invoiceDate:detectDate(lines)||undefined,
    mileage:detectMileage(lines)||undefined,
    totalAmount:detectTotal(lines)||undefined,
    vendorName:detectVendor(lines)||undefined,
    serviceSummary:detectServiceLines(lines)||undefined,
  };
}

function pdfItemsToText(items:PdfTextItem[]){
  const positioned=items.filter(item=>String(item.str||"").trim()).map(item=>({
    text:String(item.str||"").trim(),
    x:Number(item.transform?.[4]??0),
    y:Number(item.transform?.[5]??0),
    width:Number(item.width??0),
    eol:Boolean(item.hasEOL),
  }));
  if(!positioned.some(item=>item.x||item.y))return positioned.map(item=>`${item.text}${item.eol?'\n':' '}`).join('');
  positioned.sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x);
  const rows:Array<{y:number;items:typeof positioned}>=[];
  for(const item of positioned){
    let row=rows.find(candidate=>Math.abs(candidate.y-item.y)<=2.5);
    if(!row){row={y:item.y,items:[]};rows.push(row);}
    row.items.push(item);
  }
  rows.sort((a,b)=>b.y-a.y);
  return rows.map(row=>{
    row.items.sort((a,b)=>a.x-b.x);
    let output="";let right=0;
    for(const item of row.items){
      if(output&&item.x-right>2)output+=" ";
      output+=item.text;
      right=Math.max(right,item.x+Math.max(item.width,1));
    }
    return cleanLine(output);
  }).filter(Boolean).join("\n");
}

function improveCanvasForOcr(canvas:HTMLCanvasElement){
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)return canvas;
  try{
    const image=context.getImageData(0,0,canvas.width,canvas.height);
    const data=image.data;
    for(let i=0;i<data.length;i+=4){
      const gray=.299*data[i]+.587*data[i+1]+.114*data[i+2];
      const adjusted=Math.max(0,Math.min(255,128+(gray-128)*1.55));
      data[i]=adjusted;data[i+1]=adjusted;data[i+2]=adjusted;
    }
    context.putImageData(image,0,0);
  }catch{
    // Some browsers can still OCR the original canvas if pixel access is unavailable.
  }
  return canvas;
}

async function imageFileToCanvas(file:File){
  const bitmap=await createImageBitmap(file);
  try{
    const longest=Math.max(bitmap.width,bitmap.height);
    const scale=Math.min(2.4,Math.max(1,2600/Math.max(1,longest)));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');
    if(!context)throw new Error('The browser could not prepare this image for OCR.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return improveCanvasForOcr(canvas);
  }finally{bitmap.close();}
}

function loadScript(id:string,src:string){
  return new Promise<void>((resolve,reject)=>{
    let script=document.getElementById(id) as HTMLScriptElement|null;
    if(script?.dataset.ready==='1'){resolve();return;}
    if(script?.dataset.failed==='1'){script.remove();script=null;}
    if(!script){
      script=document.createElement('script');script.id=id;script.src=src;script.async=true;script.crossOrigin='anonymous';document.head.appendChild(script);
    }
    const target=script;let settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;window.clearTimeout(timer);target.removeEventListener('load',loaded);target.removeEventListener('error',failed);if(error){target.dataset.failed='1';reject(error);}else{target.dataset.ready='1';resolve();}};
    const loaded=()=>finish();
    const failed=()=>finish(new Error('Document reader could not load. Please try Read Again.'));
    const timer=window.setTimeout(()=>finish(new Error('Document reader timed out while loading. Please try Read Again.')),20000);
    target.addEventListener('load',loaded,{once:true});target.addEventListener('error',failed,{once:true});
  });
}

export default function OutsideWorkPage(){
  const[data,setData]=useState<Payload>({equipment:[],records:[]});
  const[file,setFile]=useState<File|null>(null);
  const[previewUrl,setPreviewUrl]=useState("");
  const[rawText,setRawText]=useState("");
  const[unitInput,setUnitInput]=useState("");
  const[form,setForm]=useState<FormState>(emptyForm);
  const[message,setMessage]=useState("");
  const[progress,setProgress]=useState("");
  const[busy,setBusy]=useState(false);
  const[reading,setReading]=useState(false);
  const fileInputRef=useRef<HTMLInputElement|null>(null);

  async function load(){
    const response=await fetch('/api/outside-work',{cache:'no-store'});
    const payload=await response.json() as Payload;
    if(response.status===401){window.location.assign('/login?returnTo=/outside-work');return;}
    if(!response.ok)throw new Error(payload.error||'Outside Work Intake could not be loaded.');
    setData(payload);
    const requested=new URLSearchParams(window.location.search).get('unit')||'';
    if(requested&&!form.equipmentId){
      const found=payload.equipment.find(row=>normalizeUnit(row.unit)===normalizeUnit(requested));
      if(found){setUnitInput(found.unit);setForm(current=>({...current,equipmentId:String(found.id)}));}
    }
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Outside Work Intake could not be loaded.'));},[]);
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);

  const selectedEquipment=useMemo(()=>data.equipment.find(row=>String(row.id)===form.equipmentId)||null,[data.equipment,form.equipmentId]);

  function setChosenUnit(value:string){
    setUnitInput(value);
    const normalized=normalizeUnit(value);
    const matches=data.equipment.filter(row=>normalizeUnit(row.unit)===normalized);
    setForm(current=>({...current,equipmentId:matches.length===1?String(matches[0].id):""}));
  }

  function chooseFile(next:File|null){
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    setFile(next);setPreviewUrl(next?URL.createObjectURL(next):"");setRawText("");setProgress("");setMessage(next?`Selected ${next.name}. Starting document reader...`:"");
    const requested=new URLSearchParams(window.location.search).get('unit')||'';
    const preselected=data.equipment.find(row=>normalizeUnit(row.unit)===normalizeUnit(requested));
    setUnitInput(preselected?.unit||"");setForm(preselected?{...emptyForm,equipmentId:String(preselected.id)}:emptyForm);
  }

  function applyRules(text=rawText){
    if(!text.trim()){setMessage('There is no document text to apply rules to. You can enter the fields manually.');return;}
    const detected=detectDocument(text,data.equipment);
    const equipmentId=detected.equipment?String(detected.equipment.id):undefined;
    setForm(current=>({
      ...current,equipmentId:equipmentId??current.equipmentId,vendorName:detected.vendorName??current.vendorName,
      invoiceNumber:detected.invoiceNumber??current.invoiceNumber,invoiceDate:detected.invoiceDate??current.invoiceDate,
      mileage:detected.mileage??current.mileage,totalAmount:detected.totalAmount??current.totalAmount,
      serviceSummary:detected.serviceSummary??current.serviceSummary,
    }));
    if(detected.equipment)setUnitInput(detected.equipment.unit);
    const found=[detected.equipment?'unit':'',detected.vendorName?'vendor':'',detected.invoiceNumber?'invoice/RO':'',detected.invoiceDate?'date':'',detected.mileage?'mileage':'',detected.totalAmount?'total':'',detected.serviceSummary?'work lines':''].filter(Boolean);
    setMessage(found.length?`Reader finished. Auto-filled: ${found.join(', ')}. Check the highlighted fields against the original before saving.`:'Reader finished, but it did not find enough reliable labeled information. Leave uncertain fields blank or enter them manually.');
  }

  async function createOcrWorker(){
    setProgress('Loading OCR engine...');await loadScript('outside-work-tesseract',TESSERACT_SCRIPT);
    const api=(window as BrowserTools).Tesseract;if(!api)throw new Error('Browser OCR did not initialize.');
    const worker=await api.createWorker('eng',1,{workerPath:TESSERACT_WORKER,corePath:TESSERACT_CORE,langPath:TESSERACT_LANG,logger:status=>{const pct=typeof status.progress==='number'?` ${Math.round(status.progress*100)}%`:'';setProgress(`${status.status||'Reading scan'}${pct}`);}});
    await worker.setParameters?.({preserve_interword_spaces:'1',user_defined_dpi:'300'});
    return worker;
  }

  async function readImage(target:File){
    const worker=await createOcrWorker();let canvas:HTMLCanvasElement|null=null;
    try{setProgress('Preparing image for OCR...');canvas=await imageFileToCanvas(target);setProgress('Reading image...');return (await worker.recognize(canvas)).data.text||"";}
    catch(error){
      if(canvas)throw error;
      setProgress('Reading original image...');return (await worker.recognize(target)).data.text||"";
    }finally{await worker.terminate();if(canvas){canvas.width=1;canvas.height=1;}}
  }

  async function readPdf(target:File){
    setProgress('Loading PDF reader...');await loadScript('outside-work-pdfjs',PDF_SCRIPT);
    const pdfjs=(window as BrowserTools).pdfjsLib;if(!pdfjs)throw new Error('PDF reader did not initialize.');
    pdfjs.GlobalWorkerOptions.workerSrc=PDF_WORKER;
    const bytes=new Uint8Array(await target.arrayBuffer());const pdf=await pdfjs.getDocument({data:bytes}).promise;const pageCount=Math.min(Number(pdf.numPages||0),8);
    try{
      const direct:string[]=[];
      for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
        setProgress(`Reading PDF text ${pageNumber}/${pageCount}`);const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();direct.push(pdfItemsToText(content.items as PdfTextItem[]));
      }
      const directText=direct.join('\n').trim();
      if(directText.replace(/\s/g,'').length>=100){if(Number(pdf.numPages)>pageCount)setMessage(`This PDF has ${pdf.numPages} pages. The reader checked the first ${pageCount}; review the original before saving.`);return directText;}

      setProgress('Scanned PDF detected - starting OCR...');const worker=await createOcrWorker();
      try{
        const pages:string[]=[];
        for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
          const page=await pdf.getPage(pageNumber);const viewport=page.getViewport({scale:2.15});const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));const context=canvas.getContext('2d');if(!context)throw new Error('The browser could not create a canvas for PDF OCR.');
          setProgress(`Preparing OCR page ${pageNumber}/${pageCount}`);await page.render({canvasContext:context,viewport}).promise;improveCanvasForOcr(canvas);setProgress(`OCR page ${pageNumber}/${pageCount}`);pages.push((await worker.recognize(canvas)).data.text||'');canvas.width=1;canvas.height=1;
        }
        if(Number(pdf.numPages)>pageCount)setMessage(`This PDF has ${pdf.numPages} pages. The reader checked the first ${pageCount}; review the original before saving.`);return pages.join('\n');
      }finally{await worker.terminate();}
    }finally{if(typeof pdf.destroy==='function')await pdf.destroy();}
  }

  async function readDocument(target:File|null=file){
    if(!target){setMessage('Choose a PDF or photo. The reader will start automatically after you choose it.');fileInputRef.current?.click();return;}
    if(reading||busy)return;
    setReading(true);setMessage(`Reading ${target.name}...`);setProgress('Starting document reader...');await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
    try{
      const isPdf=target.type==='application/pdf'||target.name.toLowerCase().endsWith('.pdf');const text=isPdf?await readPdf(target):await readImage(target);const trimmed=text.trim();setRawText(trimmed);
      if(!trimmed)setMessage('Reader finished but no readable text was found. Enter the fields manually and keep the original attached.');else applyRules(trimmed);
    }catch(error){setMessage(`${error instanceof Error?error.message:'Document could not be read.'} You can press Read Again, or enter the fields manually and still save the original.`);}
    finally{setReading(false);setProgress('');}
  }

  function onFileChanged(next:File|null){chooseFile(next);if(next)void readDocument(next);}

  async function submit(event:FormEvent){
    event.preventDefault();setMessage('');
    if(!file){setMessage('Choose the original invoice or work-order file.');return;}
    if(!form.equipmentId){setMessage('Choose the exact Master Equipment unit.');return;}
    if(!form.serviceSummary.trim()){setMessage('Enter the work performed.');return;}
    setBusy(true);
    try{
      const body=new FormData();body.append('file',file);body.append('equipmentId',form.equipmentId);body.append('vendorName',form.vendorName);body.append('invoiceNumber',form.invoiceNumber);body.append('invoiceDate',form.invoiceDate);body.append('mileage',form.mileage);body.append('totalAmount',form.totalAmount);body.append('serviceSummary',form.serviceSummary);body.append('ocrText',rawText);
      const response=await fetch('/api/outside-work',{method:'POST',body});const result=await response.json() as{ok?:boolean;repairId?:string;unit?:string;error?:string};if(!response.ok||!result.ok)throw new Error(result.error||'Outside-work record could not be created.');
      setMessage(`Recorded ${result.repairId||'outside work'} for unit ${result.unit||selectedEquipment?.unit||''}. The original document is attached to the repair history.`);chooseFile(null);await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Outside-work record could not be created.');}finally{setBusy(false);}
  }

  return <main style={page}><div style={shell}>
    <ModuleTabs module="shop"/>
    <header style={{marginTop:24}}><p style={eyebrow}>SHOP · OUTSIDE WORK</p><h1 style={title}>Scan outside work into unit history</h1><p style={subtitle}>Upload a vendor PDF or take a photo. The reader rebuilds PDF rows and cleans scanned images before applying fixed invoice rules. It leaves uncertain information for you to correct instead of treating a guess as fact.</p></header>
    {message&&<div style={notice}>{message}</div>}

    <section style={{...panel,marginTop:18}}>
      <div style={sectionHead}><div><h2 style={h2}>1. Original vendor document</h2><p style={copy}>PDF, phone photo, or scan · maximum 15 MB. The original is stored with the repair record.</p></div></div>
      <div style={{display:'grid',gridTemplateColumns:'minmax(280px,.75fr) minmax(340px,1.25fr)',gap:16,alignItems:'start'}}>
        <div style={{display:'grid',gap:10}}>
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" capture="environment" disabled={reading||busy} onChange={event=>onFileChanged(event.target.files?.[0]||null)} />
          <button type="button" style={{...primary,opacity:(reading||busy)?.6:1}} disabled={reading||busy} onClick={()=>void readDocument()}>{reading?'READING DOCUMENT...':file?'READ AGAIN':'CHOOSE & READ DOCUMENT'}</button>
          {file&&<div style={selectedFile}><strong>Selected:</strong> {file.name}</div>}{progress&&<div style={progressBox}>{progress}</div>}
          <div style={small}>Auto-filled values are suggestions. The record is not created until you verify the unit, work performed and cost and press Create Outside Repair Record.</div>
        </div>
        <div style={previewBox}>{!previewUrl?<div style={empty}>Choose a document to preview it here.</div>:file?.type.startsWith('image/')?<img src={previewUrl} alt="Outside work document preview" style={{maxWidth:'100%',maxHeight:430,objectFit:'contain'}}/>:<iframe src={previewUrl} title="Outside work PDF preview" style={{width:'100%',height:430,border:0}}/>}</div>
      </div>
      <details style={{marginTop:14}} open={Boolean(rawText)}><summary style={{cursor:'pointer',fontWeight:850}}>Document text / OCR result</summary><p style={small}>If a vendor formats something unusually, correct the extracted text here and press Apply Rules to Text. This text is stored with the document for audit/search.</p><textarea value={rawText} onChange={event=>setRawText(event.target.value)} placeholder="OCR or extracted PDF text will appear here. You can also paste text manually." style={{...input,minHeight:180,fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace'}}/><button type="button" style={{...button,marginTop:8}} onClick={()=>applyRules()}>APPLY RULES TO TEXT</button></details>
    </section>

    <form onSubmit={submit} style={{...panel,marginTop:16}}>
      <div style={sectionHead}><div><h2 style={h2}>2. Review what will be recorded</h2><p style={copy}>Nothing is created until you press Create Outside Repair Record.</p></div>{selectedEquipment&&<span style={pill}>UNIT {selectedEquipment.unit}</span>}</div>
      <div style={formGrid}>
        <Field label="Master Equipment unit" help="Required. Automatic matching uses an exact VIN or a unit/truck/trailer label; ambiguous numbers are left for you."><input list="outside-work-units" required value={unitInput} onChange={event=>setChosenUnit(event.target.value)} placeholder="Unit number" style={input}/><datalist id="outside-work-units">{data.equipment.map(row=><option key={row.id} value={row.unit}>{row.vin?`VIN ${row.vin}`:row.equipmentType}</option>)}</datalist></Field>
        <Field label="Outside vendor"><input value={form.vendorName} onChange={event=>setForm({...form,vendorName:event.target.value})} placeholder="Dealer / repair shop" style={input}/></Field>
        <Field label="Invoice / RO number"><input value={form.invoiceNumber} onChange={event=>setForm({...form,invoiceNumber:event.target.value})} placeholder="Vendor invoice or repair order" style={input}/></Field>
        <Field label="Service date"><input type="date" value={form.invoiceDate} onChange={event=>setForm({...form,invoiceDate:event.target.value})} style={input}/></Field>
        <Field label="Invoice mileage" help="Stored as vendor-invoice evidence only. It never pretends Geotab updated."><input inputMode="numeric" value={form.mileage} onChange={event=>setForm({...form,mileage:event.target.value})} placeholder="Optional odometer" style={input}/></Field>
        <Field label="Invoice total ($)" help="Recorded as outside/vendor repair cost."><input type="number" min="0" max="1000000" step="0.01" value={form.totalAmount} onChange={event=>setForm({...form,totalAmount:event.target.value})} style={input}/></Field>
        <div style={{gridColumn:'1/-1'}}><Field label="Work performed" help="Required. Keep the actual vendor wording or edit it into useful repair-history lines."><textarea required value={form.serviceSummary} onChange={event=>setForm({...form,serviceSummary:event.target.value})} placeholder={'Example:\nReplace water pump\nReplace serpentine belt\nCooling system service'} style={{...input,minHeight:150}}/></Field></div>
      </div>
      {selectedEquipment&&<div style={equipmentCheck}><strong>Matched Master Equipment: {selectedEquipment.unit}</strong><span>{selectedEquipment.vin?`VIN ${selectedEquipment.vin} · `:''}{selectedEquipment.currentMileage==null?'Current dashboard mileage unavailable':`Dashboard mileage ${selectedEquipment.currentMileage.toLocaleString()} mi`}</span><small>Invoice mileage above is stored separately and does not overwrite this value.</small></div>}
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginTop:14}}><span style={small}>Creates one completed repair with source <strong>Outside Work</strong>, the vendor total, and the original document attached.</span><button type="submit" style={{...primary,minHeight:44,opacity:busy?.6:1}} disabled={busy}>{busy?'SAVING...':'CREATE OUTSIDE REPAIR RECORD'}</button></div>
    </form>

    <section style={{...panel,marginTop:16}}>
      <div style={sectionHead}><div><h2 style={h2}>Recorded outside work</h2><p style={copy}>The newest 100 vendor documents. Open the original at any time or jump to the unit.</p></div><strong>{data.records.length} shown</strong></div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:1040}}><thead><tr>{['Unit','Vendor / invoice','Service date','Mileage','Total','Work performed','Recorded','Original'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead><tbody>
        {data.records.map(row=><tr key={row.id} style={{borderTop:'1px solid #edf0f2'}}><td style={td}><a href={`/unit?unit=${encodeURIComponent(row.unit)}`} style={link}><strong>{row.unit}</strong></a><div style={mini}>{row.repairId}</div></td><td style={td}><strong>{row.vendorName||'Vendor not entered'}</strong><div style={mini}>{row.invoiceNumber||'No invoice number'}</div></td><td style={td}>{row.invoiceDate||'—'}</td><td style={td}>{row.mileage==null?'—':`${row.mileage.toLocaleString()} mi`}</td><td style={td}><strong>{money(row.totalAmount)}</strong></td><td style={{...td,maxWidth:340,whiteSpace:'pre-line'}}>{row.serviceSummary}</td><td style={td}>{when(row.createdAt)}<div style={mini}>{row.uploadedBy||'Manager'}</div></td><td style={td}><a href={row.originalUrl} target="_blank" rel="noreferrer" style={actionLink}>Open original</a></td></tr>)}
        {!data.records.length&&<tr><td colSpan={8} style={{...td,textAlign:'center',padding:28,color:'#71808c'}}>No outside-work documents have been recorded yet.</td></tr>}
      </tbody></table></div>
    </section>
  </div></main>;
}

function Field({label,help,children}:{label:string;help?:string;children:React.ReactNode}){return <label style={{display:'grid',gap:5,fontSize:11,fontWeight:900,color:'#405365'}}><span>{label}</span>{children}{help&&<small style={{fontWeight:500,color:'#74818c',lineHeight:1.35}}>{help}</small>}</label>;}

const page:CSSProperties={minHeight:'100vh',background:'#f3f5f7',padding:'0 0 90px',color:'#172536'};
const shell:CSSProperties={maxWidth:1500,margin:'0 auto',padding:'0 clamp(16px,4vw,46px)'};
const eyebrow:CSSProperties={margin:0,color:'#f47b20',fontSize:12,fontWeight:950,letterSpacing:'.14em'};
const title:CSSProperties={margin:'7px 0 0',fontSize:34,color:'#0d1b2b'};
const subtitle:CSSProperties={margin:'8px 0 0',maxWidth:1000,color:'#657381',lineHeight:1.55};
const panel:CSSProperties={background:'white',border:'1px solid #dce2e7',borderRadius:14,padding:18,boxShadow:'0 2px 10px rgba(15,32,48,.04)'};
const sectionHead:CSSProperties={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:14,flexWrap:'wrap',marginBottom:14};
const h2:CSSProperties={margin:0,fontSize:21,color:'#14283c'};
const copy:CSSProperties={margin:'5px 0 0',fontSize:13,color:'#6a7884',lineHeight:1.45};
const small:CSSProperties={fontSize:11,color:'#6c7a86',lineHeight:1.45};
const mini:CSSProperties={fontSize:10,color:'#7c8993',marginTop:3};
const notice:CSSProperties={marginTop:16,padding:'11px 13px',border:'1px solid #e2c278',borderRadius:9,background:'#fff9e8',lineHeight:1.45};
const progressBox:CSSProperties={padding:'9px 10px',borderRadius:8,background:'#eef5f8',border:'1px solid #cddde6',fontSize:12,fontWeight:800,color:'#35556b'};
const selectedFile:CSSProperties={padding:'8px 10px',borderRadius:8,background:'#f8fafb',border:'1px solid #dbe2e7',fontSize:12,color:'#435869',overflowWrap:'anywhere'};
const previewBox:CSSProperties={minHeight:250,display:'grid',placeItems:'center',border:'1px solid #dbe2e7',borderRadius:10,background:'#f8fafb',overflow:'hidden'};
const empty:CSSProperties={padding:24,color:'#7a8791',textAlign:'center'};
const input:CSSProperties={width:'100%',boxSizing:'border-box',padding:'10px 11px',border:'1px solid #cbd5dd',borderRadius:8,background:'white',color:'#172536',fontSize:13};
const button:CSSProperties={border:'1px solid #bcc9d2',borderRadius:8,padding:'9px 12px',background:'white',color:'#17324a',fontWeight:850,cursor:'pointer'};
const primary:CSSProperties={...button,border:0,background:'#0d1b2b',color:'white',fontWeight:950};
const formGrid:CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12};
const equipmentCheck:CSSProperties={display:'grid',gap:3,marginTop:13,padding:'11px 12px',border:'1px solid #cfe0d3',borderRadius:9,background:'#f4fbf5',fontSize:12,color:'#365343'};
const pill:CSSProperties={padding:'5px 9px',borderRadius:999,background:'#edf4f8',border:'1px solid #d1e0e9',fontSize:11,fontWeight:900,color:'#35566d'};
const th:CSSProperties={textAlign:'left',padding:'9px',fontSize:10,textTransform:'uppercase',letterSpacing:'.04em',color:'#64727e',background:'#f7f9fa'};
const td:CSSProperties={padding:'10px 9px',verticalAlign:'top',fontSize:12};
const link:CSSProperties={color:'#163b59',textDecoration:'none'};
const actionLink:CSSProperties={display:'inline-flex',alignItems:'center',padding:'7px 9px',border:'1px solid #cbd5dd',borderRadius:7,color:'#17324a',textDecoration:'none',fontWeight:850,fontSize:11,whiteSpace:'nowrap'};