"use client";

import {useEffect,useState} from "react";
import s from "./repair-board.module.css";

type Props={repairId:string;source:string};
type User={role:"viewer"|"mechanic"|"manager"|"admin"};
type Repair={id:string;source:string;unit:string;issue:string;equipmentId:number|null};
type Equipment={id:number;unit:string;equipmentType:string;driver:string;location:string};
type BoardData={repairs:Repair[];equipment:Equipment[];error?:string};

let manageAccessPromise:Promise<boolean>|null=null;
function canManage(){
 if(!manageAccessPromise){
  manageAccessPromise=fetch("/api/auth/me",{cache:"no-store"})
   .then(async response=>response.ok?(await response.json() as{user:User}).user:null)
   .then(user=>Boolean(user&&(user.role==="manager"||user.role==="admin")))
   .catch(()=>false);
 }
 return manageAccessPromise;
}

export default function RepairCorrectionControls({repairId,source}:Props){
 const[allowed,setAllowed]=useState(false);
 const[open,setOpen]=useState(false);
 const[loading,setLoading]=useState(false);
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState("");
 const[repair,setRepair]=useState<Repair|null>(null);
 const[equipment,setEquipment]=useState<Equipment[]>([]);
 const[title,setTitle]=useState("");
 const[equipmentId,setEquipmentId]=useState("");

 useEffect(()=>{
  if(source!=="repair")return;
  let cancelled=false;
  void canManage().then(value=>{if(!cancelled)setAllowed(value)});
  return()=>{cancelled=true};
 },[source]);

 async function load(){
  setLoading(true);setMessage("");
  try{
   const response=await fetch("/api/repair-board",{cache:"no-store"});
   const payload=await response.json() as BoardData;
   if(!response.ok)throw new Error(payload.error||"Repair could not be loaded.");
   const row=(payload.repairs||[]).find(item=>item.id===repairId&&item.source==="repair")||null;
   if(!row)throw new Error("This repair is no longer available for correction.");
   setRepair(row);setEquipment(payload.equipment||[]);setTitle(row.issue);setEquipmentId(String(row.equipmentId??""));
  }catch(error){setMessage(error instanceof Error?error.message:"Repair could not be loaded.");}
  finally{setLoading(false);}
 }

 async function toggle(){
  const next=!open;setOpen(next);
  if(next&&!repair)await load();
 }

 async function save(){
  if(!repair)return;
  if(!title.trim()){setMessage("Repair description cannot be blank.");return;}
  if(!equipmentId){setMessage("Choose the correct unit.");return;}
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/repair-board",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"editRepair",repairId:repair.id,title:title.trim(),equipmentId:Number(equipmentId)}),
   });
   const payload=await response.json() as{ok?:boolean;error?:string};
   if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair correction could not be saved.");
   window.location.reload();
  }catch(error){setMessage(error instanceof Error?error.message:"Repair correction could not be saved.");setBusy(false);}
 }

 async function remove(){
  if(!repair)return;
  const reason=prompt(`Why are you deleting this repair from Unit ${repair.unit}?`,`Entered by mistake`);
  if(reason===null)return;
  if(!reason.trim()){setMessage("Enter a reason before deleting a repair.");return;}
  if(!confirm(`Delete “${repair.issue}” from Unit ${repair.unit}?\n\nThis is only allowed when no labor, parts, photos, part requests, invoice, or maintenance history is attached.`))return;
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/repair-board",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"deleteRepair",repairId:repair.id,reason:reason.trim()}),
   });
   const payload=await response.json() as{ok?:boolean;error?:string};
   if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair could not be deleted.");
   window.location.reload();
  }catch(error){setMessage(error instanceof Error?error.message:"Repair could not be deleted.");setBusy(false);}
 }

 if(source!=="repair"||!allowed)return null;
 const changed=repair?title.trim()!==repair.issue||Number(equipmentId)!==Number(repair.equipmentId??0):false;
 return <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #dce4ea"}}>
  <button type="button" className={s.metaButton} onClick={()=>void toggle()}>{open?"Close Correction":"Correct Repair"}</button>
  {open&&<div style={{marginTop:10,padding:12,border:"1px solid #d8e0e7",borderRadius:10,background:"#f8fafc"}}>
   <div style={{fontSize:10,fontWeight:900,letterSpacing:".05em",color:"#42576a",marginBottom:8}}>MANAGER / ADMIN REPAIR CORRECTION</div>
   {loading?<div style={{fontSize:11,color:"#66798c"}}>Loading repair…</div>:repair?<>
    <div style={{display:"grid",gridTemplateColumns:"minmax(150px,.7fr) minmax(260px,1.4fr)",gap:8,alignItems:"end"}}>
     <label style={{display:"grid",gap:4,fontSize:9,fontWeight:800,color:"#607386"}}>CORRECT UNIT
      <select className={s.fieldSelect} value={equipmentId} onChange={event=>setEquipmentId(event.target.value)} disabled={busy}>
       <option value="">Choose unit…</option>
       {equipment.map(unit=><option key={unit.id} value={unit.id}>{unit.unit}</option>)}
      </select>
     </label>
     <label style={{display:"grid",gap:4,fontSize:9,fontWeight:800,color:"#607386"}}>REPAIR DESCRIPTION
      <input value={title} onChange={event=>setTitle(event.target.value)} disabled={busy} style={{width:"100%",boxSizing:"border-box",minHeight:36,border:"1px solid #c8d3de",borderRadius:8,padding:"7px 9px",fontSize:11,background:"white"}}/>
     </label>
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:9}}>
     <button type="button" className={s.primaryAction} disabled={busy||!changed} onClick={()=>void save()}>{busy?"Saving…":"Save Correction"}</button>
     <button type="button" className={s.dangerOutline} disabled={busy} onClick={()=>void remove()}>Delete Mistake</button>
    </div>
    <div style={{marginTop:7,fontSize:9,color:"#738494"}}>Delete is only for mistaken empty repairs. If labor, parts, photos, requests, invoice, or maintenance history exists, the system blocks the delete and preserves the history.</div>
   </>:null}
   {message&&<div style={{marginTop:8,fontSize:10,fontWeight:800,color:"#9a3946"}}>{message}</div>}
  </div>}
 </div>;
}
