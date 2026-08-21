"use client";

import { useEffect } from "react";
import OutsideWorkIntake from "./file-intake";
import {
  parseOutsideWorkInvoice,
  suspiciousInvoiceNumber,
  suspiciousServiceSummary,
  suspiciousVendor,
} from "./invoice-parser-v3";
import { detectVendorPhone, normalizePhone, validateSimpleInvoiceArithmetic } from "./invoice-validation.js";

type Candidate={value:string;confidence:number;source:string};
type ParsedInvoice={
  vendor:Candidate;
  payee?:Candidate;
  invoiceNumber:Candidate;
  invoiceDate:Candidate;
  mileage:Candidate;
  totalAmount:Candidate;
  serviceSummary:Candidate;
  documentKind?:"repair_invoice"|"payment_receipt";
};
type VisionField={value:string;confidence:number};
type VisionFields={
  vendorName:VisionField;
  invoiceNumber:VisionField;
  serviceDate:VisionField;
  unitNumber:VisionField;
  mileage:VisionField;
  totalAmount:VisionField;
  workPerformed:{value:string[];confidence:number};
};
type VisionResponse={ok?:boolean;fields?:VisionFields;normalizedText?:string;error?:string;detail?:string};
type VendorMaster={id:number;name:string;phone:string};
type VendorMasterResponse={vendors?:VendorMaster[];error?:string};
type PdfTools=Window&{pdfjsLib?:{GlobalWorkerOptions:{workerSrc:string};getDocument:(options:{data:Uint8Array})=>{promise:Promise<any>}}};

const PDF_WORKER="/api/outside-work-reader/pdf.worker.min.js";
const ACTION_WORD=/\b(?:REPLAC(?:E|ED)|REPAIR(?:ED)?|INSTALL(?:ED)?|PROGRAM(?:MED)?|REASSEMBL(?:E|ED)|TEST(?:ED)?|VERIF(?:Y|IED)|SERVIC(?:ED|ING)|CHANG(?:E|ED)|MOUNT(?:ED)?|BALANC(?:E|ED)|ALIGN(?:ED)?|TOW(?:ED|ING)|PICK(?:ED)?\s+UP|REMOV(?:E|ED)|ADJUST(?:ED)?|DIAGNOS(?:E|ED|IS)|WELD(?:ED)?|REBUILD|REBUILT|RESET|REGEN(?:ERAT(?:E|ED|ION))?|INSPECT(?:ED)?)\b/i;

