"use client";

import {useEffect,useRef,useState,type CSSProperties} from "react";

type Reading={
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
type ApiResult={ok?:boolean;model?:string;reading?:Reading;error?:string};
type PdfLib={GlobalWorkerOptions:{workerSrc:string};getDocument:(options:{data:Uint8Array})=>{promise:Promise<any>}};
type BrowserTools=Window&{pdfjsLib?:PdfLib};
type ReaderState="idle"|"reading"|"success"|"error";

const PDF_SCRIPT="/api/outside-work-reader/pdf.min.js";
const PDF_WORKER="/api/outside-work-reader/pdf.worker.min.js";
const MAX_AI_PAGES=3;

function delay(ms:number){return new Promise<void>(resolve=>window.setTimeout(resolve,ms));}
function modelLabel(model:string){
  if(model==="openai/gpt-5.6-sol")return"GPT-5.6 Sol";
  if(model==="@cf/qwen/qwen3.8-27b")return"Qwen 3.8 27B fallback";
  return model||"AI";
}

function setReactValue(target:HTMLInputElement|HTMLTextAreaElement|null,value:string){
  if(!target||!value)return false;
  const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const descriptor=Object.getOwnPropertyDescriptor(prototype,"value");
  descriptor?.set?.call(target,value);
  target.dispatchEvent(new Event("input",{bubbles:true}));
  target.dispatchEvent(new Event("change",{bubbles:true}));
  return true;
}

function targetFields(){
  const unit=document.querySelector<HTMLInputElement>('input[placeholder="Unit number"]');
  const form=unit?.closest("form");
  if(!form)return null;
  return{
    unit,
    vendor:form.querySelector<HTMLInputElement>('input[placeholder="Dealer / repair shop"]'),
    invoice:form.querySelector<HTMLInputElement>('input[placeholder="Vendor invoice or repair order"]'),
    date:form.querySelector<HTMLInputElement>('input[type="date"]'),
    mileage:form.querySelector<HTMLInputElement>('input[placeholder="Optional odometer"]'),
    total:form.querySelector<HTMLInputElement>('input[type="number"]'),
    work:form.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Example:"]'),
    form,
  };
}

function nativeReaderBusy(){
  const camera=document.getElementById("outside-work-camera-input") as HTMLInputElement|null;
  const upload=document.getElementById("outside-work-file-input") as HTMLInputElement|null;
  const retry=Array.from(document.querySelectorAll("button")).find(button=>/READING DOCUMENT|READ THIS SOURCE AGAIN/i.test(button.textContent||""));
  return Boolean(camera?.disabled||upload?.disabled||/READING DOCUMENT/i.test(retry?.textContent||""));
}

async function waitForNativeReader(requestStillCurrent:()=>boolean){
  const started=Date.now();
  let sawBusy=false;
  while(Date.now()-started<90000){
    if(!requestStillCurrent())return false;
    const busy=nativeReaderBusy();
    if(busy)sawBusy=true;
    if(!busy&&(sawBusy||Date.now()-started>800)){
      await delay(250);
      return requestStillCurrent();
    }
    await delay(150);
  }
  return requestStillCurrent();
}

function summary(reading:Reading){
  return[
    reading.vendor&&`Vendor ${reading.vendor}`,
    reading.invoiceNumber&&`Invoice ${reading.invoiceNumber}`,
    reading.unit&&`Unit ${reading.unit}`,
    reading.invoiceDate&&`Date ${reading.invoiceDate}`,
    reading.totalAmount&&`Total $${reading.totalAmount}`,
  ].filter(Boolean).join(" · ");
}

function loadPdfScript(){
  return new Promise<void>((resolve,reject)=>{
    if((window as BrowserTools).pdfjsLib){resolve();return;}
    let script=document.getElementById("outside-work-pdfjs") as HTMLScriptElement|null;
    if(script?.dataset.failed==="1"){
      script.remove();
      script=null;
    }
    if(!script){
      script=document.createElement("script");
      script.id="outside-work-pdfjs";
      script.src=PDF_SCRIPT;
      script.async=true;
      script.crossOrigin="anonymous";
      document.head.appendChild(script);
    }
    const target=script;
    let settled=false;
    const finish=(error?:Error)=>{
      if(settled)return;
      settled=true;
      window.clearTimeout(timer);
      target.removeEventListener("load",loaded);
      target.removeEventListener("error",failed);
      if(error){target.dataset.failed="1";reject(error);}else resolve();
    };
    const loaded=()=>finish();
    const failed=()=>finish(new Error("Invoice PDF reader could not load for handwriting recognition."));
    const timer=window.setTimeout(()=>finish(new Error("Invoice PDF reader timed out.")),20000);
    target.addEventListener("load",loaded,{once:true});
    target.addEventListener("error",failed,{once:true});
  });
}

function canvasBlob(canvas:HTMLCanvasElement,type="image/jpeg",quality=.9){
  return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Invoice page could not be prepared for handwriting recognition.")),type,quality));
}

async function imagePage(file:File){
  try{
    const bitmap=await createImageBitmap(file);
    try{
      const longest=Math.max(bitmap.width,bitmap.height);
      const scale=Math.min(1,2400/Math.max(1,longest));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext("2d");
      if(!context)throw new Error("Invoice image could not be prepared for handwriting recognition.");
      context.fillStyle="#fff";
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await canvasBlob(canvas);
      canvas.width=1;
      canvas.height=1;
      return blob;
    }finally{bitmap.close();}
  }catch(error){
    if(["image/jpeg","image/png","image/webp"].includes(file.type))return file;
    throw error;
  }
}

async function pdfPages(file:File){
  await loadPdfScript();
  const pdfjs=(window as BrowserTools).pdfjsLib;
  if(!pdfjs)throw new Error("Invoice PDF reader did not initialize.");
  pdfjs.GlobalWorkerOptions.workerSrc=PDF_WORKER;
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{
    const count=Math.min(Number(pdf.numPages||0),MAX_AI_PAGES);
    if(!count)throw new Error("Invoice PDF has no readable pages.");
    const pages:Blob[]=[];
    for(let pageNumber=1;pageNumber<=count;pageNumber++){
      const page=await pdf.getPage(pageNumber);
      const base=page.getViewport({scale:1});
      const scale=Math.min(2.25,2400/Math.max(1,base.width,base.height));
      const viewport=page.getViewport({scale:Math.max(1.5,scale)});
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(viewport.width));
      canvas.height=Math.max(1,Math.round(viewport.height));
      const context=canvas.getContext("2d");
      if(!context)throw new Error("Invoice PDF page could not be rendered for handwriting recognition.");
      context.fillStyle="#fff";
      context.fillRect(0,0,canvas.width,canvas.height);
      await page.render({canvasContext:context,viewport}).promise;
      pages.push(await canvasBlob(canvas));
      canvas.width=1;
      canvas.height=1;
    }
    return pages;
  }finally{
    if(typeof pdf.destroy==="function")await pdf.destroy();
  }
}

