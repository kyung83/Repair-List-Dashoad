"use client";

import {useMemo,useState} from "react";
import {AI_READING_PROMPT,parseAiReading} from "./ai-reading-parser.js";

type ParsedReading=ReturnType<typeof parseAiReading>;

function setReactValue(target:HTMLInputElement|HTMLTextAreaElement|null,value:string){
  if(!target||!value)return false;
  const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const descriptor=Object.getOwnPropertyDescriptor(prototype,"value");
  descriptor?.set?.call(target,value);
  target.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));
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
  const[open,setOpen]=useState(false);const[text,setText]=useState("");const[message,setMessage]=useState("");const[copied,setCopied]=useState(false);
  const parsed=useMemo(()=>text.trim()?parseAiReading(text):null,[text]);

  async function copyPrompt(){
    try{await navigator.clipboard.writeText(AI_READING_PROMPT);setCopied(true);setMessage("Reading prompt copied. Upload the same invoice to ChatGPT or Claude, then paste its response here.");window.setTimeout(()=>setCopied(false),1800);}catch{setMessage("Copy failed. Open the exact prompt below and copy it manually.");}
  }

  function apply(){
    if(!parsed){setMessage("Paste the ChatGPT or Claude reading first.");return;}
    const fields=targetFields();if(!fields){setMessage("Outside Work review form was not found. Reload this page and try again.");return;}
    let count=0;
    count+=Number(setReactValue(fields.unit,parsed.unit));
    count+=Number(setReactValue(fields.vendor,parsed.vendor));
    count+=Number(setReactValue(fields.invoice,parsed.invoiceNumber));
    count+=Number(setReactValue(fields.date,parsed.invoiceDate));
    count+=Number(setReactValue(fields.mileage,parsed.mileage));
    count+=Number(setReactValue(fields.total,parsed.totalAmount));
    count+=Number(setReactValue(fields.work,parsed.serviceSummary));
    fields.unit?.blur();
    if(!count){setMessage("I could not find any safe labeled values to apply. Ask the AI to use the copied reading prompt and try again.");return;}
    const warning=parsed.uncertain.length?` Review the uncertain items before saving: ${parsed.uncertain.slice(0,4).join("; ")}${parsed.uncertain.length>4?"; …":""}`:"";
    setMessage(`Applied ${count} field${count===1?"":"s"}. AI-filled fields stay yellow REVIEW in Outside Work.${warning}`);
    fields.form.scrollIntoView({behavior:"smooth",block:"start"});
  }

  return <section style={dock} aria-label="Handwriting invoice helper">
    <button type="button" onClick={()=>setOpen(value=>!value)} style={launcher} aria-expanded={open} aria-controls="outside-work-ai-helper" data-ai-reading-launcher="true">
      {open?"CLOSE AI PASTE":"HANDWRITING? PASTE AI READING"}
    </button>
    {open&&<div id="outside-work-ai-helper" style={panel} aria-label="Paste ChatGPT or Claude invoice reading">
      <div style={head}><div><div style={eyebrow}>NO-API HANDWRITING HELPER</div><h2 style={title}>Paste ChatGPT / Claude Reading</h2></div><button type="button" onClick={()=>setOpen(false)} style={close} aria-label="Close">×</button></div>
      <p style={copy}>Keep the original invoice selected in Outside Work. Upload that same scan to ChatGPT or Claude, have it read the handwriting, then paste the result here. The dashboard itself does not call an AI API.</p>
      <button type="button" onClick={()=>void copyPrompt()} style={secondary}>{copied?"PROMPT COPIED":"COPY READING PROMPT"}</button>
      <details style={details}><summary style={{cursor:"pointer",fontWeight:850}}>Show the exact prompt</summary><pre style={prompt}>{AI_READING_PROMPT}</pre></details>
      <textarea value={text} onChange={event=>{setText(event.target.value);setMessage("");}} placeholder="Paste the ChatGPT or Claude transcription here…" style={textarea}/>
      {parsed&&<div style={preview}><strong>{summary(parsed)||"Reading detected"}</strong><span>{parsed.serviceSummary?"Work description detected. ":""}{parsed.uncertain.length?`${parsed.uncertain.length} item${parsed.uncertain.length===1?"":"s"} need verification.`:"No uncertainty wording detected."}</span></div>}
      {parsed?.uncertain.length>0&&<div style={warning}><strong>VERIFY FROM ORIGINAL</strong>{parsed.uncertain.slice(0,6).map(item=><span key={item}>• {item}</span>)}</div>}
      {message&&<div style={notice}>{message}</div>}
      <div style={actions}><button type="button" onClick={()=>{setText("");setMessage("");}} style={ghost}>CLEAR</button><button type="button" onClick={apply} style={primary}>APPLY TO OUTSIDE WORK</button></div>
      <p style={foot}>Nothing is saved by this helper. The normal Outside Work save button, unit match, vendor rules, and original-document retention still control the record.</p>
    </div>}
  </section>;
}

