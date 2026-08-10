"use client";

import { useEffect, useMemo, useState } from "react";

type Equipment = { id:number; unit:string; equipmentType:string; location:string; driver:string };
type PmJob = { id:string; equipmentId:number|null; unit:string; title:string; status:string; location:string; technicianId:number|null; assignedTo:string };
type Followup = {
  id:number;
  equipmentId:number;
  unit:string;
  equipmentType:string;
  location:string;
  description:string;
  status:"pending"|"attached";
  originRepairId:string|null;
  queuedFromRepairId:string|null;
  targetRepairId:string|null;
  taggedAt:string;
  taggedBy:string;
  deferCount:number;
  targetTitle:string;
  targetTechnician:string;
};
type Data = {
  user:{ id:number; username:string; displayName:string; role:"mechanic"|"manager"|"admin"; technicianId:number|null };
  canManage:boolean;
  equipment:Equipment[];
  pmJobs:PmJob[];
  followups:Followup[];
  updatedAt:string;
};
type Result = { ok?:boolean; error?:string };
type EquipmentType = "truck"|"trailer"|"other";

function equipmentGroup(value:string):EquipmentType {
  const type=value.toLowerCase();
  if(type.includes("trailer")) return "trailer";
  if(type.includes("truck")||type.includes("tractor")||type.includes("vehicle")||type.includes("glider")||type.includes("switcher")) return "truck";
  return "other";
}

function whenText(value:string){
  const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";
  const date=new Date(normalized);
  return Number.isNaN(date.getTime())?value:date.toLocaleString();
}

