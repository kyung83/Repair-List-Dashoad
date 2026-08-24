"use client";

import {useEffect,useMemo,useState,type CSSProperties} from "react";
import {createPortal} from "react-dom";
import {AI_READING_PROMPT,parseAiReading} from "./ai-reading-parser.js";

type ParsedReading=ReturnType<typeof parseAiReading>;

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

function summary(parsed:ParsedReading){
  return[
    parsed.vendor&&`Vendor ${parsed.vendor}`,
    parsed.invoiceNumber&&`Invoice ${parsed.invoiceNumber}`,
    parsed.unit&&`Unit ${parsed.unit}`,
    parsed.invoiceDate&&`Date ${parsed.invoiceDate}`,
    parsed.totalAmount&&`Total $${parsed.totalAmount}`,
  ].filter(Boolean).join(" · ");
}

export default function AiReadingBridge(){
  const[host,setHost]=useState<HTMLElement|null>(null);
  const[open,setOpen]=useState(true);
  const[text,setText]=useState("");
  const[message,setMessage]=useState("");
  const[copied,setCopied]=useState(false);
  const parsed=useMemo(()=>text.trim()?parseAiReading(text):null,[text]);

  useEffect(()=>{
    const form=document.querySelector<HTMLInputElement>('input[placeholder="Unit number"]')?.closest("form");
    const parent=form?.parentElement;
    if(!form||!parent)return;
    const existing=document.getElementById("outside-work-ai-inline-host");
    const mount=existing||document.createElement("div");
    mount.id="outside-work-ai-inline-host";
    mount.setAttribute("data-outside-work-ai-inline","true");
    mount.style.width="100%";
    mount.style.marginTop="16px";
    if(!existing)parent.insertBefore(mount,form);
    setHost(mount);
    return()=>{if(!existing&&mount.parentElement)mount.remove();};
  },[]);

  async function copyPrompt(){
    try{
      await navigator.clipboard.writeText(AI_READING_PROMPT);
      setCopied(true);
      setMessage("Prompt copied. Upload the same invoice to ChatGPT or Claude, then paste its answer here.");
      window.setTimeout(()=>setCopied(false),1800);
    }catch{
      setMessage("Copy failed. Open the exact prompt below and copy it manually.");
    }
  }

  function apply(){
    if(!parsed){setMessage("Paste the ChatGPT or Claude reading first.");return;}
    const fields=targetFields();
    if(!fields){setMessage("The Outside Work review form is not ready. Reload this page and try again.");return;}
    let count=0;
    count+=Number(setReactValue(fields.unit,parsed.unit));
    count+=Number(setReactValue(fields.vendor,parsed.vendor));
    count+=Number(setReactValue(fields.invoice,parsed.invoiceNumber));
    count+=Number(setReactValue(fields.date,parsed.invoiceDate));
    count+=Number(setReactValue(fields.mileage,parsed.mileage));
    count+=Number(setReactValue(fields.total,parsed.totalAmount));
    count+=Number(setReactValue(fields.work,parsed.serviceSummary));
    fields.unit?.blur();
    if(!count){setMessage("No safe labeled values were found. Use the copied prompt in ChatGPT or Claude and paste that answer here.");return;}
    const warning=parsed.uncertain.length?` Verify from the original: ${parsed.uncertain.slice(0,4).join("; ")}${parsed.uncertain.length>4?"; …":""}`:"";
    setMessage(`Applied ${count} field${count===1?"":"s"} into Review and correct.${warning}`);
    window.setTimeout(()=>fields.form.scrollIntoView({behavior:"smooth",block:"start"}),50);
  }

  if(!host)return null;

  return createPortal(
    <section style={card} aria-label="ChatGPT or Claude handwriting helper" data-ai-reading-inline-card="true">
      <div style={topRow}>
        <div>
          <div style={eyebrow}>OPTIONAL · NO API CHARGE</div>
          <h2 style={title}>Handwritten invoice? Use ChatGPT or Claude</h2>
          <p style={copy}>The built-in reader above is for printed text. For handwriting, upload the same invoice to ChatGPT or Claude, copy its structured reading, paste it here, then apply it to the fields below.</p>
        </div>
        <button type="button" onClick={()=>setOpen(value=>!value)} style={toggle} aria-expanded={open}>{open?"HIDE HELPER":"OPEN HELPER"}</button>
      </div>

      {open&&<div style={body}>
        <div style={steps}>
          <div style={step}><strong>1</strong><span>Click <b>COPY READING PROMPT</b>.</span></div>
          <div style={step}><strong>2</strong><span>Upload this same invoice to ChatGPT or Claude and paste the prompt.</span></div>
          <div style={step}><strong>3</strong><span>Copy its answer back here and click <b>APPLY TO REVIEW FIELDS</b>.</span></div>
        </div>

        <button type="button" onClick={()=>void copyPrompt()} style={secondary}>{copied?"PROMPT COPIED":"COPY READING PROMPT"}</button>
        <details style={details}><summary style={{cursor:"pointer",fontWeight:850}}>Show the exact reading prompt</summary><pre style={prompt}>{AI_READING_PROMPT}</pre></details>
        <textarea value={text} onChange={event=>{setText(event.target.value);setMessage("");}} placeholder="Paste the ChatGPT or Claude invoice reading here…" style={textarea}/>

        {parsed&&<div style={preview}><strong>{summary(parsed)||"Reading detected"}</strong><span>{parsed.serviceSummary?"Work description detected. ":""}{parsed.uncertain.length?`${parsed.uncertain.length} item${parsed.uncertain.length===1?"":"s"} need verification.`:"No uncertainty wording detected."}</span></div>}
        {parsed?.uncertain.length>0&&<div style={warning}><strong>VERIFY FROM ORIGINAL INVOICE</strong>{parsed.uncertain.slice(0,6).map(item=><span key={item}>• {item}</span>)}</div>}
        {message&&<div style={notice}>{message}</div>}

        <div style={actions}>
          <button type="button" onClick={()=>{setText("");setMessage("");}} style={ghost}>CLEAR</button>
          <button type="button" onClick={apply} style={primary}>APPLY TO REVIEW FIELDS</button>
        </div>
        <p style={foot}>This helper does not save anything by itself. The original invoice still stays attached, and the normal Outside Work validation and save button remain in control.</p>
      </div>}
    </section>,
    host,
  );
}