const dock:React.CSSProperties={position:"sticky",top:8,zIndex:2147483000,width:"calc(100% - 32px)",maxWidth:1400,margin:"8px auto 0",display:"grid",justifyItems:"end",pointerEvents:"none"};
const launcher:React.CSSProperties={pointerEvents:"auto",border:"2px solid #fff",borderRadius:999,padding:"13px 18px",fontWeight:950,fontSize:12,letterSpacing:.45,background:"#123f58",color:"#fff",boxShadow:"0 8px 28px rgba(16,30,42,.28)",cursor:"pointer",whiteSpace:"nowrap"};
const panel:React.CSSProperties={pointerEvents:"auto",width:"min(460px,calc(100vw - 36px))",maxHeight:"calc(100vh - 86px)",overflowY:"auto",marginTop:8,background:"#fff",border:"1px solid #dfe5e9",borderRadius:18,padding:18,boxShadow:"0 18px 60px rgba(20,35,45,.28)",fontFamily:"inherit"};
const head:React.CSSProperties={display:"flex",justifyContent:"space-between",gap:12,alignItems:"start"};
const eyebrow:React.CSSProperties={fontSize:10,fontWeight:950,letterSpacing:1.1,color:"#6d7f8c"};
const title:React.CSSProperties={margin:"3px 0 0",fontSize:23,lineHeight:1.05,color:"#17242f"};
const close:React.CSSProperties={border:0,background:"transparent",fontSize:28,lineHeight:1,color:"#657581",cursor:"pointer",padding:0};
const copy:React.CSSProperties={fontSize:13,lineHeight:1.5,color:"#526673",margin:"12px 0"};
const secondary:React.CSSProperties={width:"100%",border:"1px solid #b8c4cc",borderRadius:10,padding:"10px 12px",background:"#f7f9fa",color:"#243843",fontWeight:900,cursor:"pointer"};
const details:React.CSSProperties={marginTop:10,fontSize:12,color:"#566a77"};
const prompt:React.CSSProperties={whiteSpace:"pre-wrap",fontSize:11,lineHeight:1.4,background:"#f5f7f8",borderRadius:10,padding:10,overflowX:"auto"};
const textarea:React.CSSProperties={width:"100%",minHeight:190,boxSizing:"border-box",marginTop:12,border:"1px solid #c9d3d9",borderRadius:12,padding:12,fontSize:13,lineHeight:1.45,resize:"vertical",outline:"none"};
const preview:React.CSSProperties={display:"grid",gap:3,marginTop:10,padding:10,borderRadius:10,background:"#f4f8fa",fontSize:12,color:"#3e5665"};
const warning:React.CSSProperties={display:"grid",gap:4,marginTop:10,padding:10,borderRadius:10,background:"#fff7df",border:"1px solid #ead18a",fontSize:12,color:"#71570f"};
const notice:React.CSSProperties={marginTop:10,padding:10,borderRadius:10,background:"#eef5fa",fontSize:12,lineHeight:1.45,color:"#31556d"};
const actions:React.CSSProperties={display:"flex",justifyContent:"flex-end",gap:8,marginTop:12};
const ghost:React.CSSProperties={border:"1px solid #c8d1d7",borderRadius:10,padding:"10px 12px",background:"#fff",fontWeight:900,color:"#556874",cursor:"pointer"};
const primary:React.CSSProperties={border:0,borderRadius:10,padding:"10px 14px",background:"#173f54",color:"#fff",fontWeight:950,cursor:"pointer"};
const foot:React.CSSProperties={fontSize:11,lineHeight:1.4,color:"#78858e",margin:"10px 0 0"};