function findFieldLabel(prefix:string){return Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(label=>(label.textContent||"").trim().startsWith(prefix))||null;}
function findInput(prefix:string){return findFieldLabel(prefix)?.querySelector<HTMLInputElement>("input")||null;}
function findTextarea(prefix:string){return findFieldLabel(prefix)?.querySelector<HTMLTextAreaElement>("textarea")||null;}
function findOcrTextarea(){return Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(item=>item.placeholder.includes("OCR or extracted PDF text"))||null;}
function setReactInputValue(input:HTMLInputElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));}
function setReactTextAreaValue(textarea:HTMLTextAreaElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;if(setter)setter.call(textarea,value);else textarea.value=value;textarea.dispatchEvent(new Event("input",{bubbles:true}));}
function canTouch(element:HTMLElement|null){return Boolean(element&&document.activeElement!==element);}
function applyInput(element:HTMLInputElement|null,candidate:Candidate,threshold:number,forceWindow:boolean,suspicious?:(value:string)=>boolean){if(!element||candidate.confidence<threshold||!candidate.value||!canTouch(element)||suspicious?.(candidate.value))return;const current=element.value.trim();if(current===candidate.value)return;if(forceWindow||!current||suspicious?.(current))setReactInputValue(element,candidate.value);}
function applyTextarea(element:HTMLTextAreaElement|null,candidate:Candidate,threshold:number,forceWindow:boolean,suspicious?:(value:string)=>boolean){if(!element||candidate.confidence<threshold||!candidate.value||!canTouch(element)||suspicious?.(candidate.value))return;const current=element.value.trim();if(current===candidate.value)return;if(forceWindow||!current||suspicious?.(current))setReactTextAreaValue(element,candidate.value);}
function clearSuspiciousInput(element:HTMLInputElement|null,test:(value:string)=>boolean,forceWindow:boolean){if(!forceWindow||!element||!canTouch(element))return;const current=element.value.trim();if(current&&test(current))setReactInputValue(element,"");}
function clearSuspiciousTextarea(element:HTMLTextAreaElement|null,test:(value:string)=>boolean,forceWindow:boolean){if(!forceWindow||!element||!canTouch(element))return;const current=element.value.trim();if(current&&test(current))setReactTextAreaValue(element,"");}
function fileKey(file:File){return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;}
function isPdf(file:File){return file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf");}
function headerOnlyWork(value:string,vendor:string){
  const text=value.trim();if(!text)return false;
  const normalized=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
  const vendorWords=new Set(normalized(vendor).split(" ").filter(word=>word.length>2));
  const workWords=normalized(text).split(" ").filter(word=>word.length>2);
  const overlap=workWords.filter(word=>vendorWords.has(word)).length;
  const marketing=/\b(?:24\s+HOUR\s+SERVICE|SINCE\s+19\d\d|SERVICE,?\s+INC|REPAIR\s+SERVICE,?\s+INC)\b/i.test(text);
  if(text.length<180&&(overlap>=2||marketing))return true;
  return false;
}
function trustworthyFieldCount(parsed:ParsedInvoice|null){
  if(!parsed)return 0;
  let score=0;
  if(parsed.vendor.confidence>=.85&&parsed.vendor.value&&!suspiciousVendor(parsed.vendor.value))score++;
  if(parsed.invoiceNumber.confidence>=.85&&parsed.invoiceNumber.value&&!suspiciousInvoiceNumber(parsed.invoiceNumber.value))score++;
  if(parsed.invoiceDate.confidence>=.84&&parsed.invoiceDate.value)score++;
  if(parsed.totalAmount.confidence>=.87&&parsed.totalAmount.value&&Number(parsed.totalAmount.value)>0)score++;
  if(parsed.serviceSummary.confidence>=.78&&parsed.serviceSummary.value&&!suspiciousServiceSummary(parsed.serviceSummary.value)&&!headerOnlyWork(parsed.serviceSummary.value,parsed.vendor.value)&&ACTION_WORD.test(parsed.serviceSummary.value))score++;
  return score;
}
function shouldUseVision(file:File|null,parsed:ParsedInvoice|null,text:string,selectedAt:number){
  if(!file)return false;
  if(!(file.type.startsWith("image/")||isPdf(file)))return false;
  const age=Date.now()-selectedAt;
  if(age<1700)return false;
  if(!text&&age<5200)return false;
  return trustworthyFieldCount(parsed)<4;
}
function canvasBlob(canvas:HTMLCanvasElement){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not prepare invoice image.")),"image/jpeg",.9));}
async function imageToVisionBlob(file:File){
  const bitmap=await createImageBitmap(file);
  try{
    const longest=Math.max(bitmap.width,bitmap.height);
    const scale=Math.min(1.8,Math.max(1,1900/Math.max(1,longest)));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext("2d");if(!context)throw new Error("Could not prepare invoice image.");
    context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await canvasBlob(canvas);canvas.width=1;canvas.height=1;return blob;
  }finally{bitmap.close();}
}
async function waitForPdfTools(){
  for(let i=0;i<35;i++){
    const pdfjs=(window as PdfTools).pdfjsLib;if(pdfjs)return pdfjs;
    await new Promise(resolve=>window.setTimeout(resolve,150));
  }
  return null;
}
async function pdfToVisionBlob(file:File){
  const pdfjs=await waitForPdfTools();if(!pdfjs)throw new Error("PDF image reader is not ready.");
  pdfjs.GlobalWorkerOptions.workerSrc=PDF_WORKER;
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{
    const page=await pdf.getPage(1);const viewport=page.getViewport({scale:2.1});
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
    const context=canvas.getContext("2d");if(!context)throw new Error("Could not prepare scanned PDF page.");
    context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:context,viewport}).promise;
    const blob=await canvasBlob(canvas);canvas.width=1;canvas.height=1;return blob;
  }finally{if(typeof pdf.destroy==="function")await pdf.destroy();}
}
async function prepareVisionBlob(file:File){return isPdf(file)?pdfToVisionBlob(file):imageToVisionBlob(file);}
function resolveMasterUnit(value:string){
  const raw=value.trim();if(!raw)return"";
  const normalize=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]/g,"");
  const options=Array.from(document.querySelectorAll<HTMLOptionElement>("#outside-work-units option"));
  const exact=options.filter(option=>normalize(option.value)===normalize(raw));if(exact.length===1)return exact[0].value;
  const number=(raw.match(/\d{2,6}/)||[])[0]||"";if(!number)return"";
  const numeric=options.filter(option=>(option.value.match(/\d{2,6}/)||[])[0]===number);return numeric.length===1?numeric[0].value:"";
}
function setVisionStatus(message:string,tone:"working"|"success"|"error"){
  const ocr=findOcrTextarea();const anchor=ocr?.closest("details");if(!anchor)return;
  let box=document.getElementById("outside-work-vision-status") as HTMLDivElement|null;
  if(!box){box=document.createElement("div");box.id="outside-work-vision-status";box.style.marginTop="12px";box.style.padding="10px 12px";box.style.borderRadius="8px";box.style.fontSize="12px";box.style.fontWeight="800";anchor.insertAdjacentElement("beforebegin",box);}
  box.textContent=message;
  box.style.border=tone==="success"?"1px solid #b8d9c1":tone==="error"?"1px solid #e2b7b7":"1px solid #cddde6";
  box.style.background=tone==="success"?"#f2fbf4":tone==="error"?"#fff4f4":"#eef5f8";
  box.style.color=tone==="success"?"#2d5b38":tone==="error"?"#7d3030":"#35556b";
}