const card:CSSProperties={background:"#eef7fb",border:"2px solid #8fb8cc",borderRadius:14,padding:18,boxShadow:"0 2px 10px rgba(15,32,48,.05)",color:"#172536"};
const topRow:CSSProperties={display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"};
const eyebrow:CSSProperties={fontSize:10,fontWeight:950,letterSpacing:1.1,color:"#50768a"};
const title:CSSProperties={margin:"3px 0 0",fontSize:21,lineHeight:1.15,color:"#123348"};
const copy:CSSProperties={fontSize:13,lineHeight:1.5,color:"#526c7b",margin:"8px 0 0",maxWidth:980};
const toggle:CSSProperties={border:"1px solid #9fb8c6",borderRadius:9,padding:"9px 12px",background:"#fff",color:"#173d52",fontWeight:900,cursor:"pointer",whiteSpace:"nowrap"};
const body:CSSProperties={marginTop:14,borderTop:"1px solid #c7dce7",paddingTop:14};
const steps:CSSProperties={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:9,marginBottom:12};
const step:CSSProperties={display:"grid",gridTemplateColumns:"30px 1fr",gap:8,alignItems:"center",padding:"9px 10px",borderRadius:9,background:"#fff",border:"1px solid #cbdde6",fontSize:12,lineHeight:1.4,color:"#405b69"};
const secondary:CSSProperties={width:"100%",border:"1px solid #8da9b8",borderRadius:9,padding:"10px 12px",background:"#fff",color:"#173d52",fontWeight:950,cursor:"pointer"};
const details:CSSProperties={marginTop:10,fontSize:12,color:"#566f7d"};
const prompt:CSSProperties={whiteSpace:"pre-wrap",fontSize:11,lineHeight:1.4,background:"#fff",border:"1px solid #d5e2e8",borderRadius:9,padding:10,overflowX:"auto"};
const textarea:CSSProperties={width:"100%",minHeight:180,boxSizing:"border-box",marginTop:12,border:"1px solid #9eb8c6",borderRadius:10,padding:12,fontSize:13,lineHeight:1.45,resize:"vertical",outline:"none",background:"#fff"};
const preview:CSSProperties={display:"grid",gap:3,marginTop:10,padding:10,borderRadius:9,background:"#fff",border:"1px solid #d3e2e9",fontSize:12,color:"#3e5967"};
const warning:CSSProperties={display:"grid",gap:4,marginTop:10,padding:10,borderRadius:9,background:"#fff7df",border:"1px solid #ead18a",fontSize:12,color:"#71570f"};
const notice:CSSProperties={marginTop:10,padding:10,borderRadius:9,background:"#e2f0f7",border:"1px solid #bfd9e6",fontSize:12,lineHeight:1.45,color:"#31556d"};
const actions:CSSProperties={display:"flex",justifyContent:"flex-end",gap:8,marginTop:12,flexWrap:"wrap"};
const ghost:CSSProperties={border:"1px solid #aebfc8",borderRadius:9,padding:"10px 12px",background:"#fff",fontWeight:900,color:"#556b77",cursor:"pointer"};
const primary:CSSProperties={border:0,borderRadius:9,padding:"10px 14px",background:"#123f58",color:"#fff",fontWeight:950,cursor:"pointer"};
const foot:CSSProperties={fontSize:11,lineHeight:1.4,color:"#71828b",margin:"10px 0 0"};
