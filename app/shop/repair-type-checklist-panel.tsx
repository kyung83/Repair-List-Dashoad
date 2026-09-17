"use client";

import {useEffect,useState} from "react";

type Photo={id:number;fileName:string;url:string};
type Item={
  id:number|null;number:number;section:string;text:string;result:"pending"|"pass"|"fail"|"na";notes:string;measurementValue:string;
  allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;
  measurementLabel:string;measurementUnit:string;correctiveRepair:{id:string;status:string}|null;photos:Photo[];
};
type Payload={
  available:boolean;configured?:boolean;required?:boolean;checklistMode?:"optional"|"required";repairId?:string;repairType?:string;unit?:string;
  started?:boolean;status?:"not_started"|"in_progress"|"completed";templateName?:string;templateVersion?:number|null;
  pendingCount?:number;failedCount?:number;items?:Item[];completedAt?:string;error?:string;ok?:boolean;
};
type Props={repairId:string;canWork:boolean};

export default function RepairTypeChecklistPanel({repairId,canWork}:Props){
  const[data,setData]=useState<Payload|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const[notes,setNotes]=useState<Record<number,string>>({}),[measurements,setMeasurements]=useState<Record<number,string>>({});

  function accept(payload:Payload){
    setData(payload);
    setNotes(Object.fromEntries((payload.items??[]).map(item=>[item.number,item.notes||""])));
    setMeasurements(Object.fromEntries((payload.items??[]).map(item=>[item.number,item.measurementValue||""])));
  }
  async function load(){
    const response=await fetch(`/api/repair-type-checklist?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});
    const payload=await response.json() as Payload;
    if(!response.ok)throw new Error(payload.error||"Repair checklist could not be loaded.");
    accept(payload);
  }
  useEffect(()=>{setData(null);setOpen(false);setMessage("");void load().catch(()=>setData({available:false}))},[repairId]);

  async function post(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,repairId})});
      const payload=await response.json() as Payload;
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Checklist change failed.");
      accept(payload);return payload;
    }catch(error){setMessage(error instanceof Error?error.message:"Checklist change failed.");return null}
    finally{setBusy(false)}
  }

  async function setResult(item:Item,result:Item["result"]){
    const note=(notes[item.number]??"").trim(),measurement=(measurements[item.number]??"").trim();
    const saved=await post({action:"setItem",itemNumber:item.number,result,notes:note,measurement});
    if(saved)setMessage(result==="fail"?"Failed item saved. A linked corrective repair was created. Fix it, then change this item to Pass.":"Checklist item saved.");
  }

  async function upload(item:Item,file:File|null){
    if(!file)return;
    setBusy(true);setMessage("");
    try{
      const form=new FormData();form.set("repairTypeChecklist","1");form.set("action","uploadPhoto");form.set("repairId",repairId);form.set("itemNumber",String(item.number));form.set("photo",file);
      const response=await fetch("/api/shop/found-repair",{method:"POST",body:form});
      const payload=await response.json() as Payload;
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Photo could not be uploaded.");
      accept(payload);setMessage("Photo saved.");
    }catch(error){setMessage(error instanceof Error?error.message:"Photo could not be uploaded.")}
    finally{setBusy(false)}
  }

  if(!data?.available)return null;
  const items=data.items??[];
  const answered=items.filter(item=>item.result!=="pending").length;
  const pending=data.pendingCount??items.filter(item=>item.result==="pending").length;
  const failed=data.failedCount??items.filter(item=>item.result==="fail").length;
  const completed=data.status==="completed";
  const groups=new Map<string,Item[]>();
  for(const item of items){const rows=groups.get(item.section)??[];rows.push(item);groups.set(item.section,rows)}
  const grouped=[...groups.entries()];
  const finishDisabled=busy||pending>0||failed>0;

  return <section style={shell}>
    <button type="button" onClick={()=>setOpen(current=>!current)} style={{...launcher,borderColor:data.required?"#f1a24b":"#bdcbd6"}}>
      <span style={icon}>▣</span><span style={{minWidth:0,textAlign:"left",display:"grid",gap:3}}><strong style={{fontSize:16,color:"#17324a"}}>{data.repairType} Checklist</strong><span style={{fontSize:11,color:"#687783"}}>{data.required?"Required before this work order can be closed.":"Optional inspection checklist."}{data.started?` · ${answered}/${items.length} answered`:""}</span></span><span style={action}>{open?"CLOSE":"OPEN"}</span>
    </button>

    {open&&<div style={body}>
      {!data.configured?<div style={warning}><strong>CHECKLIST NOT SET UP YET</strong><span>A manager must publish the {data.repairType} checklist in Setup → Repair Types before this work order can be completed.</span></div>:<>
        {!data.started?<div style={startBox}><div><strong style={{fontSize:18}}>Ready to start {data.repairType}?</strong><p style={help}>Starting locks in checklist version {data.templateVersion??"—"}. Future edits will not change this inspection.</p></div>{canWork&&<button type="button" disabled={busy} style={primary} onClick={()=>void post({action:"startChecklist"})}>START CHECKLIST</button>}</div>:<>
          <div style={progress}><div style={{display:"flex",justifyContent:"space-between",gap:10}}><strong>{completed?"Checklist Complete":failed?`${failed} failed item${failed===1?"":"s"}`:`${answered} of ${items.length} answered`}</strong><span>{items.length?Math.round(answered/items.length*100):0}%</span></div><div style={track}><div style={{...fill,width:`${items.length?Math.round(answered/items.length*100):0}%`}}/></div></div>

          {message&&<div style={notice}>{message}</div>}

          <div style={{display:"grid",gap:13}}>{grouped.map(([section,rows])=><section key={section}><div style={sectionTitle}>{section}</div><div style={{display:"grid",gap:8}}>{rows.map(item=><article key={item.number} style={{...itemBox,borderColor:item.result==="fail"?"#e6a2a2":item.result==="pass"?"#a8cfb8":"#d9e1e7"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}><div><span style={number}>#{item.number}</span><strong style={{fontSize:14,color:"#17324a"}}>{item.text}</strong></div><span style={{...status,background:item.result==="fail"?"#fde8e8":item.result==="pass"?"#e9f7ef":item.result==="na"?"#edf2f6":"#fff5df",color:item.result==="fail"?"#9c2e2e":item.result==="pass"?"#176440":"#5e6872"}}>{item.result.toUpperCase()}</span></div>
            {item.correctiveRepair&&<div style={corrective}><strong>Corrective repair {item.correctiveRepair.id}</strong><span>{item.correctiveRepair.status||"Open"}</span></div>}
            {!completed&&canWork&&<>
              <textarea value={notes[item.number]??""} onChange={event=>setNotes(current=>({...current,[item.number]:event.target.value}))} placeholder={item.requireNotes||item.result==="fail"?"Note required":"Optional note"} style={{...input,minHeight:58,resize:"vertical"}} disabled={busy}/>
              {item.requireMeasurement&&<label style={label}>{item.measurementLabel||"Measurement"}{item.measurementUnit?` (${item.measurementUnit})`:""}<input value={measurements[item.number]??""} onChange={event=>setMeasurements(current=>({...current,[item.number]:event.target.value}))} style={input} disabled={busy}/></label>}
              <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center"}}>
                {item.allowPass&&<button type="button" disabled={busy} onClick={()=>void setResult(item,"pass")} style={passButton}>PASS</button>}
                {item.allowFail&&<button type="button" disabled={busy} onClick={()=>void setResult(item,"fail")} style={failButton}>FAIL</button>}
                {item.allowNa&&<button type="button" disabled={busy} onClick={()=>void setResult(item,"na")} style={naButton}>N/A</button>}
                <label style={photoButton}>+ PHOTO<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={event=>{const file=event.target.files?.[0]??null;event.currentTarget.value="";void upload(item,file)}} style={{display:"none"}}/></label>
                {item.requirePhoto&&<span style={{fontSize:10,fontWeight:900,color:item.photos.length?"#176440":"#a15c00"}}>{item.photos.length?"PHOTO SAVED":"PHOTO REQUIRED"}</span>}
              </div>
              {item.photos.length>0&&<div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{item.photos.map(photo=><div key={photo.id} style={photoWrap}><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.fileName} style={thumb}/></a><button type="button" disabled={busy} onClick={()=>void post({action:"removePhoto",photoId:photo.id})} style={removePhoto}>×</button></div>)}</div>}
            </>}
          </article>)}</div></section>)}</div>

          {!completed&&<div style={finishBox}><div><strong>Finish Checklist</strong><p style={help}>{pending?`${pending} unanswered item${pending===1?"":"s"} remain.`:failed?"Failed items must be repaired and changed to Pass first.":"All checklist questions are ready to lock."}</p></div>{canWork&&<button type="button" disabled={finishDisabled} onClick={()=>void post({action:"completeChecklist"})} style={{...primary,opacity:finishDisabled?.5:1}}>COMPLETE CHECKLIST</button>}</div>}
        </>}
      </>}
    </div>}
  </section>;
}

const shell={border:"1px solid #d5dee6",borderRadius:14,background:"white",overflow:"hidden",boxShadow:"0 4px 14px #13283d0a"} as const;
const launcher={width:"100%",border:"1px solid #bdcbd6",background:"white",padding:14,display:"grid",gridTemplateColumns:"38px minmax(0,1fr) auto",gap:10,alignItems:"center",cursor:"pointer"} as const;
const icon={width:38,height:38,borderRadius:10,display:"grid",placeItems:"center",background:"#edf4fb",color:"#17324a",fontWeight:950,fontSize:19} as const;
const action={borderRadius:8,padding:"8px 10px",background:"#176fe6",color:"white",fontSize:10,fontWeight:950} as const;
const body={padding:14,borderTop:"1px solid #e3e8ec",display:"grid",gap:12} as const;
const warning={padding:12,border:"1px solid #e6a24e",borderRadius:9,background:"#fff5e5",display:"grid",gap:4,fontSize:12,color:"#774700"} as const;
const startBox={display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap" as const,padding:12,border:"1px solid #d9e1e7",borderRadius:10,background:"#f9fbfc"} as const;
const finishBox={...startBox,marginTop:3,background:"#f5f9fd"} as const;
const help={margin:"4px 0 0",fontSize:11,color:"#687783"} as const;
const primary={border:0,borderRadius:9,padding:"10px 13px",background:"#176fe6",color:"white",fontWeight:950,cursor:"pointer"} as const;
const progress={padding:11,borderRadius:9,background:"#f6f8fa",fontSize:12} as const;
const track={height:7,borderRadius:999,background:"#e2e8ee",overflow:"hidden",marginTop:7} as const;
const fill={height:"100%",background:"#19945d",borderRadius:999} as const;
const notice={padding:"9px 10px",border:"1px solid #f0c56d",borderRadius:8,background:"#fff8e6",fontSize:11,fontWeight:800} as const;
const sectionTitle={margin:"4px 0 7px",fontSize:11,fontWeight:950,letterSpacing:".08em",color:"#61717e"} as const;
const itemBox={padding:12,border:"1px solid #d9e1e7",borderRadius:10,background:"#fff",display:"grid",gap:9} as const;
const number={display:"inline-block",marginRight:7,fontSize:10,fontWeight:950,color:"#74818b"} as const;
const status={padding:"4px 7px",borderRadius:999,fontSize:9,fontWeight:950} as const;
const corrective={padding:"7px 8px",borderRadius:8,background:"#fff0f0",color:"#8b2e2e",display:"flex",justifyContent:"space-between",gap:8,fontSize:10} as const;
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c7d2dc",borderRadius:8,padding:"9px 10px",background:"white",color:"#182331"} as const;
const label={display:"grid",gap:5,fontSize:11,fontWeight:900,color:"#596874"} as const;
const answer={border:0,borderRadius:8,padding:"8px 11px",fontWeight:950,cursor:"pointer"} as const;
const passButton={...answer,background:"#e4f5eb",color:"#176440"} as const;
const failButton={...answer,background:"#fde8e8",color:"#9a2f2f"} as const;
const naButton={...answer,background:"#edf2f6",color:"#4f5e69"} as const;
const photoButton={...answer,background:"#eaf1fa",color:"#174b7a",display:"inline-flex",alignItems:"center"} as const;
const photoWrap={position:"relative" as const,width:74,height:58,borderRadius:8,overflow:"hidden",border:"1px solid #cbd5df",background:"#edf2f6"} as const;
const thumb={width:"100%",height:"100%",objectFit:"cover" as const} as const;
const removePhoto={position:"absolute" as const,top:2,right:2,width:22,height:22,border:0,borderRadius:999,background:"#a52a2acc",color:"white",fontWeight:950,cursor:"pointer"} as const;