async function preparedPages(file:File){
  const isPdf=file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf");
  return isPdf?pdfPages(file):[await imagePage(file)];
}

function applyReading(reading:Reading){
  const fields=targetFields();
  if(!fields)throw new Error("Outside Work review form is not ready. Reload this page and try again.");
  let count=0;
  count+=Number(setReactValue(fields.unit,reading.unit));
  count+=Number(setReactValue(fields.vendor,reading.vendor));
  count+=Number(setReactValue(fields.invoice,reading.invoiceNumber));
  count+=Number(setReactValue(fields.date,reading.invoiceDate));
  count+=Number(setReactValue(fields.mileage,reading.mileage));
  count+=Number(setReactValue(fields.total,reading.totalAmount));
  count+=Number(setReactValue(fields.work,reading.serviceSummary));
  fields.unit?.blur();
  if(!count)throw new Error("AI handwriting reader did not find any safe fields to apply.");
  return{count,form:fields.form};
}

export default function AiReadingBridge(){
  const[state,setState]=useState<ReaderState>("idle");
  const[message,setMessage]=useState("Scan or upload an invoice once. Printed OCR runs first, then AI handwriting results are applied automatically.");
  const[reading,setReading]=useState<Reading|null>(null);
  const[lastFile,setLastFile]=useState<File|null>(null);
  const[model,setModel]=useState("");
  const requestId=useRef(0);

  async function readInvoice(file:File){
    const id=++requestId.current;
    setLastFile(file);
    setReading(null);
    setModel("");
    setState("reading");
    setMessage("Reading handwriting with GPT-5.6 Sol while the normal invoice reader finishes…");
    try{
      const pages=await preparedPages(file);
      if(id!==requestId.current)return;
      const body=new FormData();
      pages.forEach((page,index)=>body.append("image",page,`invoice-page-${index+1}.jpg`));
      const response=await fetch("/api/outside-work/ai-read",{method:"POST",body,cache:"no-store"});
      const result=await response.json() as ApiResult;
      if(!response.ok||!result.ok||!result.reading)throw new Error(result.error||"AI handwriting reader could not read this invoice.");
      if(id!==requestId.current)return;
      const usedModel=modelLabel(result.model||"");
      setModel(result.model||"");
      setMessage(`${usedModel} finished reading. Waiting for the printed OCR pass to finish before filling Step 2…`);
      const stillCurrent=await waitForNativeReader(()=>id===requestId.current);
      if(!stillCurrent)return;
      const applied=applyReading(result.reading);
      setReading(result.reading);
      setState("success");
      const warning=result.reading.uncertain.length?` ${result.reading.uncertain.length} item${result.reading.uncertain.length===1?"":"s"} still need verification from the original.`:"";
      setMessage(`${usedModel} read this invoice and filled ${applied.count} review field${applied.count===1?"":"s"} after OCR.${warning}`);
      window.setTimeout(()=>applied.form.scrollIntoView({behavior:"smooth",block:"start"}),250);
    }catch(error){
      if(id!==requestId.current)return;
      setState("error");
      setMessage(`${error instanceof Error?error.message:"AI handwriting reader failed."} The normal printed OCR still works; you can correct any remaining fields manually.`);
    }
  }

  useEffect(()=>{
    const handler=(event:Event)=>{
      const input=event.target as HTMLInputElement|null;
      if(!input||!(input.id==="outside-work-camera-input"||input.id==="outside-work-file-input"))return;
      const file=input.files?.[0];
      if(file)window.setTimeout(()=>void readInvoice(file),0);
    };
    document.addEventListener("change",handler,true);
    return()=>document.removeEventListener("change",handler,true);
  },[]);

  const tone=state==="success"?success:state==="error"?failure:state==="reading"?active:ready;
  const badgeText=state==="reading"?"GPT-5.6 SOL · READING":state==="success"?`${modelLabel(model).toUpperCase()} · FILLED`:state==="error"?"AI NEEDS ATTENTION":"AI READY";
  return <section style={{...card,...tone,...(state==="idle"?{}:sticky)}} aria-label="Automatic AI handwriting reader" data-ai-reading-inline-card="true">
    <div style={row}>
      <div style={{minWidth:0}}>
        <div style={eyebrow}>{state==="reading"?"AI READING INVOICE":state==="success"?"AI READING COMPLETE":state==="error"?"AI READER NEEDS ATTENTION":"AUTOMATIC HANDWRITING READER"}</div>
        <h2 style={title}>{state==="idle"?"Handwriting is read automatically":"Outside Work invoice reader"}</h2>
        <p style={copy}>{message}</p>
        {reading&&<div style={summaryBox}><strong>{summary(reading)||"Invoice fields detected"}</strong>{reading.uncertain.length>0&&<span>{reading.uncertain.slice(0,4).map(item=><span key={item}>• {item}</span>)}</span>}</div>}
      </div>
      {lastFile&&state==="error"?<button type="button" style={retry} onClick={()=>void readInvoice(lastFile)}>TRY AI AGAIN</button>:<span style={badge}>{badgeText}</span>}
    </div>
    <p style={foot}>The original invoice remains attached. GPT-5.6 Sol is tried first; if it is unavailable, the screen explicitly shows the fallback model. AI values are applied only after normal OCR so OCR cannot overwrite them.</p>
  </section>;
}

