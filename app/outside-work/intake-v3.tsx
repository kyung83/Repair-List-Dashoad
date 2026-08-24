"use client";

import {useEffect} from "react";
import OutsideWorkIntakeV2 from "./intake-v2";
import AiReadingBridge from "./ai-reading-bridge";

const COPY_REPLACEMENTS=new Map([
  [
    "No AI is used. Digital PDFs are read directly; printed scans use local OCR. The reader fills only what it can support, then you correct anything questionable before saving.",
    "One upload runs both readers automatically: printed text is checked locally and handwriting is read with Cloudflare AI. Review anything questionable before saving.",
  ],
  ["NO-AI READER","AUTOMATIC INVOICE READER"],
  [
    "If OCR misses a field, just type it in below. There is no second AI pass and no AI charge.",
    "Printed OCR runs first, and the handwriting AI reader runs automatically from the same invoice. You can still correct any field below.",
  ],
]);

function refreshReaderCopy(){
  for(const node of document.querySelectorAll<HTMLElement>("p,span,strong,div")){
    const current=(node.textContent||"").trim();
    const replacement=COPY_REPLACEMENTS.get(current);
    if(replacement)node.textContent=replacement;
  }
}

export default function OutsideWorkIntakeV3(){
  useEffect(()=>{
    refreshReaderCopy();
    const root=document.querySelector("main")||document.body;
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      queueMicrotask(()=>{queued=false;refreshReaderCopy();});
    });
    observer.observe(root,{subtree:true,childList:true,characterData:true});
    return()=>observer.disconnect();
  },[]);

  return <>
    <AiReadingBridge/>
    <OutsideWorkIntakeV2/>
  </>;
}
