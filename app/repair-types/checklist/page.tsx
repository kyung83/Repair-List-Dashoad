"use client";

import {useEffect,useMemo,useState} from "react";

type Item={position:number;section:string;text:string;enabled:boolean;allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string};
type RepairType={id:number;name:string;checklistMode:"none"|"optional"|"required";systemKey:string};
type Template={id:number;name:string;version:number;active:boolean;createdAt:string;items:Item[]};
type Version={id:number;name:string;version:number;active:boolean;createdAt:string;itemCount:number};
type Payload={repairType:RepairType;template:Template|null;versions:Version[];ok?:boolean;error?:string};

const blank=(section="General"):Item=>({position:0,section,text:"",enabled:true,allowPass:true,allowFail:true,allowNa:true,requireNotes:false,requirePhoto:false,requireMeasurement:false,measurementLabel:"",measurementUnit:""});
const renumber=(items:Item[])=>items.map((item,index)=>({...item,position:index+1}));
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c9d4dd",borderRadius:8,padding:"9px 10px",background:"white",color:"#182331"} as const;
const button={border:0,borderRadius:8,padding:"9px 12px",background:"#102a43",color:"white",fontWeight:900,cursor:"pointer"} as const;
const secondary={...button,background:"white",color:"#17324a",border:"1px solid #cbd6df"} as const;
const label={display:"grid",gap:5,fontSize:11,fontWeight:900,color:"#5a6875"} as const;