export default function NextPmRepairsPage(){
  const[data,setData]=useState<Data|null>(null);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  const[selectedPmId,setSelectedPmId]=useState("");
  const[techDescription,setTechDescription]=useState("");
  const[equipmentType,setEquipmentType]=useState<EquipmentType>("truck");
  const[equipmentSearch,setEquipmentSearch]=useState("");
  const[equipmentId,setEquipmentId]=useState("");
  const[officeDescription,setOfficeDescription]=useState("");

  async function load(){
    const response=await fetch("/api/pm-followups",{cache:"no-store"});
    const payload=await response.json() as Data&{error?:string};
    if(!response.ok) throw new Error(payload.error||"Next PM repairs could not be loaded.");
    setData(payload);
    setSelectedPmId((current)=>current&&payload.pmJobs.some((job)=>job.id===current)?current:(payload.pmJobs[0]?.id??""));
  }

  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"Next PM repairs could not be loaded."));},[]);

  async function post(body:Record<string,unknown>,success:string){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/pm-followups",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as Result;
      if(!response.ok||!result.ok) throw new Error(result.error||"Next PM repair change failed.");
      await load();setMessage(success);return true;
    }catch(error){setMessage(error instanceof Error?error.message:"Next PM repair change failed.");return false;}
    finally{setBusy(false);}
  }

  const matchingEquipment=useMemo(()=>{
    const needle=equipmentSearch.trim().toLowerCase();
    return (data?.equipment??[])
      .filter((item)=>equipmentGroup(item.equipmentType)===equipmentType)
      .filter((item)=>!needle||[item.unit,item.location,item.driver].join(" ").toLowerCase().includes(needle))
      .sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true,sensitivity:"base"}))
      .slice(0,80);
  },[data,equipmentSearch,equipmentType]);

  const selectedPm=data?.pmJobs.find((job)=>job.id===selectedPmId)??null;
  const attachedForSelected=(data?.followups??[]).filter((item)=>item.status==="attached"&&item.targetRepairId===selectedPmId);
  const queuedFromSelected=(data?.followups??[]).filter((item)=>item.status==="pending"&&item.queuedFromRepairId===selectedPmId);

  async function addOffice(){
    if(!equipmentId){setMessage("Choose the matching equipment first.");return;}
    if(!officeDescription.trim()){setMessage("Enter the repair or condition for the next PM.");return;}
    const equipment=data?.equipment.find((item)=>item.id===Number(equipmentId));
    const ok=await post({action:"addNextPmRepair",equipmentId:Number(equipmentId),description:officeDescription},`Next PM repair queued for Unit ${equipment?.unit??""}.`);
    if(ok){setOfficeDescription("");setEquipmentSearch("");setEquipmentId("");}
  }

  async function addTech(){
    if(!selectedPm){setMessage("Choose an assigned PM work order.");return;}
    if(!techDescription.trim()){setMessage("Enter what should be addressed on the next PM.");return;}
    const ok=await post({action:"addNextPmRepair",repairId:selectedPm.id,description:techDescription},`Saved for Unit ${selectedPm.unit}'s next PM.`);
    if(ok)setTechDescription("");
  }

  const grouped=useMemo(()=>{
    const map=new Map<number,{equipmentId:number;unit:string;location:string;items:Followup[]}>();
    for(const item of data?.followups??[]){
      const current=map.get(item.equipmentId);
      if(current)current.items.push(item);else map.set(item.equipmentId,{equipmentId:item.equipmentId,unit:item.unit,location:item.location,items:[item]});
    }
    return [...map.values()].sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true,sensitivity:"base"}));
  },[data]);

  return <main style={pageStyle}>
    <header style={headerStyle}>
      <div>
        <p style={eyebrow}>PLANNED SHOP WORK</p>
        <h1 style={{margin:"5px 0",fontSize:32}}>Next PM Repairs</h1>
        <p style={subtitle}>Carry a repair forward with the unit so the next PM already knows about it. Driver requests and technician findings use the same queue.</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a href="/repair-board" style={linkButton}>Repair Board</a><a href="/shop" style={linkButton}>Shop Jobs</a></div>
    </header>

    {message&&<div style={noticeStyle}>{message}</div>}

    {data?.canManage&&<section style={cardStyle}>
      <div style={sectionHeader}><div><strong style={sectionTitle}>Driver / Office Request</strong><div style={helper}>Use this when a driver says something should be handled at the next PM, even if there is no PM open right now.</div></div><span style={badge}>WAIT FOR NEXT PM</span></div>
      <div style={formGrid}>
        <label style={labelStyle}>TYPE<select style={inputStyle} value={equipmentType} onChange={(event)=>{setEquipmentType(event.target.value as EquipmentType);setEquipmentId("");setEquipmentSearch("");}}><option value="truck">Truck</option><option value="trailer">Trailer</option><option value="other">Other Equipment</option></select></label>
        <label style={labelStyle}>TYPE TO FIND UNIT<input style={inputStyle} value={equipmentSearch} onChange={(event)=>{setEquipmentSearch(event.target.value);setEquipmentId("");}} placeholder="Unit, location, driver…" /></label>
        <label style={labelStyle}>MATCHING EQUIPMENT<select style={inputStyle} value={equipmentId} onChange={(event)=>setEquipmentId(event.target.value)}><option value="">Choose unit…</option>{matchingEquipment.map((item)=><option key={item.id} value={item.id}>{item.unit}{item.location?` — ${item.location}`:""}{item.driver?` — ${item.driver}`:""}</option>)}</select></label>
      </div>
      <div style={{marginTop:10,display:"grid",gridTemplateColumns:"minmax(260px,1fr) auto",gap:8}}><input style={inputStyle} value={officeDescription} onChange={(event)=>setOfficeDescription(event.target.value)} placeholder="Example: Driver says right mirror is loose — repair on next PM" /><button style={primaryButton} disabled={busy} onClick={()=>void addOffice()}>{busy?"Saving…":"Add to Next PM"}</button></div>
    </section>}

    {!data?.canManage&&<section style={cardStyle}>
      <div style={sectionHeader}><div><strong style={sectionTitle}>Technician PM Follow-Up</strong><div style={helper}>Choose the PM you are working. Items carried in from the last PM show here, and you can tag new findings for the following PM.</div></div><span style={badge}>TECH PM</span></div>
      {data?.pmJobs.length?<>
        <label style={{...labelStyle,marginTop:12}}>ASSIGNED PM<select style={inputStyle} value={selectedPmId} onChange={(event)=>setSelectedPmId(event.target.value)}>{data.pmJobs.map((job)=><option key={job.id} value={job.id}>Unit {job.unit} — {job.title} — {job.status}</option>)}</select></label>
        {selectedPm&&<div style={pmBox}>
          <div><strong>Unit {selectedPm.unit} · Repairs carried into this PM</strong><div style={helper}>{selectedPm.location||"Location not set"}</div></div>
          <div style={{marginTop:10,display:"grid",gap:7}}>
            {attachedForSelected.map((item)=><div key={item.id} style={followupRow}><div><strong>{item.description}</strong><small style={smallText}>Tagged by {item.taggedBy} · {whenText(item.taggedAt)}{item.deferCount?` · moved forward ${item.deferCount} time${item.deferCount===1?"":"s"}`:""}</small></div><div style={buttonRow}><button style={doneButton} disabled={busy} onClick={()=>void post({action:"completeNextPmRepair",itemId:item.id},`Marked complete: ${item.description}`)}>Done</button><button style={lightButton} disabled={busy} onClick={()=>void post({action:"deferNextPmRepair",itemId:item.id},`Moved to the following PM: ${item.description}`)}>Next PM Again</button></div></div>)}
            {!attachedForSelected.length&&<div style={emptyStyle}>No repairs were carried into this PM.</div>}
          </div>
          <div style={{marginTop:14,borderTop:"1px solid #dfe5ea",paddingTop:12}}><strong>Tag another repair for the next PM</strong><div style={{marginTop:7,display:"grid",gridTemplateColumns:"minmax(260px,1fr) auto",gap:8}}><input style={inputStyle} value={techDescription} onChange={(event)=>setTechDescription(event.target.value)} placeholder="Example: Brakes low — inspect/replace next PM" /><button style={primaryButton} disabled={busy} onClick={()=>void addTech()}>Save for Next PM</button></div></div>
          {queuedFromSelected.length>0&&<div style={{marginTop:12}}><strong style={{fontSize:12}}>Already queued from this PM</strong><div style={{marginTop:6,display:"grid",gap:6}}>{queuedFromSelected.map((item)=><div key={item.id} style={queuedRow}><span>{item.description}</span><button style={removeButton} disabled={busy} onClick={()=>void post({action:"cancelNextPmRepair",itemId:item.id},`Removed from the next PM queue: ${item.description}`)}>Remove</button></div>)}</div></div>}
        </div>}
      </>:<div style={emptyStyle}>You do not have an open scheduled PM assigned right now.</div>}
    </section>}

    {data?.canManage&&<section style={{marginTop:18}}>
      <div style={sectionHeader}><div><strong style={sectionTitle}>Open Next PM Queue</strong><div style={helper}>Pending = waiting for a future PM. On Current PM = it automatically attached when that PM work order was created.</div></div><span style={countBadge}>{data.followups.length}</span></div>
      <div style={{marginTop:10,display:"grid",gap:10}}>
        {grouped.map((group)=><article key={group.equipmentId} style={unitCard}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline",flexWrap:"wrap"}}><div><strong style={{fontSize:17}}>Unit {group.unit}</strong><span style={unitLocation}>{group.location||"Location not set"}</span></div><b>{group.items.length} item{group.items.length===1?"":"s"}</b></div>
          <div style={{marginTop:8,display:"grid",gap:6}}>{group.items.map((item)=><div key={item.id} style={followupRow}><div><strong>{item.description}</strong><small style={smallText}>{item.status==="attached"?`On current PM${item.targetTechnician?` · ${item.targetTechnician}`:""}`:"Waiting for next PM"} · Tagged by {item.taggedBy} · {whenText(item.taggedAt)}</small></div><div style={buttonRow}>{item.status==="pending"?<button style={removeButton} disabled={busy} onClick={()=>void post({action:"cancelNextPmRepair",itemId:item.id},`Removed from next PM: ${item.description}`)}>Remove</button>:<><button style={doneButton} disabled={busy} onClick={()=>void post({action:"completeNextPmRepair",itemId:item.id},`Marked complete: ${item.description}`)}>Done</button><button style={lightButton} disabled={busy} onClick={()=>void post({action:"deferNextPmRepair",itemId:item.id},`Moved forward again: ${item.description}`)}>Next PM Again</button></>}</div></div>)}</div>
        </article>)}
        {!grouped.length&&<div style={emptyStyle}>There are no repairs waiting for a future PM right now.</div>}
      </div>
    </section>}
  </main>;
}

