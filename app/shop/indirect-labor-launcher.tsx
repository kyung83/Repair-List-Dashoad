"use client";

import {useEffect,useState} from "react";

type ShopState={activeTimer:{repairId:string}|null;user:{technicianId:number|null;role:string}};

export default function IndirectLaborLauncher(){
  const[visible,setVisible]=useState(false),[open,setOpen]=useState(false),[description,setDescription]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");

  async function refresh(){
    try{const response=await fetch("/api/shop",{cache:"no-store"});if(!response.ok)return;const data=await response.json() as ShopState;setVisible(Boolean(data.user?.technicianId&&!data.activeTimer));if(data.activeTimer)setOpen(false)}catch{}
  }
  useEffect(()=>{void refresh();const update=()=>void refresh();window.addEventListener("shop-jobs-refresh",update);const id=window.setInterval(update,15000);return()=>{window.removeEventListener("shop-jobs-refresh",update);window.clearInterval(id)}},[]);

  async function start(){
    const task=description.trim();if(!task){setMessage("Enter what you are doing.");return}
    setBusy(true);setMessage("");
    try{
      const createdResponse=await fetch("/api/shop/found-repair",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"startIndirectLabor",description:task})});
      const created=await createdResponse.json() as{ok?:boolean;repairId?:string;error?:string};
      if(!createdResponse.ok||!created.ok||!created.repairId)throw new Error(created.error||"Indirect labor work order could not be created.");
      const startResponse=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"startUnit",repairId:created.repairId})});
      const started=await startResponse.json() as{ok?:boolean;error?:string};
      if(!startResponse.ok||!started.ok)throw new Error(started.error||"Indirect labor was created but the timer could not start.");
      setDescription("");setOpen(false);setVisible(false);window.dispatchEvent(new Event("shop-jobs-refresh"));
    }catch(error){setMessage(error instanceof Error?error.message:"Indirect labor could not be started.")}
    finally{setBusy(false)}
  }

  if(!visible)return null;
  return <aside style={wrap}>
    {!open?<button type="button" onClick={()=>{setOpen(true);setMessage("")}} style={launch}>+ START INDIRECT LABOR</button>:<div style={panel}>
      <div><strong style={{fontSize:16,color:"#17324a"}}>INDIRECT LABOR-OTHER</strong><div style={help}>No truck or trailer required. Your labor timer will track this as SHOP / NO UNIT.</div></div>
      <input autoFocus value={description} onChange={event=>setDescription(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void start()}} placeholder="Shop cleanup, parts run, training, inventory…" style={input} disabled={busy}/>
      <div style={{display:"flex",gap:7}}><button type="button" disabled={busy} onClick={()=>{setOpen(false);setDescription("");setMessage("")}} style={cancel}>CANCEL</button><button type="button" disabled={busy} onClick={()=>void start()} style={startButton}>{busy?"STARTING…":"START WORK"}</button></div>
      {message&&<div style={notice}>{message}</div>}
    </div>}
  </aside>;
}

const wrap={position:"fixed" as const,right:22,bottom:24,zIndex:50,maxWidth:"min(430px,calc(100vw - 24px))"} as const;
const launch={border:0,borderRadius:999,padding:"14px 18px",background:"#6d28d9",color:"white",fontWeight:950,boxShadow:"0 8px 25px #32105e55",cursor:"pointer"} as const;
const panel={width:390,maxWidth:"calc(100vw - 28px)",boxSizing:"border-box" as const,padding:14,border:"1px solid #c9bae8",borderRadius:14,background:"white",boxShadow:"0 14px 36px #17203333",display:"grid",gap:10} as const;
const help={marginTop:4,fontSize:11,color:"#6b7883",lineHeight:1.4} as const;
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c7d2dc",borderRadius:9,padding:"11px 12px",fontSize:13} as const;
const cancel={border:"1px solid #cbd5df",borderRadius:8,padding:"9px 11px",background:"white",fontWeight:850,cursor:"pointer"} as const;
const startButton={border:0,borderRadius:8,padding:"9px 11px",background:"#6d28d9",color:"white",fontWeight:950,cursor:"pointer"} as const;
const notice={padding:"8px 9px",border:"1px solid #f2c66d",borderRadius:8,background:"#fff8e6",fontSize:11,fontWeight:800} as const;
