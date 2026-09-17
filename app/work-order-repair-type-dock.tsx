"use client";

import {useEffect,useMemo,useState} from "react";

type RepairType={id:number;name:string;unitRule:"required"|"optional"};
type Repair={id:string;issue:string;repairTypeId:number|null;repairType:string;repairTypeRequired:boolean;repairTypeEditable:boolean};
type ReviewPackage={id:string;unit:string;reviewed:boolean;repairs:Repair[]};
type Payload={reviewPackages:ReviewPackage[];repairTypes:RepairType[];canApprove:boolean;error?:string};

export default function WorkOrderRepairTypeDock(){
  const[active,setActive]=useState(false),[data,setData]=useState<Payload|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(""),[message,setMessage]=useState("");
  async function load(){if(window.location.pathname!=="/work-orders"){setActive(false);return}setActive(true);try{const response=await fetch("/api/work-orders",{cache:"no-store"});const payload=await response.json() as Payload;if(!response.ok)throw new Error(payload.error||"Work orders could not be loaded.");setData(payload)}catch(error){setMessage(error instanceof Error?error.message:"Work orders could not be loaded.")}}
  useEffect(()=>{void load();const id=window.setInterval(()=>void load(),20000);return()=>window.clearInterval(id)},[]);
  const repairs=useMemo(()=>{const rows:Array<Repair&{unit:string;packageId:string}>=[];for(const pkg of data?.reviewPackages??[]){if(pkg.reviewed)continue;for(const repair of pkg.repairs){if(repair.repairTypeRequired)rows.push({...repair,unit:pkg.unit||"SHOP / NO UNIT",packageId:pkg.id})}}return rows},[data]);
  const missing=repairs.filter(repair=>!repair.repairTypeId).length;
  if(!active||!data?.canApprove)return null;
  async function save(repair:Repair&{unit:string},repairTypeId:number){setBusy(repair.id);setMessage("");try{const response=await fetch("/api/work-orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"reviewUpdateRepairType",repairId:repair.id,repairTypeId})});const payload=await response.json() as{ok?:boolean;error?:string};if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair type could not be saved.");setMessage("Repair type updated for final review.");await load()}catch(error){setMessage(error instanceof Error?error.message:"Repair type could not be saved.")}finally{setBusy("")}}
  return <aside style={wrap}>
    {!open?<button type="button" onClick={()=>setOpen(true)} style={{...launch,background:missing?"#b45309":"#17324a"}}>REPAIR TYPES {missing?`· ${missing} NEED REVIEW`:"· REVIEW"}</button>:<div style={panel}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}><div><strong style={{fontSize:17,color:"#17324a"}}>Work Order Repair Types</strong><div style={help}>Correct the category here before approving completed work.</div></div><button type="button" onClick={()=>setOpen(false)} style={close}>×</button></div>
      {message&&<div style={notice}>{message}</div>}
      <div style={list}>{repairs.map(repair=><div key={repair.id} style={{padding:"9px 0",borderTop:"1px solid #edf1f4",display:"grid",gap:5}}><div style={{display:"flex",justifyContent:"space-between",gap:8}}><span style={{minWidth:0}}><strong>{repair.unit}</strong><small style={{display:"block",marginTop:2,color:"#6b7883"}}>{repair.id} · {repair.issue}</small></span>{!repair.repairTypeId&&<span style={required}>REQUIRED</span>}</div><select disabled={Boolean(busy)||!repair.repairTypeEditable&&Boolean(repair.repairTypeId)} value={repair.repairTypeId??""} onChange={event=>void save(repair,Number(event.target.value))} style={select}><option value="">Choose repair type…</option>{data.repairTypes.filter(type=>repair.unit!=="SHOP / NO UNIT"||type.unitRule==="optional").map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></div>)}{!repairs.length&&<div style={{padding:12,color:"#64748b",fontSize:12}}>No completed repairs currently need repair-type review.</div>}</div>
    </div>}
  </aside>;
}

const wrap={position:"fixed" as const,left:20,bottom:22,zIndex:55,maxWidth:"min(460px,calc(100vw - 24px))"} as const;
const launch={border:0,borderRadius:999,padding:"12px 16px",color:"white",fontWeight:950,boxShadow:"0 8px 25px #17203344",cursor:"pointer"} as const;
const panel={width:430,maxWidth:"calc(100vw - 28px)",maxHeight:"70vh",boxSizing:"border-box" as const,padding:14,border:"1px solid #cbd6df",borderRadius:14,background:"white",boxShadow:"0 14px 36px #17203333",display:"grid",gap:9} as const;
const help={marginTop:3,fontSize:11,color:"#6b7883"} as const;
const close={border:0,borderRadius:999,width:29,height:29,background:"#edf2f6",fontSize:20,cursor:"pointer"} as const;
const notice={padding:"8px 9px",border:"1px solid #f2c66d",borderRadius:8,background:"#fff8e6",fontSize:11,fontWeight:800} as const;
const list={overflowY:"auto" as const,maxHeight:"54vh"} as const;
const required={padding:"3px 6px",height:"fit-content",borderRadius:999,background:"#fff0df",color:"#9a5100",fontSize:9,fontWeight:950} as const;
const select={width:"100%",border:"1px solid #c7d2dc",borderRadius:8,padding:"8px 9px",background:"white",fontWeight:800,color:"#182331"} as const;