const pageStyle={minHeight:"100vh",background:"#f3f5f7",padding:"30px 34px 90px",color:"#182331"} as const;
const headerStyle={display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:18,flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:900,letterSpacing:".15em"} as const;
const subtitle={margin:0,color:"#687681",maxWidth:780,lineHeight:1.5} as const;
const linkButton={textDecoration:"none",border:"1px solid #cbd4dc",background:"white",color:"#1e2d3b",padding:"9px 12px",borderRadius:8,fontWeight:800,fontSize:12} as const;
const noticeStyle={marginTop:16,padding:"10px 12px",border:"1px solid #edc469",background:"#fff8e6",borderRadius:9} as const;
const cardStyle={marginTop:18,background:"white",border:"1px solid #d9e0e5",borderRadius:12,padding:16,boxShadow:"0 5px 20px #1020300c"} as const;
const sectionHeader={display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:12,flexWrap:"wrap" as const} as const;
const sectionTitle={fontSize:18,color:"#102235"} as const;
const helper={marginTop:3,color:"#6d7a85",fontSize:11,lineHeight:1.4} as const;
const badge={padding:"4px 7px",borderRadius:999,background:"#fff0dc",color:"#a6530c",fontSize:10,fontWeight:900} as const;
const countBadge={display:"inline-flex",minWidth:30,height:30,alignItems:"center",justifyContent:"center",borderRadius:999,background:"#102235",color:"white",fontWeight:900} as const;
const formGrid={marginTop:12,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8} as const;
const labelStyle={display:"grid",gap:4,color:"#596773",fontSize:9,fontWeight:900,letterSpacing:".04em"} as const;
const inputStyle={boxSizing:"border-box" as const,width:"100%",border:"1px solid #cbd4dc",borderRadius:8,padding:"10px 11px",background:"white",color:"#182331",fontSize:13} as const;
const primaryButton={border:0,borderRadius:8,padding:"10px 13px",background:"#f47b20",color:"white",fontWeight:900,cursor:"pointer"} as const;
const lightButton={border:"1px solid #cbd4dc",borderRadius:7,padding:"7px 9px",background:"#f8fafb",color:"#23313e",fontWeight:800,cursor:"pointer",fontSize:11} as const;
const doneButton={border:"1px solid #86b89b",borderRadius:7,padding:"7px 9px",background:"#eaf7ef",color:"#176440",fontWeight:900,cursor:"pointer",fontSize:11} as const;
const removeButton={border:"1px solid #d6b0aa",borderRadius:7,padding:"7px 9px",background:"#fff3f1",color:"#9d382e",fontWeight:900,cursor:"pointer",fontSize:11} as const;
const pmBox={marginTop:12,border:"1px solid #dbe3e8",background:"#fbfcfd",borderRadius:10,padding:13} as const;
const followupRow={display:"grid",gridTemplateColumns:"minmax(220px,1fr) auto",gap:10,alignItems:"center",padding:"9px 10px",border:"1px solid #e0e6ea",borderRadius:8,background:"white"} as const;
const queuedRow={display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",padding:"7px 9px",border:"1px dashed #d4dce2",borderRadius:7,color:"#46545f",fontSize:12} as const;
const buttonRow={display:"flex",gap:6,flexWrap:"wrap" as const,justifyContent:"flex-end"} as const;
const smallText={display:"block",marginTop:3,color:"#74818b",fontSize:10,lineHeight:1.4} as const;
const emptyStyle={padding:18,border:"1px dashed #cbd5dc",borderRadius:9,textAlign:"center" as const,color:"#75828d",background:"#fbfcfd"} as const;
const unitCard={background:"white",border:"1px solid #d9e0e5",borderRadius:10,padding:12} as const;
const unitLocation={display:"block",marginTop:2,color:"#77838d",fontSize:11} as const;
