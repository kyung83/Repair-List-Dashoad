"use client";

import { useEffect, useMemo, useState } from "react";

type BoardUser = {
  id:number;
  username:string;
  displayName:string;
  role:"viewer"|"mechanic"|"manager"|"admin";
  technicianId:number|null;
};
type BoardRow = {
  id:string;
  source:string;
  unit:string;
  issue:string;
  status:string;
  location:string;
  equipmentId:number|null;
  technicianId:number|null;
  assignedTo:string;
  outOfService:boolean;
  activeTimer:unknown;
};
type Equipment = { id:number; unit:string; equipmentType:string; location:string };
type BoardData = { user:BoardUser; repairs:BoardRow[]; equipment:Equipment[] };

function sourceLabel(source:string) {
  if (source === "pm" || source === "pm-repair") return "PM";
  if (source === "annual" || source === "annual-repair") return "ANNUAL";
  if (source === "dvir" || source === "dvir-repair") return "DVIR";
  return "REPAIR";
}
function unitKey(value:string) { return value.trim().toLowerCase().replace(/[^a-z0-9]/g,""); }

export default function RepairBoardSelfAssignPanel() {
  const [data,setData]=useState<BoardData|null>(null);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [showAdd,setShowAdd]=useState(false);
  const [showOos,setShowOos]=useState(false);
  const [unitSearch,setUnitSearch]=useState("");
  const [repairText,setRepairText]=useState("");
  const [partsText,setPartsText]=useState("");
  const [oosEquipmentId,setOosEquipmentId]=useState("");
  const [oosReason,setOosReason]=useState("");

  async function load() {
    const response=await fetch("/api/repair-board",{cache:"no-store"});
    const payload=await response.json() as BoardData&{error?:string};
    if (!response.ok) throw new Error(payload.error||"Repair Board could not be loaded.");
    setData(payload);
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Repair Board could not be loaded."));},[]);

  const claimable=useMemo(()=>{
    if (!data?.user.technicianId) return [];
    return data.repairs
      .filter(row=>row.technicianId===null && !row.activeTimer)
      .slice(0,24);
  },[data]);

  const myUnits=useMemo(()=>{
    if (!data?.user.technicianId) return [] as Array<{equipmentId:number;unit:string}>;
    const found=new Map<number,{equipmentId:number;unit:string}>();
    for (const row of data.repairs) {
      if (row.equipmentId && row.technicianId===data.user.technicianId && !row.outOfService) {
        found.set(row.equipmentId,{equipmentId:row.equipmentId,unit:row.unit});
      }
    }
    return [...found.values()].sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true,sensitivity:"base"}));
  },[data]);

  async function claim(row:BoardRow) {
    setBusy(row.id);
    setMessage("");
    try {
      const response=await fetch("/api/repair-board",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"assignToMe",repairId:row.id}),
      });
      const result=await response.json() as {ok?:boolean;error?:string;repairId?:string};
      if (!response.ok||!result.ok) throw new Error(result.error||"Work could not be assigned.");
      setMessage(`Unit ${row.unit||"—"}: assigned to you. It is now in My Units on Shop Jobs.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error?error.message:"Work could not be assigned.");
    } finally {
      setBusy("");
    }
  }

  async function addRepair() {
    if (!data) return;
    const key=unitKey(unitSearch);
    const equipment=data.equipment.find(item=>unitKey(item.unit)===key);
    if (!equipment) return setMessage("Choose an existing active unit from the unit search.");
    if (!repairText.trim()) return setMessage("Enter the repair needed.");
    setBusy("add-repair");setMessage("");
    try {
      const response=await fetch("/api/repair-board",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"createRepairForMe",equipmentId:equipment.id,issue:repairText.trim(),parts:partsText.trim()}),
      });
      const result=await response.json() as {ok?:boolean;error?:string};
      if (!response.ok||!result.ok) throw new Error(result.error||"Repair could not be added.");
      setUnitSearch("");setRepairText("");setPartsText("");setShowAdd(false);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error?error.message:"Repair could not be added.");
      setBusy("");
    }
  }

  async function placeOos() {
    const equipmentId=Number(oosEquipmentId);
    const unit=myUnits.find(item=>item.equipmentId===equipmentId);
    if (!unit) return setMessage("Choose one of your assigned units.");
    if (!oosReason.trim()) return setMessage("Enter why the unit is out of service.");
    setBusy("oos");setMessage("");
    try {
      const response=await fetch("/api/repair-board",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"setUnitOos",equipmentId,outOfService:true,reason:oosReason.trim()}),
      });
      const result=await response.json() as {ok?:boolean;error?:string};
      if (!response.ok||!result.ok) throw new Error(result.error||"Unit could not be placed out of service.");
      setOosEquipmentId("");setOosReason("");setShowOos(false);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error?error.message:"Unit could not be placed out of service.");
      setBusy("");
    }
  }

  if (!data) return message?<div style={notice}>{message}</div>:null;
  if (!data.user.technicianId) return null;
  const technicianMode=data.user.role==="mechanic";

  return <section style={panel}>
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
      <div>
        <p style={eyebrow}>WORKING TECHNICIAN</p>
        <h2 style={{margin:"4px 0 3px",fontSize:21,color:"#132334"}}>Repair Board tools</h2>
        <p style={{margin:0,color:"#687786",fontSize:13}}>Claim work here, then work it from Shop Jobs. Technician actions stay limited to your own work and yard.</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {technicianMode&&<button type="button" onClick={()=>{setShowAdd(v=>!v);setShowOos(false)}} style={addButton}>{showAdd?"CLOSE ADD":"+ ADD REPAIR"}</button>}
        {technicianMode&&<button type="button" onClick={()=>{setShowOos(v=>!v);setShowAdd(false)}} style={oosButton}>{showOos?"CLOSE OOS":"PLACE UNIT OOS"}</button>}
        <a href="/shop" style={shopLink}>Open My Shop Jobs</a>
      </div>
    </div>

    {message&&<div style={notice}>{message}</div>}

    {technicianMode&&showAdd&&<div style={actionBox}>
      <div><strong style={actionTitle}>Add repair to my work</strong><span style={help}>Choose an existing unit. The repair is P2 and automatically assigned to you.</span></div>
      <div style={formGrid}>
        <label style={label}>Unit<input list="tech-repair-units" value={unitSearch} onChange={event=>setUnitSearch(event.target.value)} placeholder="Type unit number" style={input}/></label>
        <datalist id="tech-repair-units">{data.equipment.map(item=><option key={item.id} value={item.unit}>{item.location}</option>)}</datalist>
        <label style={label}>Repair<input value={repairText} onChange={event=>setRepairText(event.target.value)} placeholder="What needs repaired?" style={input}/></label>
        <label style={label}>Parts / clue<input value={partsText} onChange={event=>setPartsText(event.target.value)} placeholder="Optional" style={input}/></label>
        <button type="button" disabled={Boolean(busy)} onClick={()=>void addRepair()} style={saveButton}>{busy==="add-repair"?"ADDING…":"ADD REPAIR TO ME"}</button>
      </div>
    </div>}

    {technicianMode&&showOos&&<div style={actionBox}>
      <div><strong style={actionTitle}>Place my unit out of service</strong><span style={help}>Only units with open work assigned to you appear here. A manager returns the unit to service later.</span></div>
      {myUnits.length?<div style={formGrid}>
        <label style={label}>Unit<select value={oosEquipmentId} onChange={event=>setOosEquipmentId(event.target.value)} style={input}><option value="">Choose my unit</option>{myUnits.map(item=><option key={item.equipmentId} value={item.equipmentId}>Unit {item.unit}</option>)}</select></label>
        <label style={{...label,gridColumn:"span 2"}}>Reason<input value={oosReason} onChange={event=>setOosReason(event.target.value)} placeholder="Why can this unit not be used?" style={input}/></label>
        <button type="button" disabled={Boolean(busy)} onClick={()=>void placeOos()} style={dangerButton}>{busy==="oos"?"SAVING…":"PLACE OUT OF SERVICE"}</button>
      </div>:<div style={{marginTop:10,color:"#667482",fontSize:13}}>You do not have an assigned unit available to place out of service.</div>}
    </div>}

    <div style={{marginTop:16,borderTop:"1px solid #e4e9ed",paddingTop:14}}>
      <strong style={{fontSize:14}}>Assign unassigned work to me</strong>
      {claimable.length>0?<div style={grid}>
        {claimable.map(row=><article key={row.id} style={card}>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}><strong style={{fontSize:16}}>Unit {row.unit||"—"}</strong><span style={badge}>{sourceLabel(row.source)}</span></div>
            <div style={{fontWeight:800,marginTop:5}}>{row.issue}</div>
            <div style={{fontSize:12,color:"#6c7885",marginTop:4}}>{row.location||"No yard/location"} · {row.status||"Open"}</div>
          </div>
          <button disabled={Boolean(busy)} onClick={()=>void claim(row)} style={claimButton}>{busy===row.id?"ASSIGNING…":"ASSIGN TO ME"}</button>
        </article>)}
      </div>:<div style={{marginTop:12,color:"#667482",fontSize:13}}>No unassigned work is available to claim right now.</div>}
    </div>
  </section>;
}

const panel={margin:"18px 30px 0",padding:18,background:"#fff",border:"1px solid #d8e0e7",borderRadius:14,color:"#172431"} as const;
const eyebrow={margin:0,fontSize:10,fontWeight:900,letterSpacing:".16em",color:"#f47b20"} as const;
const grid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))",gap:10,marginTop:12} as const;
const card={display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:12,border:"1px solid #e2e7eb",borderRadius:10,background:"#f9fafb"} as const;
const badge={fontSize:9,fontWeight:900,letterSpacing:".08em",padding:"3px 6px",borderRadius:999,background:"#e8eef4",color:"#40566b"} as const;
const claimButton={border:0,borderRadius:8,padding:"10px 12px",background:"#176440",color:"white",fontSize:11,fontWeight:900,whiteSpace:"nowrap",cursor:"pointer"} as const;
const shopLink={display:"inline-block",padding:"9px 12px",borderRadius:8,background:"#0d1b2b",color:"white",fontWeight:900,fontSize:12,textDecoration:"none"} as const;
const addButton={border:0,borderRadius:8,padding:"9px 12px",background:"#f47b20",color:"white",fontWeight:900,fontSize:12,cursor:"pointer"} as const;
const oosButton={border:"1px solid #a23c34",borderRadius:8,padding:"9px 12px",background:"#fff",color:"#8b2f29",fontWeight:900,fontSize:12,cursor:"pointer"} as const;
const actionBox={marginTop:14,padding:14,border:"1px solid #d9e1e8",borderRadius:11,background:"#f8fafb"} as const;
const actionTitle={display:"block",fontSize:15,color:"#182b3d"} as const;
const help={display:"block",fontSize:11,color:"#6b7884",marginTop:2} as const;
const formGrid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:9,alignItems:"end",marginTop:11} as const;
const label={display:"grid",gap:4,fontSize:11,fontWeight:900,color:"#53616d"} as const;
const input={width:"100%",boxSizing:"border-box",padding:"10px 11px",border:"1px solid #cbd5dd",borderRadius:8,background:"white",color:"#172431",fontSize:14} as const;
const saveButton={border:0,borderRadius:8,padding:"11px 12px",background:"#176440",color:"white",fontWeight:900,cursor:"pointer"} as const;
const dangerButton={border:0,borderRadius:8,padding:"11px 12px",background:"#9a312b",color:"white",fontWeight:900,cursor:"pointer"} as const;
const notice={marginTop:12,padding:10,border:"1px solid #f1c66d",borderRadius:8,background:"#fff8e6",color:"#5d4b22",fontSize:13} as const;