function InvoiceIntelligenceGuard(){
  useEffect(()=>{
    let activeText="";
    let parsed:ParsedInvoice|null=null;
    let forceUntil=0;
    let defaultWorkPlaceholder="";
    let activeFile:File|null=null;
    let selectedAt=0;
    let visionBusy=false;
    let visionDoneKey="";
    let visionFailedKey="";
    let vendorMaster:VendorMaster[]=[];
    let vendorLoadStarted=false;

    const loadVendorMaster=async()=>{
      if(vendorLoadStarted)return;
      vendorLoadStarted=true;
      try{
        const response=await fetch("/api/outside-work/vendors",{cache:"no-store"});
        const result=await response.json() as VendorMasterResponse;
        if(response.ok&&Array.isArray(result.vendors))vendorMaster=result.vendors;
      }catch{}
    };
    void loadVendorMaster();

    const applyVision=async(file:File)=>{
      const key=fileKey(file);if(visionBusy||visionDoneKey===key||visionFailedKey===key)return;
      visionBusy=true;setVisionStatus("Reading handwriting from the actual page image...","working");
      try{
        const image=await prepareVisionBlob(file);
        const body=new FormData();body.append("image",image,"outside-work-vision.jpg");
        const ocrHint=findOcrTextarea()?.value.trim()||"";if(ocrHint)body.append("ocrText",ocrHint);
        const response=await fetch("/api/outside-work-vision",{method:"POST",body});
        const result=await response.json() as VisionResponse;
        if(!response.ok||!result.ok||!result.fields||!result.normalizedText){
          visionFailedKey=key;
          const reason=[result.error,result.detail].filter(Boolean).join(" ")||`HTTP ${response.status}`;
          setVisionStatus(`Handwriting reader did not complete: ${reason}. Bad OCR header text will not be trusted.`,"error");
          return;
        }
        if(!activeFile||fileKey(activeFile)!==key)return;
        const fields=result.fields;
        const vendor=findInput("Outside vendor");const invoice=findInput("Invoice / RO number");const date=findInput("Service date");
        const mileage=findInput("Invoice mileage");const total=findInput("Invoice total ($)");const unit=findInput("Master Equipment unit");const work=findTextarea("Work performed");const ocr=findOcrTextarea();
        if(fields.vendorName.confidence>=.72&&fields.vendorName.value&&vendor&&canTouch(vendor))setReactInputValue(vendor,fields.vendorName.value);
        if(fields.invoiceNumber.confidence>=.72&&fields.invoiceNumber.value&&invoice&&canTouch(invoice))setReactInputValue(invoice,fields.invoiceNumber.value);
        if(fields.serviceDate.confidence>=.72&&/^\d{4}-\d{2}-\d{2}$/.test(fields.serviceDate.value)&&date&&canTouch(date))setReactInputValue(date,fields.serviceDate.value);
        if(fields.mileage.confidence>=.8&&/^\d{1,8}$/.test(fields.mileage.value.replace(/,/g,""))&&mileage&&canTouch(mileage))setReactInputValue(mileage,fields.mileage.value.replace(/,/g,""));
        if(fields.totalAmount.confidence>=.72&&/^\d+(?:\.\d{1,2})?$/.test(fields.totalAmount.value.replace(/[$,]/g,""))&&total&&canTouch(total))setReactInputValue(total,Number(fields.totalAmount.value.replace(/[$,]/g,"")).toFixed(2));
        else if(total&&canTouch(total)&&Number(total.value||0)===0)setReactInputValue(total,"");
        if(fields.unitNumber.confidence>=.72&&unit&&canTouch(unit)){const resolved=resolveMasterUnit(fields.unitNumber.value);if(resolved)setReactInputValue(unit,resolved);}
        const workText=fields.workPerformed.value.join("\n").trim();
        if(fields.workPerformed.confidence>=.68&&workText&&work&&canTouch(work)&&!suspiciousServiceSummary(workText))setReactTextAreaValue(work,workText);
        else if(work&&canTouch(work)&&(suspiciousServiceSummary(work.value)||headerOnlyWork(work.value,fields.vendorName.value)))setReactTextAreaValue(work,"");
        if(ocr&&canTouch(ocr))setReactTextAreaValue(ocr,result.normalizedText);
        activeText=result.normalizedText;parsed=parseOutsideWorkInvoice(activeText) as ParsedInvoice;forceUntil=Date.now()+3500;
        visionDoneKey=key;
        setVisionStatus("Handwriting/page-image reader completed. Review the filled fields against the original before saving.","success");
        if(work)work.title="Scanned/handwritten invoice fields were read from the page image; review them against the original before saving.";
      }catch(error){visionFailedKey=key;setVisionStatus(`Handwriting reader failed: ${error instanceof Error?error.message:"unknown error"}. Bad OCR header text will not be trusted.`,"error");}
      finally{visionBusy=false;}
    };

    const refresh=()=>{
      const ocr=findOcrTextarea();
      const text=ocr?.value.trim()||"";
      if(text!==activeText){activeText=text;parsed=text?parseOutsideWorkInvoice(text) as ParsedInvoice:null;forceUntil=Date.now()+3000;}
      if(parsed){
        const forceWindow=Date.now()<=forceUntil;
        const vendor=findInput("Outside vendor");const invoice=findInput("Invoice / RO number");const date=findInput("Service date");
        const mileage=findInput("Invoice mileage");const total=findInput("Invoice total ($)");const work=findTextarea("Work performed");
        if(work&&!defaultWorkPlaceholder)defaultWorkPlaceholder=work.placeholder;
        applyInput(vendor,parsed.vendor,0.85,forceWindow,suspiciousVendor);
        applyInput(invoice,parsed.invoiceNumber,0.85,forceWindow,suspiciousInvoiceNumber);
        applyInput(date,parsed.invoiceDate,0.84,forceWindow);
        applyInput(mileage,parsed.mileage,0.88,forceWindow);
        applyInput(total,parsed.totalAmount,0.87,forceWindow);
        applyTextarea(work,parsed.serviceSummary,0.78,forceWindow,suspiciousServiceSummary);
        clearSuspiciousInput(vendor,suspiciousVendor,forceWindow);
        clearSuspiciousInput(invoice,suspiciousInvoiceNumber,forceWindow);
        clearSuspiciousTextarea(work,suspiciousServiceSummary,forceWindow);

        const phone=detectVendorPhone(text);
        if(phone.digits&&vendorMaster.length&&vendor){
          const matches=vendorMaster.filter(row=>normalizePhone(row.phone)===phone.digits);
          if(matches.length===1){
            const current=vendor.value.trim();
            if(canTouch(vendor)&&(!current||suspiciousVendor(current)))setReactInputValue(vendor,matches[0].name);
            vendor.title=`Vendor master matched by printed phone ${phone.raw}: ${matches[0].name}`;
          }else if(matches.length===0&&!vendor.value.trim())vendor.title=`Printed vendor phone ${phone.raw} is not in the vendor master yet. Enter the company name once; it will be saved with this phone for future invoices.`;
        }else if(vendor)vendor.title=parsed.payee?.value?`Service vendor detected from the invoice. Remit/payee: ${parsed.payee.value}`:(parsed.vendor.source||"");

        if(total){
          const arithmetic=validateSimpleInvoiceArithmetic(text,Number(total.value||0));
          if(arithmetic.status==="balanced")total.title=`Verified: simple component charges balance to $${Number(arithmetic.sum).toFixed(2)}.`;
          else if(arithmetic.status==="mismatch")total.title=`Review required: simple component charges add to $${Number(arithmetic.sum).toFixed(2)}, not $${Number(total.value||0).toFixed(2)}.`;
        }

        if(work){
          if(parsed.documentKind==="payment_receipt"){
            work.placeholder="Payment receipt detected. Enter the actual work performed or use the underlying repair invoice; the system will not invent repairs from payment data.";
            work.title="Payment receipt only - repair details were not present in this document.";
            if(forceWindow&&canTouch(work)&&work.value.trim())setReactTextAreaValue(work,"");
          }else if(defaultWorkPlaceholder)work.placeholder=defaultWorkPlaceholder;
        }
      }
      if(shouldUseVision(activeFile,parsed,text,selectedAt)&&activeFile)void applyVision(activeFile);
    };

    const onFileChange=(event:Event)=>{
      const input=event.target instanceof HTMLInputElement?event.target:null;
      if(!input||input.type!=="file"||!/^outside-work-(?:camera|file)-input$/.test(input.id))return;
      const next=input.files?.[0]||null;if(!next)return;
      activeFile=next;selectedAt=Date.now();visionDoneKey="";visionFailedKey="";activeText="";parsed=null;forceUntil=Date.now()+3000;setVisionStatus("Document selected. Browser OCR is running first; handwriting vision will take over automatically if needed.","working");
    };
    const onClick=(event:MouseEvent)=>{const target=event.target instanceof Element?event.target.closest("button"):null;if(target&&(target.textContent||"").trim().toUpperCase()==="APPLY RULES TO TEXT")forceUntil=Date.now()+3000;};
    document.addEventListener("change",onFileChange,true);document.addEventListener("click",onClick,true);
    const timer=window.setInterval(refresh,200);refresh();
    return()=>{document.removeEventListener("change",onFileChange,true);document.removeEventListener("click",onClick,true);window.clearInterval(timer);};
  },[]);
  return null;
}

export default function OutsideWorkVendorSafe(){return <><OutsideWorkIntake/><InvoiceIntelligenceGuard/></>;}
