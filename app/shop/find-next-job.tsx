"use client";

import { useEffect, useMemo, useState } from "react";

type User={role:"viewer"|"mechanic"|"manager"|"admin";technicianId:number|null};
type Repair={id:string;unit:string;issue:string;status:string;location:string;technicianId:number|null;assignedTo:string};
type ShopData={user:User;activeTimer:{repairId:string}|null;repairs:Repair[]};

export default function FindNextJob(){
  const[data,setData]=useState<ShopData|null>(null);
  const[busy,setBusy]=useState<string>("");
  const[message,setMessage]=useState("");

  async function load(){
    const response=await fetch("/api/shop",{cache:"no-store"});
    const payload=await response.json() as ShopData&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Open repairs could not be loaded.");
    setData(payload);
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Open repairs could not be loaded."));},[]);

  const choices=useMemo(()=>{
    if(!data?.user.technicianId)return{unassigned:[] as Repair[],other:[] as Repair[]};
    return{
      unassigned:data.repairs.filter(r=>r.technicianId===null),
      other:data.repairs.filter(r=>r.technicianId!==null&&r.technicianId!==data.user.technicianId),
    };
  },[data]);

  async function take(repair:Repair){
    setBusy(repair.id);setMessage("");
    try{
      const response=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"openRepair",repairId:repair.id})});
      const result=await response.json() as{ok?:boolean;error?:string;takenOver?:boolean;previousTechnician?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"That job could not be opened.");
      window.location.reload();
    }catch(error){setMessage(error instanceof Error?error.message:"That job could not be opened.");setBusy("");}
  }

  if(!data||data.user.role!=="mechanic"||!data.user.technicianId||data.activeTimer)return null;
  const count=choices.unassigned.length+choices.other.length;
  if(count===0)return null;

  return <section style={{margin:"18px 34px 0",padding:16,border:"2px solid #f47b20",borderRadius:14,background:"#fff8f1",color:"#182331"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline",flexWrap:"wrap"}}>
      <div>
        <div style={{fontSize:11,fontWeight:900,letterSpacing:".14em",color:"#d85f08"}}>FIND NEXT JOB</div>
        <h2 style={{margin:"5px 0 3px",fontSize:23}}>Need another repair? Pick one here.</h2>
        <div style={{fontSize:13,color:"#667482"}}>Unassigned work is listed first. You can also take another open repair if nobody is actively clocked into it.</div>
      </div>
      <strong>{count} job{count===1?"":"s"} available to view</strong>
    </div>
    {message&&<div style={{marginTop:10,padding:10,borderRadius:9,background:"#fff",border:"1px solid #e7b88e",fontWeight:750}}>{message}</div>}
    <div style={{marginTop:14,maxHeight:430,overflow:"auto",display:"grid",gap:14}}>
      {choices.unassigned.length>0&&<div>
        <h3 style={{margin:"0 0 8px",fontSize:16}}>Unassigned Repairs ({choices.unassigned.length})</h3>
        <div style={{display:"grid",gap:7}}>{choices.unassigned.map(repair=><JobRow key={repair.id} repair={repair} label="Open & Start" busy={busy===repair.id} onTake={()=>void take(repair)}/>)}</div>
      </div>}
      {choices.other.length>0&&<div>
        <h3 style={{margin:"0 0 8px",fontSize:16}}>Other Open Repairs ({choices.other.length})</h3>
        <div style={{display:"grid",gap:7}}>{choices.other.map(repair=><JobRow key={repair.id} repair={repair} label="Take Job & Start" busy={busy===repair.id} onTake={()=>void take(repair)}/>)}</div>
      </div>}
    </div>
  </section>;
}

function JobRow({repair,label,busy,onTake}:{repair:Repair;label:string;busy:boolean;onTake:()=>void}){
  return <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:11,borderRadius:10,background:"#fff",border:"1px solid #e3e7ea",flexWrap:"wrap"}}>
    <div style={{minWidth:220,flex:"1 1 360px"}}>
      <strong style={{display:"block"}}>Unit {repair.unit||"—"} · {repair.issue}</strong>
      <span style={{fontSize:12,color:"#667482"}}>{repair.location||"No location"} · {repair.status||"Open"} · {repair.technicianId===null?"Unassigned":`Assigned to ${repair.assignedTo||"another technician"}`}</span>
    </div>
    <button type="button" disabled={busy} onClick={onTake} style={{border:0,borderRadius:9,padding:"10px 14px",background:"#f47b20",color:"white",fontWeight:900,cursor:busy?"wait":"pointer"}}>{busy?"Opening...":label}</button>
  </div>;
}
