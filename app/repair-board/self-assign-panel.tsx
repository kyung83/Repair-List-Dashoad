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
  technicianId:number|null;
  assignedTo:string;
  activeTimer:unknown;
};
type BoardData = { user:BoardUser; repairs:BoardRow[] };

function sourceLabel(source:string) {
  if (source === "pm" || source === "pm-repair") return "PM";
  if (source === "annual" || source === "annual-repair") return "ANNUAL";
  if (source === "dvir" || source === "dvir-repair") return "DVIR";
  return "REPAIR";
}

export default function RepairBoardSelfAssignPanel() {
  const [data,setData]=useState<BoardData|null>(null);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

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
      .slice(0,18);
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

  if (!data) return message?<div style={notice}>{message}</div>:null;
  if (!data.user.technicianId) return null;

  return <section style={panel}>
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
      <div>
        <p style={eyebrow}>WORKING TECHNICIAN</p>
        <h2 style={{margin:"4px 0 3px",fontSize:21,color:"#132334"}}>Assign work to me</h2>
        <p style={{margin:0,color:"#687786",fontSize:13}}>Claim an unassigned Repair Board item, then work it from Shop Jobs. Your manager clearance stays unchanged.</p>
      </div>
      <a href="/shop" style={shopLink}>Open My Shop Jobs</a>
    </div>
    {message&&<div style={notice}>{message}</div>}
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
  </section>;
}

const panel={margin:"18px 30px 0",padding:18,background:"#fff",border:"1px solid #d8e0e7",borderRadius:14,color:"#172431"};
const eyebrow={margin:0,fontSize:10,fontWeight:900,letterSpacing:".16em",color:"#f47b20"};
const grid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))",gap:10,marginTop:14};
const card={display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:12,border:"1px solid #e2e7eb",borderRadius:10,background:"#f9fafb"};
const badge={fontSize:9,fontWeight:900,letterSpacing:".08em",padding:"3px 6px",borderRadius:999,background:"#e8eef4",color:"#40566b"};
const claimButton={border:0,borderRadius:8,padding:"10px 12px",background:"#176440",color:"white",fontSize:11,fontWeight:900,whiteSpace:"nowrap" as const,cursor:"pointer"};
const shopLink={display:"inline-block",padding:"9px 12px",borderRadius:8,background:"#0d1b2b",color:"white",fontWeight:900,fontSize:12,textDecoration:"none"};
const notice={marginTop:12,padding:10,border:"1px solid #f1c66d",borderRadius:8,background:"#fff8e6",color:"#5d4b22",fontSize:13};
