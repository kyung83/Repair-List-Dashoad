"use client";

import { useEffect } from "react";
import OutsideWorkIntake from "./file-intake";
import {
  parseOutsideWorkInvoice,
  suspiciousInvoiceNumber,
  suspiciousServiceSummary,
  suspiciousVendor,
} from "./invoice-parser";

type Candidate={value:string;confidence:number;source:string};
type ParsedInvoice={vendor:Candidate;invoiceNumber:Candidate;invoiceDate:Candidate;mileage:Candidate;totalAmount:Candidate;serviceSummary:Candidate};

function findFieldLabel(prefix:string){return Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(label=>(label.textContent||"").trim().startsWith(prefix))||null;}
function findInput(prefix:string){return findFieldLabel(prefix)?.querySelector<HTMLInputElement>("input")||null;}
function findTextarea(prefix:string){return findFieldLabel(prefix)?.querySelector<HTMLTextAreaElement>("textarea")||null;}
function setReactInputValue(input:HTMLInputElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));}
function setReactTextAreaValue(textarea:HTMLTextAreaElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;if(setter)setter.call(textarea,value);else textarea.value=value;textarea.dispatchEvent(new Event("input",{bubbles:true}));}
function canTouch(element:HTMLElement|null){return Boolean(element&&document.activeElement!==element);}
function applyInput(element:HTMLInputElement|null,candidate:Candidate,threshold:number,forceWindow:boolean,suspicious?:(value:string)=>boolean){if(!element||candidate.confidence<threshold||!candidate.value||!canTouch(element))return;const current=element.value.trim();if(current===candidate.value)return;if(forceWindow||!current||suspicious?.(current))setReactInputValue(element,candidate.value);}
function applyTextarea(element:HTMLTextAreaElement|null,candidate:Candidate,threshold:number,forceWindow:boolean,suspicious?:(value:string)=>boolean){if(!element||candidate.confidence<threshold||!candidate.value||!canTouch(element))return;const current=element.value.trim();if(current===candidate.value)return;if(forceWindow||!current||suspicious?.(current))setReactTextAreaValue(element,candidate.value);}
function clearSuspiciousInput(element:HTMLInputElement|null,test:(value:string)=>boolean,forceWindow:boolean){if(!forceWindow||!element||!canTouch(element))return;const current=element.value.trim();if(current&&test(current))setReactInputValue(element,"");}
function clearSuspiciousTextarea(element:HTMLTextAreaElement|null,test:(value:string)=>boolean,forceWindow:boolean){if(!forceWindow||!element||!canTouch(element))return;const current=element.value.trim();if(current&&test(current))setReactTextAreaValue(element,"");}

function InvoiceIntelligenceGuard(){
  useEffect(()=>{
    let activeText="";
    let parsed:ParsedInvoice|null=null;
    let forceUntil=0;

    const refresh=()=>{
      const ocr=Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find(item=>item.placeholder.includes("OCR or extracted PDF text"));
      const text=ocr?.value.trim()||"";
      if(!text)return;
      if(text!==activeText){activeText=text;parsed=parseOutsideWorkInvoice(text) as ParsedInvoice;forceUntil=Date.now()+3000;}
      if(!parsed)return;

      const forceWindow=Date.now()<=forceUntil;
      const vendor=findInput("Outside vendor");
      const invoice=findInput("Invoice / RO number");
      const date=findInput("Service date");
      const mileage=findInput("Invoice mileage");
      const total=findInput("Invoice total ($)");
      const work=findTextarea("Work performed");

      applyInput(vendor,parsed.vendor,0.85,forceWindow,suspiciousVendor);
      applyInput(invoice,parsed.invoiceNumber,0.85,forceWindow,suspiciousInvoiceNumber);
      applyInput(date,parsed.invoiceDate,0.84,forceWindow);
      applyInput(mileage,parsed.mileage,0.88,forceWindow);
      applyInput(total,parsed.totalAmount,0.87,forceWindow);
      applyTextarea(work,parsed.serviceSummary,0.78,forceWindow,suspiciousServiceSummary);

      if(parsed.vendor.confidence<0.85)clearSuspiciousInput(vendor,suspiciousVendor,forceWindow);
      if(parsed.invoiceNumber.confidence<0.85)clearSuspiciousInput(invoice,suspiciousInvoiceNumber,forceWindow);
      if(parsed.serviceSummary.confidence<0.78)clearSuspiciousTextarea(work,suspiciousServiceSummary,forceWindow);
    };

    const onClick=(event:MouseEvent)=>{const target=event.target instanceof Element?event.target.closest("button"):null;if(target&&(target.textContent||"").trim().toUpperCase()==="APPLY RULES TO TEXT")forceUntil=Date.now()+3000;};
    document.addEventListener("click",onClick,true);
    const timer=window.setInterval(refresh,200);
    refresh();
    return()=>{document.removeEventListener("click",onClick,true);window.clearInterval(timer);};
  },[]);
  return null;
}

export default function OutsideWorkVendorSafe(){return <><OutsideWorkIntake/><InvoiceIntelligenceGuard/></>;}
