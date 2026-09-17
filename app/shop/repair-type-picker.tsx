"use client";

import {useEffect,useState} from "react";

type RepairType={id:number;name:string;unitRule:"required"|"optional";checklistMode:"none"|"optional"|"required";checklistConfigured:boolean};
type Payload={repairId:string;equipmentId:number|null;unit:string;source:string;repairType:RepairType|null;types:RepairType[];canEdit:boolean;dedicatedType:string;error?:string};

type Props={repairId:string;equipmentId:number|null};

export default function RepairTypePicker({repairId,equipmentId}:Props){
  const[data,setData]=useState<Payload|null>(null),[value,setValue]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function load(){const response=await fetch(`/api/repair-types/repair?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});const payload=await response.json() as Payload;if(!response.ok)throw new Error(payload.error||"Repair type could not be loaded.");setData(payload);setValue(payload.repairType?String(payload.repairType.id):"")}
  useEffect(()=>{setData(null);setValue("");setMessage("");void load().catch(error=>setMessage(error instanceof Error?error.message:"Repair type could not be loaded."))},[repairId]);

  async function save(next:string){
    setValue(next);if(!next)return;
    setBusy(true);setMessage("");
    try{const response=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"setRepairType",repairId,repairTypeId:Number(next)})});const payload=await response.json() as {ok?:boolean;error?:string;warning?:string};if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair type could not be saved.");setMessage(payload.warning||"Repair type saved.");await load();window.dispatchEvent(new Event("shop-jobs-refresh"))}catch(error){setMessage(error instanceof Error?error.message:"Repair type could not be saved.");await load().catch(()=>undefined)}finally{setBusy(false)}
  }

  if(!data&&!message)return null;
  if(data?.dedicatedType)return <section style={box}><span style={eyebrow}>REPAIR TYPE</span><strong style={name}>{data.dedicatedType}</strong><span style={help}>This type comes from the dedicated {data.dedicatedType} workflow.</span></section>;
  const choices=(data?.types??[]).filter(type=>equipmentId!==null||type.unitRule==="optional");
  const selected=data?.repairType??null;
  return <section style={{...box,borderColor:selected?"#b9c8d5":"#f0a14a",background:selected?"#fff":"#fff8ef"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <div><span style={eyebrow}>REPAIR TYPE</span><strong style={name}>{selected?.name||"CHOOSE REPAIR TYPE"}</strong><span style={help}>{selected?"Used for work-order review and reporting.":"Choose the system you are working on so this repair reports correctly."}</span></div>
      {data?.canEdit&&<select disabled={busy} value={value} onChange={event=>void save(event.target.value)} style={select}><option value="">Choose repair type…</option>{choices.map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select>}
    </div>
    {selected?.checklistMode==="required"&&!selected.checklistConfigured&&<div style={warning}>This type requires a checklist, but its checklist has not been published yet. A manager needs to build it in Setup → Repair Types.</div>}
    {message&&<div style={{marginTop:7,fontSize:11,fontWeight:800,color:message.includes("saved")?"#176440":"#8a5200"}}>{message}</div>}
  </section>;
}

const box={padding:"13px 14px",border:"1px solid #b9c8d5",borderRadius:13,background:"white",display:"grid",gap:5} as const;
const eyebrow={display:"block",fontSize:10,fontWeight:950,letterSpacing:".1em",color:"#6a7883"} as const;
const name={display:"block",fontSize:17,color:"#102a43",marginTop:3} as const;
const help={display:"block",fontSize:11,color:"#6b7883",marginTop:3} as const;
const select={minWidth:260,maxWidth:"100%",border:"1px solid #b8c6d2",borderRadius:9,padding:"10px 11px",background:"white",color:"#182331",fontWeight:850} as const;
const warning={marginTop:7,padding:"8px 9px",borderRadius:8,background:"#fff2df",border:"1px solid #edbe77",fontSize:11,fontWeight:850,color:"#7a4c00"} as const;