export default function RepairTypeChecklistBuilder(){
  const[repairTypeId,setRepairTypeId]=useState(0),[payload,setPayload]=useState<Payload|null>(null),[items,setItems]=useState<Item[]>([]),[name,setName]=useState(""),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");

  function accept(next:Payload){setPayload(next);setName(next.template?.name||`${next.repairType.name} Checklist`);setItems(next.template?next.template.items.map(item=>({...item})):[blank("General")]);setDirty(false)}
  async function load(id:number){const response=await fetch(`/api/repair-type-checklist-templates?repairTypeId=${id}`,{cache:"no-store"});const next=await response.json() as Payload;if(!response.ok)throw new Error(next.error||"Checklist could not be loaded.");accept(next)}
  useEffect(()=>{const id=Number(new URL(window.location.href).searchParams.get("repairTypeId")||0);setRepairTypeId(id);if(!id){setMessage("Choose a repair type from Setup → Repair Types first.");return}void load(id).catch(error=>setMessage(error instanceof Error?error.message:"Checklist could not be loaded."))},[]);

  function patch(index:number,value:Partial<Item>){setItems(current=>renumber(current.map((item,i)=>i===index?{...item,...value}:item)));setDirty(true)}
  function addItem(section?:string){setItems(current=>renumber([...current,blank(section||current.at(-1)?.section||"General")]));setDirty(true)}
  function addSection(){const section=window.prompt("Section name:","New Section")?.trim();if(section)addItem(section)}
  function move(index:number,nextIndex:number){if(nextIndex<0||nextIndex>=items.length)return;setItems(current=>{const next=[...current];const[picked]=next.splice(index,1);next.splice(nextIndex,0,picked);return renumber(next)});setDirty(true)}
  function remove(index:number){if(!window.confirm("Remove this question from the draft?"))return;setItems(current=>renumber(current.filter((_,i)=>i!==index)));setDirty(true)}

  async function publish(){
    if(!repairTypeId)return;
    if(!items.length||items.some(item=>!item.section.trim()||!item.text.trim())){setMessage("Every checklist item needs a section and question.");return}
    if(!items.some(item=>item.enabled)){setMessage("At least one checklist item must be enabled.");return}
    if(items.some(item=>item.enabled&&!item.allowPass&&!item.allowFail&&!item.allowNa)){setMessage("Every enabled question must allow Pass, Fail, or N/A.");return}
    if(items.some(item=>item.enabled&&item.requireMeasurement&&!item.measurementLabel.trim())){setMessage("Every required measurement needs a label.");return}
    if(!window.confirm("Publish this checklist version? Work already started will keep the version it began with."))return;
    setBusy(true);setMessage("");
    try{const response=await fetch("/api/repair-type-checklist-templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"publish",repairTypeId,name,items})});const next=await response.json() as Payload;if(!response.ok||!next.ok)throw new Error(next.error||"Checklist could not be published.");accept(next);setMessage(`Published ${next.repairType.name} checklist v${next.template?.version}. New work orders will use it.`)}catch(error){setMessage(error instanceof Error?error.message:"Checklist could not be published.")}finally{setBusy(false)}
  }

  const enabled=items.filter(item=>item.enabled).length;
  const sections=useMemo(()=>new Set(items.filter(item=>item.enabled).map(item=>item.section.trim()).filter(Boolean)).size,[items]);
  const type=payload?.repairType;

  return <main style={{minHeight:"100vh",background:"#f3f5f7",padding:"30px clamp(12px,3vw,34px) 90px",color:"#182331"}}>
    <header style={{maxWidth:1100,margin:"0 auto",display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
      <div><p style={{margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"}}>REPAIR TYPE CHECKLIST</p><h1 style={{margin:"6px 0 0",fontSize:32,color:"#102a43"}}>{type?.name||"Checklist Builder"}</h1><p style={{margin:"7px 0 0",color:"#64748b",fontSize:13,maxWidth:800}}>Build the inspection exactly like PM/Annual: Pass / Fail / N/A, required notes, photos or measurements, and automatic corrective repairs when something fails.</p></div>
      <a href="/repair-types" style={{...secondary,textDecoration:"none"}}>← Repair Types</a>
    </header>

    {message&&<div style={{maxWidth:1100,margin:"14px auto 0",padding:"10px 12px",border:"1px solid #f2c66d",borderRadius:9,background:"#fff8e6",fontSize:12,fontWeight:800}}>{message}</div>}

    {payload&&<>
      <section style={{maxWidth:1100,margin:"16px auto 0",padding:15,border:"1px solid #d7e0e7",borderRadius:13,background:"white",display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap"}}>
        <div><strong style={{fontSize:16}}>Current published version: {payload.template?`v${payload.template.version}`:"None yet"}</strong><div style={{marginTop:4,fontSize:12,color:"#6b7883"}}>{enabled} enabled questions · {sections} sections · {type?.checklistMode==="required"?"Checklist required before closing":"Checklist optional"}</div></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" style={secondary} onClick={addSection}>+ ADD SECTION</button><button type="button" style={secondary} onClick={()=>addItem()}>+ ADD QUESTION</button><button type="button" disabled={busy||(!dirty&&Boolean(payload.template))} style={{...button,opacity:busy||(!dirty&&Boolean(payload.template))?.55:1}} onClick={()=>void publish()}>{busy?"PUBLISHING…":payload.template?"PUBLISH NEW VERSION":"PUBLISH CHECKLIST"}</button></div>
      </section>

      <section style={{maxWidth:1100,margin:"12px auto 0",padding:15,border:"1px solid #d7e0e7",borderRadius:13,background:"white"}}>
        <label style={label}>CHECKLIST NAME<input value={name} onChange={event=>{setName(event.target.value);setDirty(true)}} style={input} placeholder="Example: New Equipment Check"/></label>
      </section>

      <section style={{maxWidth:1100,margin:"12px auto 0",display:"grid",gap:10}}>
        {items.map((item,index)=><article key={`${index}-${item.position}`} style={{padding:14,border:"1px solid #d7e0e7",borderRadius:12,background:"white",opacity:item.enabled?1:.58}}>
          <div style={{display:"grid",gridTemplateColumns:"56px minmax(170px,.7fr) minmax(300px,2fr) auto",gap:8,alignItems:"end"}}>
            <div style={{width:42,height:42,borderRadius:10,background:"#edf2f6",display:"grid",placeItems:"center",fontWeight:950,color:"#17324a"}}>{index+1}</div>
            <label style={label}>SECTION<input value={item.section} onChange={event=>patch(index,{section:event.target.value})} style={input}/></label>
            <label style={label}>QUESTION / INSTRUCTION<textarea value={item.text} onChange={event=>patch(index,{text:event.target.value})} style={{...input,minHeight:62,resize:"vertical"}} placeholder="What should the technician inspect?"/></label>
            <div style={{display:"flex",gap:5}}><button type="button" disabled={index===0} onClick={()=>move(index,index-1)} style={secondary}>↑</button><button type="button" disabled={index===items.length-1} onClick={()=>move(index,index+1)} style={secondary}>↓</button><button type="button" onClick={()=>remove(index)} style={{...secondary,color:"#9b2c2c"}}>REMOVE</button></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:10,marginTop:10}}>
            <fieldset style={{border:"1px solid #e0e6eb",borderRadius:9,padding:10}}><legend style={{fontSize:11,fontWeight:900}}>ALLOWED ANSWERS</legend><div style={{display:"flex",gap:12,flexWrap:"wrap"}}><label><input type="checkbox" checked={item.allowPass} onChange={event=>patch(index,{allowPass:event.target.checked})}/> Pass</label><label><input type="checkbox" checked={item.allowFail} onChange={event=>patch(index,{allowFail:event.target.checked})}/> Fail</label><label><input type="checkbox" checked={item.allowNa} onChange={event=>patch(index,{allowNa:event.target.checked})}/> N/A</label></div></fieldset>
            <fieldset style={{border:"1px solid #e0e6eb",borderRadius:9,padding:10}}><legend style={{fontSize:11,fontWeight:900}}>REQUIRED PROOF</legend><div style={{display:"flex",gap:12,flexWrap:"wrap"}}><label><input type="checkbox" checked={item.requireNotes} onChange={event=>patch(index,{requireNotes:event.target.checked})}/> Note</label><label><input type="checkbox" checked={item.requirePhoto} onChange={event=>patch(index,{requirePhoto:event.target.checked})}/> Photo</label><label><input type="checkbox" checked={item.requireMeasurement} onChange={event=>patch(index,{requireMeasurement:event.target.checked,measurementLabel:event.target.checked?(item.measurementLabel||"Measurement"):item.measurementLabel})}/> Measurement</label></div></fieldset>
            <div style={{display:"grid",gridTemplateColumns:"1fr 90px",gap:7}}><label style={label}>MEASUREMENT<input disabled={!item.requireMeasurement} value={item.measurementLabel} onChange={event=>patch(index,{measurementLabel:event.target.value})} style={input} placeholder="Brake stroke"/></label><label style={label}>UNIT<input disabled={!item.requireMeasurement} value={item.measurementUnit} onChange={event=>patch(index,{measurementUnit:event.target.value})} style={input} placeholder="in"/></label></div>
          </div>
          <label style={{display:"inline-flex",gap:6,alignItems:"center",marginTop:10,fontSize:12,fontWeight:850}}><input type="checkbox" checked={item.enabled} onChange={event=>patch(index,{enabled:event.target.checked})}/> Enabled for new work orders</label>
        </article>)}
      </section>

      <section style={{maxWidth:1100,margin:"14px auto 0",padding:15,border:"1px solid #d7e0e7",borderRadius:13,background:"white"}}><strong>Version History</strong><div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:9}}>{payload.versions.map(version=><span key={version.id} style={{padding:"7px 9px",borderRadius:8,background:version.active?"#e9f7ef":"#f1f4f6",fontSize:11,fontWeight:850}}>v{version.version} · {version.itemCount} items{version.active?" · CURRENT":""}</span>)}{!payload.versions.length&&<span style={{fontSize:12,color:"#6b7883"}}>No checklist versions published yet.</span>}</div></section>
    </>}
  </main>;
}