const card:CSSProperties={width:"calc(100% - 32px)",maxWidth:1468,boxSizing:"border-box",margin:"12px auto 0",borderRadius:14,padding:16,boxShadow:"0 2px 10px rgba(15,32,48,.04)",color:"#172536"};
const sticky:CSSProperties={position:"sticky",top:112,zIndex:80,boxShadow:"0 8px 24px rgba(15,32,48,.16)"};
const ready:CSSProperties={background:"#f2f8fb",border:"1px solid #b7d1df"};
const active:CSSProperties={background:"#eef7fb",border:"2px solid #7daec7"};
const success:CSSProperties={background:"#f1faf4",border:"2px solid #9bc5a7"};
const failure:CSSProperties={background:"#fff9e8",border:"2px solid #dfc16e"};
const row:CSSProperties={display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"};
const eyebrow:CSSProperties={fontSize:10,fontWeight:950,letterSpacing:1.05,color:"#507287"};
const title:CSSProperties={margin:"3px 0 0",fontSize:20,lineHeight:1.15,color:"#123348"};
const copy:CSSProperties={fontSize:13,lineHeight:1.5,color:"#526c7b",margin:"7px 0 0",maxWidth:980};
const badge:CSSProperties={display:"inline-flex",alignItems:"center",minHeight:34,padding:"0 11px",borderRadius:999,background:"#fff",border:"1px solid #b9cbd5",fontSize:10,fontWeight:950,letterSpacing:.4,color:"#31566b",whiteSpace:"nowrap"};
const retry:CSSProperties={border:"1px solid #b89b4a",borderRadius:9,padding:"9px 12px",background:"#fff",color:"#604d18",fontWeight:900,cursor:"pointer",whiteSpace:"nowrap"};
const summaryBox:CSSProperties={display:"grid",gap:5,marginTop:10,padding:"10px 11px",borderRadius:9,background:"rgba(255,255,255,.8)",border:"1px solid rgba(130,160,175,.35)",fontSize:12,color:"#3d5968"};
const foot:CSSProperties={fontSize:11,lineHeight:1.4,color:"#71828b",margin:"10px 0 0"};
