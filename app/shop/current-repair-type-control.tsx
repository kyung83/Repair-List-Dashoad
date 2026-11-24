"use client";

import {useEffect,useState} from "react";
import type {RepairSubcategory} from "@/lib/repair-subcategories";

type RepairType={id:number;name:string;active?:boolean;checklistMode:"none"|"optional"|"required"};
type Data={ok?:boolean;error?:string;repairId:string;current:RepairType|null;currentSubcategory?:RepairSubcategory|null;subcategories?:RepairSubcategory[];types:RepairType[];maintenanceEventType:"pm"|"annual"|null;maintenanceLabel:string;noUnit:boolean;locked:boolean;lockReason:"checklist_started"|"maintenance"|"no_unit"|null};
type Props={repairId:string};

export default function CurrentRepairTypeControl({repairId}:Props){
  const[data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");

  async function load(){
    try{
      const response=await fetch(`/api/shop/repair-type?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});
      const payload=await response.json() as Data;
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair Type could not be loaded.");
      setData(payload);setMessage("");
    }catch(error){setMessage(error instanceof Error?error.message:"Repair Type could not be loaded.")}
  }

  useEffect(()=>{setData(null);setMessage("");void load()},[repairId]);

  useEffect(()=>{
    const refresh=(event:Event)=>{
      const detail=(event as CustomEvent<{repairId?:string}>).detail;
      if(!detail?.repairId||detail.repairId===repairId)void load();
    };
    window.addEventListener("repair-type-checklist-started",refresh);
    return()=>window.removeEventListener("repair-type-checklist-started",refresh);
  },[repairId]);

  useEffect(()=>{
    const blockExit=(event:Event)=>{
      if(!data||data.maintenanceEventType||data.noUnit)return;
      const missingType=!data.current&&!data.locked;
      const missingSubcategory=Boolean(data.current&&(data.subcategories??[]).length&&!data.currentSubcategory);
      if(!missingType&&!missingSubcategory)return;
      const target=event.target instanceof Element?event.target.closest("button"):null;
      if(!target)return;
      const text=target.textContent?.trim().toUpperCase()??"";
      const repaired=target.matches('[data-shop-action="repaired"]')||text.startsWith("REPAIRED");
      const doneWorking=target.matches('[data-shop-action="done-working"]')||text.startsWith("DONE WORKING");
      if(!repaired&&!doneWorking)return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      const message=missingSubcategory?"Choose the required subcategory before leaving this work.":repaired?"Choose the Repair Type above the repair actions before marking REPAIRED.":"Choose the Repair Type above the repair actions before leaving this work.";
      setMessage(message);
      window.dispatchEvent(new CustomEvent("shop-repair-close-blocked",{detail:{repairId,reason:"repair-type",message}}));
      window.requestAnimationFrame(()=>document.getElementById("current-repair-type")?.scrollIntoView({behavior:"smooth",block:"center"}));
    };
    document.addEventListener("click",blockExit,true);return()=>document.removeEventListener("click",blockExit,true);
  },[data]);

  async function choose(value:string){
    if(!value||data?.locked)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop/repair-type",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repairId,repairTypeId:Number(value)})});
      const payload=await response.json() as Data;
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair Type could not be saved.");
      setData(payload);
      setMessage(`${payload.current?.name||"Repair Type"} saved.`);
      window.dispatchEvent(new CustomEvent("repair-type-changed",{detail:{repairId}}));
      window.dispatchEvent(new CustomEvent("shop-repair-close-updated",{detail:{repairId}}));
    }catch(error){
      const text=error instanceof Error?error.message:"Repair Type could not be saved.";
      await load();
      setMessage(text);
    }
    finally{setBusy(false)}
  }

  async function chooseSubcategory(value:string){
    if(!data?.current||busy)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop/repair-type",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"setSubcategory",repairId,repairTypeId:data.current.id,repairSubcategoryId:value?Number(value):null})});
      const payload=await response.json() as Data;
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Subcategory could not be saved.");
      setData(payload);setMessage(payload.currentSubcategory?payload.currentSubcategory.name+" saved.":"Subcategory cleared and saved.");
      window.dispatchEvent(new CustomEvent("shop-repair-close-updated",{detail:{repairId}}));
    }catch(error){const text=error instanceof Error?error.message:"Subcategory could not be saved.";await load();setMessage(text);}
    finally{setBusy(false);}
  }

  if(!data)return message?<div id="current-repair-type" style={errorBox}>{message}</div>:<div id="current-repair-type" style={loadingBox}>Loading Repair Type…</div>;
  if(data.maintenanceEventType)return <section id="current-repair-type" style={fixedBox}><div><span style={label}>WORK TYPE</span><strong style={fixedValue}>{data.maintenanceLabel}</strong></div><small style={help}>PM and Annual keep their own maintenance workflow.</small></section>;
  if(data.noUnit)return <section id="current-repair-type" style={fixedBox}><div><span style={label}>REPAIR TYPE</span><strong style={fixedValue}>{data.current?.name||"INDIRECT LABOR-OTHER"}</strong></div><small style={help}>Shop labor stays separate from fleet-unit repair categories.</small></section>;

  const subcategories=data.subcategories??[];
  const savedSubcategory=data.currentSubcategory;
  const subcategoryOptions=savedSubcategory&&!subcategories.some(s=>s.id===savedSubcategory.id)?[savedSubcategory,...subcategories]:subcategories;
  const missingSubcategory=Boolean(data.current&&subcategories.length&&!savedSubcategory);
  const checklist=data.current?.checklistMode&&data.current.checklistMode!=="none";
  const helpText=data.lockReason==="checklist_started"
    ? "Locked because this category checklist has started."
    : data.current
      ? "You can change it until a category checklist is started."
      : "Select this while you are working. Repair entry stays fast for the office.";
  return <section id="current-repair-type" style={data.current&&!missingSubcategory?box:requiredBox}>
    <div style={{display:"grid",gap:4}}><span style={label}>REPAIR TYPE {data.current?"":"· REQUIRED"}</span><strong style={headline}>{data.current?.name||"Choose what type of repair this is"}</strong><small style={help}>{helpText}</small></div>
    <select value={data.current?.id?String(data.current.id):""} disabled={busy||data.locked} onChange={event=>void choose(event.target.value)} style={{...select,...(data.locked?lockedSelect:{})}}>
      <option value="">Choose Repair Type…</option>
      {data.types.map(type=><option key={type.id} value={type.id}>{type.name}{type.checklistMode==="required"?" · CHECKLIST":""}</option>)}
    </select>
    {data.current&&subcategoryOptions.length>0&&<label style={{display:"grid",gap:5}}><span style={label}>SUBCATEGORY {subcategories.length?"· REQUIRED":""}</span><select value={savedSubcategory?String(savedSubcategory.id):""} disabled={busy} onChange={event=>void chooseSubcategory(event.target.value)} style={select}><option value="" disabled={subcategories.length>0}>{subcategories.length?"Choose required subcategory…":"No subcategory / not specified"}</option>{subcategoryOptions.map(s=><option key={s.id} value={s.id} disabled={!s.active}>{s.name}{!s.active?" · RETIRED":""}</option>)}</select><small style={help}>Select a subcategory before leaving this repair. The main Repair Type and checklist rules do not change.</small></label>}
    {checklist&&<div style={checklistNote}>{data.current?.name} uses a check sheet. {data.lockReason==="checklist_started"?"The Repair Type is now locked for this work order.":"It will appear below after this selection."}</div>}
    {message&&<div style={message.includes("saved")?successBox:errorBox}>{message}</div>}
  </section>;
}

const box={padding:14,border:"1px solid #b8c9d8",borderRadius:14,background:"white",display:"grid",gap:10,boxShadow:"0 4px 14px #173f370a"} as const;
const requiredBox={...box,border:"2px solid #ef7a22",background:"#fff9f4"} as const;
const fixedBox={...box,gridTemplateColumns:"minmax(0,1fr) auto",alignItems:"center"} as const;
const label={fontSize:11,fontWeight:950,letterSpacing:".08em",color:"#6b7782"} as const;
const headline={fontSize:17,color:"#2f6f60"} as const;
const fixedValue={display:"block",marginTop:3,fontSize:18,color:"#2f6f60"} as const;
const help={fontSize:11,color:"#687783",fontWeight:700} as const;
const select={width:"100%",boxSizing:"border-box" as const,padding:"11px 12px",border:"1px solid #aebfce",borderRadius:9,background:"white",color:"#24312c",fontWeight:850,fontSize:14} as const;
const lockedSelect={background:"#f1f4f6",color:"#68746f",cursor:"not-allowed"} as const;
const checklistNote={padding:"8px 10px",borderRadius:8,background:"#edf6ff",color:"#244b6d",fontSize:12,fontWeight:800} as const;
const loadingBox={padding:11,border:"1px solid #d6dfe6",borderRadius:10,background:"white",fontSize:12,fontWeight:800,color:"#657480"} as const;
const successBox={padding:"8px 10px",borderRadius:8,background:"#eaf7ef",color:"#176440",fontSize:12,fontWeight:850} as const;
const errorBox={padding:"8px 10px",borderRadius:8,background:"#fff0ed",border:"1px solid #efb8ae",color:"#8a342a",fontSize:12,fontWeight:850} as const;
