"use client";

import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
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
type TesseractWorker = { recognize:(source:unknown)=>Promise<{data:{text:string}}>; terminate:()=>Promise<void> };
type BrowserTools = Window & {
  Tesseract?: { createWorker:(language?:string,oem?:number,options?:{logger?:(status:TesseractStatus)=>void})=>Promise<TesseractWorker> };
  pdfjsLib?: { GlobalWorkerOptions:{workerSrc:string}; getDocument:(options:{data:Uint8Array})=>{promise:Promise<any>} };
};

const emptyForm:FormState={equipmentId:"",vendorName:"",invoiceNumber:"",invoiceDate:"",mileage:"",totalAmount:"0",serviceSummary:""};
const TESSERACT_SCRIPT="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const PDF_SCRIPT="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDF_WORKER="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function normalizeUnit(value:string){return value.toUpperCase().replace(/[^A-Z0-9]/g,"");}
function normalizeVin(value:string){return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,"");}
function cleanLine(value:string){return value.replace(/\s+/g," ").trim();}
function linesFrom(text:string){return text.split(/\r?\n/).map(cleanLine).filter(Boolean);}
function money(value:number){return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD"});}
function when(value:string){if(!value)return"—";const parsed=new Date(value.includes("T")?value:`${value.replace(" ","T")}Z`);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}

function parseDateToken(token:string){
  const raw=token.trim();
  let year=0,month=0,day=0;
  let match=raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if(match){year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);}
  else{
    match=raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if(!match)return"";
    month=Number(match[1]);day=Number(match[2]);year=Number(match[3]);
    if(year<100)year=year<70?2000+year:1900+year;
  }
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return"";
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function amountFromLine(line:string){
  const matches=line.match(/-?\$?\s*\d[\d,]*\.\d{2}/g)||[];
  if(!matches.length)return"";
  const raw=matches[matches.length-1].replace(/[$,\s]/g,"");
  const value=Number(raw);
  return Number.isFinite(value)&&value>=0?value.toFixed(2):"";
}

function detectDocument(text:string,equipment:Equipment[]):Detected{
  const lines=linesFrom(text);
  const upper=text.toUpperCase();
  let matched:Equipment|undefined;

  const vins=upper.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g)||[];
  for(const vin of vins){
    matched=equipment.find(row=>row.vin&&normalizeVin(row.vin)===normalizeVin(vin));
    if(matched)break;
  }
  if(!matched){
    for(const line of lines){
      const unitMatch=line.match(/\b(?:UNIT|TRUCK|TRACTOR|TRAILER|VEHICLE|EQUIPMENT|ASSET)\b\s*(?:NO\.?|NUMBER|#)?\s*[:#-]?\s*([A-Z]{0,5}\s*\d{2,6}(?:\s*\([A-Z]{1,4}\))?)/i);
      if(!unitMatch)continue;
      const token=normalizeUnit(unitMatch[1]);
      const candidates=equipment.filter(row=>normalizeUnit(row.unit)===token);
      if(candidates.length===1){matched=candidates[0];break;}
    }
  }

  let invoiceNumber="";
  for(const line of lines){
    const match=line.match(/\b(?:INVOICE|INV)\s*(?:NO\.?|NUMBER|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,30})\b/i)
      ||line.match(/\b(?:REPAIR\s*ORDER|R\.?O\.?)\s*(?:NO\.?|NUMBER|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,30})\b/i);
    const value=match?.[1]?.trim()||"";
    if(value&&!/^(DATE|TOTAL|DUE)$/i.test(value)){invoiceNumber=value;break;}
  }

  let invoiceDate="";
  for(const line of lines){
    const match=line.match(/\b(?:INVOICE\s*DATE|SERVICE\s*DATE|REPAIR\s*DATE|DATE)\b\s*[:#-]?\s*(\d{1,4}[-/]\d{1,2}[-/]\d{1,4})/i);
    if(!match)continue;
    const parsed=parseDateToken(match[1]);
    if(parsed){invoiceDate=parsed;break;}
  }

  let mileage="";
  for(const line of lines){
    const match=line.match(/\b(?:ODOMETER(?:\s*OUT)?|MILEAGE(?:\s*OUT)?|MILES|ODO)\b\s*[:#-]?\s*([0-9][0-9,\s]{2,9})/i);
    if(!match)continue;
    const value=match[1].replace(/[^0-9]/g,"");
    const number=Number(value);
    if(Number.isInteger(number)&&number>=0&&number<=10_000_000){mileage=String(number);break;}
  }

  let totalAmount="";
  const totalMatchers=[/\bGRAND\s+TOTAL\b/i,/\bAMOUNT\s+DUE\b/i,/\bINVOICE\s+TOTAL\b/i,/\bTOTAL\s+DUE\b/i,/\bBALANCE\s+DUE\b/i];
  for(const matcher of totalMatchers){
    const line=lines.find(row=>matcher.test(row));
    if(line){totalAmount=amountFromLine(line);if(totalAmount)break;}
  }
  if(!totalAmount){
    for(const line of [...lines].reverse()){
      if(!/\bTOTAL\b/i.test(line)||/\bSUB\s*TOTAL\b/i.test(line))continue;
      totalAmount=amountFromLine(line);if(totalAmount)break;
    }
  }

  const vendorName=lines.slice(0,16).find(line=>{
    if(line.length<3||line.length>100||!/[A-Z]/i.test(line))return false;
    return !/(NORTHERN\s+LOGISTICS|NORLOWORLD|INVOICE|REPAIR\s+ORDER|BILL\s+TO|SHIP\s+TO|CUSTOMER|ACCOUNT|PAGE\s+\d|DATE\b|PHONE\b|FAX\b|WWW\.|@)/i.test(line);
  })||"";

  const serviceKeyword=/(REPLACE|REPLACED|REPAIR|REPAIRED|R&R|REMOVE|REMOVED|INSTALL|INSTALLED|SERVICE|SERVICED|DIAGNOS|INSPECT|ADJUST|REBUILD|RENEW|CHANGE|CHANGED|MOUNT|BALANCE|ALIGNMENT|TIRE|BRAKE|OIL|COOLANT|FILTER|BELT|BATTERY|ALTERNATOR|STARTER|AIR\s+LEAK|WHEEL\s+SEAL|KINGPIN|TURBO|RADIATOR|HOSE|LAMP|LIGHT|WELD|DPF|DEF|CLUTCH|TRANSMISSION|ENGINE)/i;
  const metadata=/(GRAND\s+TOTAL|AMOUNT\s+DUE|INVOICE\s+TOTAL|SUB\s*TOTAL|SALES\s+TAX|TAX\b|BILL\s+TO|SHIP\s+TO|CUSTOMER|INVOICE\s*(?:NO|NUMBER|#|DATE)|REPAIR\s+ORDER\s*(?:NO|NUMBER|#)|PHONE\b|FAX\b|PAGE\s+\d)/i;
  const serviceLines:string[]=[];
  const seen=new Set<string>();
  for(const line of lines){
    if(line.length<4||line.length>220||metadata.test(line)||!serviceKeyword.test(line))continue;
    const key=line.toUpperCase();
    if(seen.has(key))continue;
    seen.add(key);serviceLines.push(line);
    if(serviceLines.length>=24)break;
  }

  return {
    equipment:matched,
    equipmentId:matched?String(matched.id):undefined,
    vendorName:vendorName||undefined,
    invoiceNumber:invoiceNumber||undefined,
    invoiceDate:invoiceDate||undefined,
    mileage:mileage||undefined,
    totalAmount:totalAmount||undefined,
    serviceSummary:serviceLines.length?serviceLines.join("\n"):undefined,
  };
}

function loadScript(id:string,src:string){
  return new Promise<void>((resolve,reject)=>{
    const existing=document.getElementById(id) as HTMLScriptElement|null;
    if(existing){
      if(existing.dataset.ready==='1'){resolve();return;}
      existing.addEventListener('load',()=>resolve(),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Document-reading library could not be loaded.')), {once:true});
      return;
    }
    const script=document.createElement('script');
    script.id=id;script.src=src;script.async=true;
    script.addEventListener('load',()=>{script.dataset.ready='1';resolve();},{once:true});
    script.addEventListener('error',()=>reject(new Error('Document-reading library could not be loaded.')), {once:true});
    document.head.appendChild(script);
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
    setFile(next);setPreviewUrl(next?URL.createObjectURL(next):"");setRawText("");setProgress("");setMessage("");
    const requested=new URLSearchParams(window.location.search).get('unit')||'';
    const preselected=data.equipment.find(row=>normalizeUnit(row.unit)===normalizeUnit(requested));
    setUnitInput(preselected?.unit||"");
    setForm(preselected?{...emptyForm,equipmentId:String(preselected.id)}:emptyForm);
  }

  function applyRules(text=rawText){
    if(!text.trim()){setMessage('There is no document text to apply rules to. You can enter the fields manually.');return;}
    const detected=detectDocument(text,data.equipment);
    setForm(current=>({
      ...current,
      equipmentId:detected.equipmentId??current.equipmentId,
      vendorName:detected.vendorName??current.vendorName,
      invoiceNumber:detected.invoiceNumber??current.invoiceNumber,
      invoiceDate:detected.invoiceDate??current.invoiceDate,
      mileage:detected.mileage??current.mileage,
      totalAmount:detected.totalAmount??current.totalAmount,
      serviceSummary:detected.serviceSummary??current.serviceSummary,
    }));
    if(detected.equipment)setUnitInput(detected.equipment.unit);
    const found=[detected.equipment?'unit':'',detected.vendorName?'vendor':'',detected.invoiceNumber?'invoice':'',detected.invoiceDate?'date':'',detected.mileage?'mileage':'',detected.totalAmount?'total':'',detected.serviceSummary?'work lines':''].filter(Boolean);
    setMessage(found.length?`Rules found: ${found.join(', ')}. Review everything before saving.`:'No reliable labeled fields were found. Enter the information manually and save the original document.');
  }

  async function createOcrWorker(){
    await loadScript('outside-work-tesseract',TESSERACT_SCRIPT);
    const api=(window as BrowserTools).Tesseract;
    if(!api)throw new Error('Browser OCR did not initialize.');
    return api.createWorker('eng',1,{logger:status=>{
      const pct=typeof status.progress==='number'?` ${Math.round(status.progress*100)}%`:'';
      setProgress(`${status.status||'Reading scan'}${pct}`);
    }});
  }

  async function readImage(target:File){
    const worker=await createOcrWorker();
    try{return (await worker.recognize(target)).data.text||"";}finally{await worker.terminate();}
  }

  async function readPdf(target:File){
    await loadScript('outside-work-pdfjs',PDF_SCRIPT);
    const pdfjs=(window as BrowserTools).pdfjsLib;
    if(!pdfjs)throw new Error('PDF reader did not initialize.');
    pdfjs.GlobalWorkerOptions.workerSrc=PDF_WORKER;
    const bytes=new Uint8Array(await target.arrayBuffer());
    const pdf=await pdfjs.getDocument({data:bytes}).promise;
    const pageCount=Math.min(Number(pdf.numPages||0),5);
    try{
      const direct:string[]=[];
      for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
        setProgress(`Reading PDF text ${pageNumber}/${pageCount}`);
        const page=await pdf.getPage(pageNumber);
        const content=await page.getTextContent();
        const text=(content.items as Array<{str?:string;hasEOL?:boolean}>).map(item=>`${item.str||''}${item.hasEOL?'\n':' '}`).join('');
        direct.push(text);
      }
      const directText=direct.join('\n').trim();
      if(directText.replace(/\s/g,'').length>=120){
        setProgress(Number(pdf.numPages)>pageCount?`Read text from first ${pageCount} pages`:'PDF text read directly');
        return directText;
      }

      setProgress('Scanned PDF detected - starting browser OCR');
      const worker=await createOcrWorker();
      try{
        const pages:string[]=[];
        for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
          const page=await pdf.getPage(pageNumber);
          const viewport=page.getViewport({scale:1.55});
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
          const context=canvas.getContext('2d');
          if(!context)throw new Error('The browser could not create a canvas for PDF OCR.');
          setProgress(`OCR page ${pageNumber}/${pageCount}`);
          await page.render({canvasContext:context,viewport}).promise;
          pages.push((await worker.recognize(canvas)).data.text||'');
          canvas.width=1;canvas.height=1;
        }
        if(Number(pdf.numPages)>pageCount)setMessage(`This PDF has ${pdf.numPages} pages. Version 1 read the first ${pageCount}; review the original before saving.`);
        return pages.join('\n');
      }finally{await worker.terminate();}
    }finally{if(typeof pdf.destroy==='function')await pdf.destroy();}
  }

  async function readDocument(){
    if(!file){setMessage('Choose a PDF or photo first.');return;}
    setReading(true);setMessage('');setProgress('Starting document reader...');
    try{
      const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
      const text=isPdf?await readPdf(file):await readImage(file);
      setRawText(text.trim());
      if(!text.trim())setMessage('No readable text was found. Enter the fields manually and keep the original attached.');
      else applyRules(text);
    }catch(error){
      setMessage(`${error instanceof Error?error.message:'Document could not be read.'} You can still enter the fields manually and upload the original.`);
    }finally{setReading(false);setProgress('');}
  }

  async function submit(event:FormEvent){
    event.preventDefault();setMessage('');
    if(!file){setMessage('Choose the original invoice or work-order file.');return;}
    if(!form.equipmentId){setMessage('Choose the exact Master Equipment unit.');return;}
    if(!form.serviceSummary.trim()){setMessage('Enter the work performed.');return;}
    setBusy(true);
    try{
      const body=new FormData();
      body.append('file',file);body.append('equipmentId',form.equipmentId);body.append('vendorName',form.vendorName);
      body.append('invoiceNumber',form.invoiceNumber);body.append('invoiceDate',form.invoiceDate);body.append('mileage',form.mileage);
      body.append('totalAmount',form.totalAmount);body.append('serviceSummary',form.serviceSummary);body.append('ocrText',rawText);
      const response=await fetch('/api/outside-work',{method:'POST',body});
      const result=await response.json() as{ok?:boolean;repairId?:string;unit?:string;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||'Outside-work record could not be created.');
      setMessage(`Recorded ${result.repairId||'outside work'} for unit ${result.unit||selectedEquipment?.unit||''}. The original document is attached to the repair history.`);
      chooseFile(null);await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Outside-work record could not be created.');}finally{setBusy(false);}
  }

  return <main style={page}><div style={shell}>
    <ModuleTabs module="shop"/>
    <header style={{marginTop:24}}>
      <p style={eyebrow}>SHOP · OUTSIDE WORK</p>
      <h1 style={title}>Scan outside work into unit history</h1>
      <p style={subtitle}>Upload a vendor PDF or take a photo. Digital PDFs are read directly; photos and scanned PDFs use ordinary browser OCR. No generative AI decides what gets recorded. You review every field before a repair record is created.</p>
    </header>

    {message&&<div style={notice}>{message}</div>}

    <section style={{...panel,marginTop:18}}>
      <div style={sectionHead}><div><h2 style={h2}>1. Original vendor document</h2><p style={copy}>PDF, phone photo, or scan · maximum 15 MB. The original is stored with the repair record.</p></div></div>
      <div style={{display:'grid',gridTemplateColumns:'minmax(280px,.75fr) minmax(340px,1.25fr)',gap:16,alignItems:'start'}}>
        <div style={{display:'grid',gap:10}}>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={event=>chooseFile(event.target.files?.[0]||null)} />
          <button type="button" style={primary} disabled={!file||reading||busy} onClick={()=>void readDocument()}>{reading?'Reading document...':'READ DOCUMENT'}</button>
          {progress&&<div style={progressBox}>{progress}</div>}
          <div style={small}><strong>Without OCR:</strong> you can skip Read Document, enter the fields yourself, and still save the original invoice. OCR only reads characters; it does not create the maintenance record.</div>
        </div>
        <div style={previewBox}>
          {!previewUrl?<div style={empty}>Choose a document to preview it here.</div>:file?.type.startsWith('image/')?<img src={previewUrl} alt="Outside work document preview" style={{maxWidth:'100%',maxHeight:430,objectFit:'contain'}}/>:<iframe src={previewUrl} title="Outside work PDF preview" style={{width:'100%',height:430,border:0}}/>}
        </div>
      </div>
      <details style={{marginTop:14}} open={Boolean(rawText)}>
        <summary style={{cursor:'pointer',fontWeight:850}}>Document text / OCR result</summary>
        <p style={small}>You can paste or correct text here, then run the fixed rules again. This text is saved for audit/search with the scanned document.</p>
        <textarea value={rawText} onChange={event=>setRawText(event.target.value)} placeholder="OCR or extracted PDF text will appear here. You can also paste text manually." style={{...input,minHeight:180,fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace'}}/>
        <button type="button" style={{...button,marginTop:8}} onClick={()=>applyRules()}>APPLY RULES TO TEXT</button>
      </details>
    </section>

    <form onSubmit={submit} style={{...panel,marginTop:16}}>
      <div style={sectionHead}><div><h2 style={h2}>2. Review what will be recorded</h2><p style={copy}>Nothing is created until you press Create Outside Repair Record.</p></div>{selectedEquipment&&<span style={pill}>UNIT {selectedEquipment.unit}</span>}</div>
      <div style={formGrid}>
        <Field label="Master Equipment unit" help="Required. OCR only selects when the unit or VIN is an exact match."><input list="outside-work-units" required value={unitInput} onChange={event=>setChosenUnit(event.target.value)} placeholder="Unit number" style={input}/><datalist id="outside-work-units">{data.equipment.map(row=><option key={row.id} value={row.unit}>{row.vin?`VIN ${row.vin}`:row.equipmentType}</option>)}</datalist></Field>
        <Field label="Outside vendor"><input value={form.vendorName} onChange={event=>setForm({...form,vendorName:event.target.value})} placeholder="Dealer / repair shop" style={input}/></Field>
        <Field label="Invoice / RO number"><input value={form.invoiceNumber} onChange={event=>setForm({...form,invoiceNumber:event.target.value})} placeholder="Vendor invoice or repair order" style={input}/></Field>
        <Field label="Service date"><input type="date" value={form.invoiceDate} onChange={event=>setForm({...form,invoiceDate:event.target.value})} style={input}/></Field>
        <Field label="Invoice mileage" help="Stored as vendor-invoice evidence only. It never pretends Geotab updated."><input inputMode="numeric" value={form.mileage} onChange={event=>setForm({...form,mileage:event.target.value})} placeholder="Optional odometer" style={input}/></Field>
        <Field label="Invoice total ($)" help="Recorded as outside/vendor repair cost."><input type="number" min="0" max="1000000" step="0.01" value={form.totalAmount} onChange={event=>setForm({...form,totalAmount:event.target.value})} style={input}/></Field>
        <div style={{gridColumn:'1/-1'}}><Field label="Work performed" help="Required. Keep the actual vendor wording or edit it into useful repair-history lines."><textarea required value={form.serviceSummary} onChange={event=>setForm({...form,serviceSummary:event.target.value})} placeholder={'Example:\nReplace water pump\nReplace serpentine belt\nCooling system service'} style={{...input,minHeight:150}}/></Field></div>
      </div>
      {selectedEquipment&&<div style={equipmentCheck}><strong>Matched Master Equipment: {selectedEquipment.unit}</strong><span>{selectedEquipment.vin?`VIN ${selectedEquipment.vin} · `:''}{selectedEquipment.currentMileage==null?'Current dashboard mileage unavailable':`Dashboard mileage ${selectedEquipment.currentMileage.toLocaleString()} mi`}</span><small>Invoice mileage above is stored separately and does not overwrite this value.</small></div>}
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginTop:14}}><span style={small}>Creates one completed repair with source <strong>Outside Work</strong>, the vendor total, and the original document attached.</span><button type="submit" style={{...primary,minHeight:44}} disabled={busy}>{busy?'SAVING...':'CREATE OUTSIDE REPAIR RECORD'}</button></div>
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
