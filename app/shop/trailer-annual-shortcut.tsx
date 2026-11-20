"use client";
import {useEffect,useState} from "react";
import MaintenanceChecklistPanelV2 from "./maintenance-checklist-panel-v2";
type Summary={
  ok?:boolean;error?:string;unit:string;pmRepairId:string;annualRepairId:string|null;
  pmStarted:boolean;pmStatus:string;pmCompleted:boolean;annualEnabled:boolean;
  lastAnnualDate:string|null;nextAnnualDue:string|null;daysRemaining:number|null;annualIntervalDays:number;
  reusablePmAnswers:number;verifiedMappingCount:number;
};
type Props={pmRepairId:string;canWork:boolean;active?:boolean};
function dateLabel(value:string|null){if(!value)return "Not recorded";const d=new Date(value+"T12:00:00Z");return Number.isNaN(+d)?"Not recorded":d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}
export default function TrailerAnnualShortcut({pmRepairId,canWork,active=true}:Props){
  const[info,setInfo]=useState<Summary|null>(null),[annualId,setAnnualId]=useState<string|null>(null);
  const[opened,setOpened]=useState(false),[busy,setBusy]=useState(false);
  const[annualStatus,setAnnualStatus]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  useEffect(()=>{setInfo(null);setAnnualId(null);setOpened(false);setMessage("");setError("");setAnnualStatus("")},[pmRepairId]);
  async function refresh(){
    const r=await fetch("/api/shop/trailer-annual-shortcut?pmRepairId="+encodeURIComponent(pmRepairId),{cache:"no-store"});
    const p=await r.json() as Summary;
    if(!r.ok||!p.ok)throw new Error(p.error||"Annual details could not be loaded.");
    setInfo(p);return p;
  }
  useEffect(()=>{
    if(!active)return;
    let live=true;
    void refresh().catch(()=>{if(live)setInfo(null)});
    return()=>{live=false};
  },[pmRepairId,active]);
  useEffect(()=>{
    if(!opened||!annualId||!active)return;
    let live=true;
    async function load(){
      try{
        const r=await fetch("/api/maintenance-checklist?repairId="+encodeURIComponent(annualId!),{cache:"no-store"});
        if(!r.ok)return;
        const p=await r.json() as {status?:string};
        if(live)setAnnualStatus(p.status||"");
      }catch{}
    }
    void load();
    const id=window.setInterval(()=>void load(),4500);
    return()=>{live=false;window.clearInterval(id)};
  },[opened,annualId,active]);
  async function request(action:"start"|"complete",id?:string){
    const r=await fetch("/api/shop/trailer-annual-shortcut",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action,pmRepairId,annualRepairId:id})
    });
    const p=await r.json() as {ok?:boolean;error?:string;annualRepairId?:string;completed?:boolean};
    if(!r.ok||!p.ok)throw new Error(p.error||"Annual shortcut failed.");
    return p;
  }
  async function openAnnual(){
    setBusy(true);setError("");setMessage("");
    try{
      const start=await request("start"),id=start.annualRepairId;
      if(!id)throw new Error("The Annual work order could not be loaded.");
      const init=await fetch("/api/maintenance-checklist",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"startChecklist",repairId:id})});
      const ip=await init.json() as {ok?:boolean;error?:string};
      if(!init.ok||!ip.ok)throw new Error(ip.error||"The Annual inspection could not be started.");
      let reused=0;
      let reuseNotice='';
      try{
        const response=await fetch("/api/shop/trailer-annual-shortcut",{method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({action:"reuse",pmRepairId,annualRepairId:id})});
        const p=await response.json() as {ok?:boolean;error?:string;reused?:number};
        if(response.ok&&p.ok)reused=Number(p.reused||0);
        else reuseNotice="The Annual is open. Its shared questions need individual inspection: "+(p.error||"reuse was unavailable.");
      }catch{reuseNotice="The separate Annual is open. Shared items were not automatically filled; inspect them normally."}
      setAnnualId(id);setOpened(true);setAnnualStatus("in_progress");
      setMessage(reuseNotice||(
        reused>0?`${reused} verified PM checks carried into the separate Annual. Answer the remaining Annual questions and sign.`:
        "The separate Annual is open. Answer its required questions and sign."
      ));
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Unable to open the Annual.")}finally{setBusy(false)}
  }
  async function finishAnnual(){
    if(!annualId)return;
    setBusy(true);setError("");setMessage("");
    try{
      await request("complete",annualId);
      setAnnualStatus("completed");setOpened(false);
      setMessage("Annual completed and recorded separately. The PM and its labor were not changed.");
      await refresh();
      window.dispatchEvent(new Event("shop-jobs-refresh"));
    }catch(e){setError(e instanceof Error?e.message:"Annual could not be completed.")}finally{setBusy(false)}
  }
  if(!info)return null; // The shortcut is never shown on non-trailer PM repairs.
  const due=info.daysRemaining;
  return <section data-trailer-annual-shortcut style={{border:"1px solid #bfd0dc",borderRadius:12,background:"#f8fbfd",padding:14,marginTop:14,display:"grid",gap:9}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <strong style={{fontSize:16,color:"#143653"}}>TRAILER ANNUAL INSPECTION</strong>
      {due!==null&&<span style={{fontSize:12,fontWeight:850,color:due<=60?"#ad541c":"#526272"}}>{due<0?`Overdue by ${-due} days`:due===0?"Due today":`Due in ${due} days`}</span>}
    </div>
    <div style={{fontSize:13,color:"#465767",lineHeight:1.5}}>
      Last Annual: <b>{dateLabel(info.lastAnnualDate)}</b> · Next due: <b>{dateLabel(info.nextAnnualDue)}</b>
    </div>
    <div style={{fontSize:12,color:"#536878"}}>
      Your PM remains its own work order. Use this optional button to complete the separate Annual on the same visit without repeating verified matching checks.
      Similar but different Annual safety questions still require an inspection. The Annual needs its own signature.
    </div>
    {!info.annualEnabled&&<div role="alert" style={{color:"#9b4b17",fontWeight:800}}>Annual schedule is disabled for this trailer. Contact management.</div>}
    {!info.pmStarted&&<div style={{fontSize:12,color:"#794f22"}}>Start the normal Trailer PM checklist first.</div>}
    {info.pmStarted&&<div style={{fontSize:12,color:"#495d72"}}>Currently verified matching PM checks: <b>{info.reusablePmAnswers}</b>. Annual has 40 questions; the rest must be inspected.</div>}
    {error&&<div role="alert" style={{color:"#ad2929",fontSize:13,fontWeight:700}}>{error}</div>}
    {message&&<div role="status" style={{color:"#246142",fontSize:13}}>{message}</div>}
    {!opened&&canWork&&!info.pmCompleted&&info.annualEnabled&&<button type="button" disabled={busy||!info.pmStarted}
      onClick={()=>void openAnnual()} style={{background:"#176fe6",color:"#fff",border:0,borderRadius:9,padding:"12px 16px",fontWeight:900,fontSize:13,cursor:busy?"wait":"pointer"}}>
      {busy?"OPENING ANNUAL…":"FINISH REMAINING ANNUAL QUESTIONS"}
    </button>}
    {opened&&annualId&&<>
      <div style={{background:"#fff",border:"1px solid #d4e2ed",borderRadius:10,padding:10,fontSize:13}}>
        <b>SEPARATE ANNUAL FORM</b> — {annualId}. Answer remaining questions; carried PM results stay visible in Review All Answers for verification.
      </div>
      <MaintenanceChecklistPanelV2 repairId={annualId} canWork={canWork} pendingOnly/>
      {annualStatus==="ready"&&<button type="button" disabled={busy||!canWork} onClick={()=>void finishAnnual()}
        style={{border:0,background:"#146c48",color:"#fff",borderRadius:9,padding:"13px",fontWeight:900}}>
        {busy?"RECORDING…":"FINISH SIGNED ANNUAL & UPDATE ANNUAL DATE"}
      </button>}
      <button type="button" onClick={()=>setOpened(false)} disabled={busy}
        style={{padding:9,border:"1px solid #bbc8d1",background:"#fff",borderRadius:8}}>Close Annual panel (keep progress saved)</button>
    </>}
  </section>;
}
