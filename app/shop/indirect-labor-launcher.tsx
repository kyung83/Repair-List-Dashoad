"use client";

import {useEffect,useState} from "react";

const PRESETS=["Shop cleanup","Parts run","Training","Inventory","Meeting","Other"];
type ShopState={activeTimer:{repairId:string}|null;user:{technicianId:number|null;role:string};error?:string};

export default function IndirectLaborLauncher(){
 const[show,setShow]=useState(false),[active,setActive]=useState(false),[canUse,setCanUse]=useState(false),[preset,setPreset]=useState("Shop cleanup"),[other,setOther]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function refresh(){try{const response=await fetch("/api/shop",{cache:"no-store"});const payload=await response.json() as ShopState;if(response.ok){setActive(Boolean(payload.activeTimer));setCanUse(Boolean(payload.user?.technicianId)&&["mechanic","manager","admin"].includes(payload.user?.role||""));if(payload.activeTimer)setShow(false)}}catch{}}
 useEffect(()=>{void refresh();const handler=()=>void refresh();window.addEventListener("shop-jobs-refresh",handler);return()=>window.removeEventListener("shop-jobs-refresh",handler)},[]);
 async function start(){const activity=(preset==="Other"?other:preset).trim();if(!activity){setMessage("Enter what you are doing.");return}setBusy(true);setMessage("");try{const created=await fetch("/api/shop/indirect-labor",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({activity})});const result=await created.json() as{ok?:boolean;repairId?:string;error?:string};if(!created.ok||!result.ok||!result.repairId)throw new Error(result.error||"Indirect labor could not be created.");const started=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"startUnit",repairId:result.repairId})});const startResult=await started.json() as{ok?:boolean;error?:string};if(!started.ok||!startResult.ok)throw new Error(startResult.error||"The labor timer could not be started.");setShow(false);setOther("");setMessage("");window.dispatchEvent(new Event("shop-jobs-refresh"));await refresh()}catch(error){setMessage(error instanceof Error?error.message:"Indirect labor could not be started.")}finally{setBusy(false)}}
 if(!canUse||active)return null;
 return <section style={wrap}>
   {!show?<button type="button" style={launcher} onClick={()=>{setShow(true);setMessage("")}}><span style={plus}>+</span><span><strong>START INDIRECT LABOR</strong><small>Shop work · no truck or trailer required</small></span></button>:<div style={panel}><div style={head}><div><strong>INDIRECT LABOR-OTHER</strong><small>This time will be recorded to you, not to a unit.</small></div><button type="button" style={close} onClick={()=>setShow(false)} disabled={busy}>×</button></div><label style={label}>WHAT ARE YOU DOING?<select style={input} value={preset} onChange={event=>setPreset(event.target.value)} disabled={busy}>{PRESETS.map(value=><option key={value}>{value}</option>)}</select></label>{preset==="Other"&&<label style={label}>DESCRIPTION<input style={input} value={other} onChange={event=>setOther(event.target.value)} placeholder="What are you working on?" autoFocus disabled={busy}/></label>}{message&&<div style={notice}>{message}</div>}<div style={actions}><button type="button" style={cancel} onClick={()=>setShow(false)} disabled={busy}>CANCEL</button><button type="button" style={startButton} onClick={()=>void start()} disabled={busy}>{busy?"STARTING…":"START WORK"}</button></div></div>}
 </section>
}

const wrap={maxWidth:1100,margin:"18px auto -6px",padding:"0 clamp(12px,3vw,30px)"} as const;
const launcher={width:"100%",border:"2px solid #7a4b15",borderRadius:13,padding:"13px 15px",background:"#fff6e9",color:"#60370e",display:"flex",alignItems:"center",gap:12,textAlign:"left" as const,cursor:"pointer"} as const;
const plus={width:36,height:36,borderRadius:10,background:"#9a5a16",color:"white",display:"grid",placeItems:"center",fontSize:24,fontWeight:900} as const;
const panel={border:"2px solid #d09a5e",borderRadius:13,padding:14,background:"#fffaf3",display:"grid",gap:10} as const;
const head={display:"flex",justifyContent:"space-between",gap:12,alignItems:"start"} as const;
const close={border:0,background:"transparent",fontSize:24,cursor:"pointer",color:"#6c4a2a"} as const;
const label={display:"grid",gap:5,fontSize:10,fontWeight:950,color:"#6a563f",letterSpacing:".05em"} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #ccb99e",borderRadius:8,background:"white",fontSize:14} as const;
const notice={padding:9,borderRadius:8,background:"#fff0dc",fontSize:12,fontWeight:800,color:"#7b4510"} as const;
const actions={display:"flex",justifyContent:"flex-end",gap:8} as const;
const cancel={border:"1px solid #c8b79f",borderRadius:8,padding:"9px 11px",background:"white",fontWeight:850,cursor:"pointer"} as const;
const startButton={border:0,borderRadius:8,padding:"10px 14px",background:"#7a4b15",color:"white",fontWeight:950,cursor:"pointer"} as const;
