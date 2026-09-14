"use client";

import { useEffect, useState } from "react";

type Preview = {
  mode:string;
  destructiveActionsEnabled:boolean;
  goLiveCompletedAt:string;
  dvirCutoffAt:string;
  willClear:{
    repairs:number;
    openRepairs:number;
    completedRepairs:number;
    laborEntries:number;
    activeLaborTimers:number;
    repairPartLines:number;
    dvirDefects:number;
    unrepairedDvirDefects:number;
    oosUnitsWithoutActiveBreakdown:number;
  };
  protected:{
    breakdownRepairRows:number;
    breakdownRows:number;
    activeBreakdowns:number;
    historicalRos:number;
    equipmentRows:number;
    maintenanceEvents:number;
    inventoryParts:number;
    inventoryStockRows:number;
    inventoryQuantity:number;
    inventoryOperations:number;
  };
  historyImport:null|{
    status:string;
    sourceName:string;
    sourceRoCount:number;
    importedRoCount:number;
    unmatchedRoCount:number;
    completedAt:string;
  };
  plan:string[];
};

const panel={background:"white",border:"1px solid #dce2e7",borderRadius:14,padding:18} as const;
const number=(value:number)=>Number(value||0).toLocaleString();

function Metric({label,value,note}:{label:string;value:string|number;note?:string}){
  return <div style={{...panel,minWidth:190,flex:"1 1 190px"}}>
    <div style={{fontSize:12,fontWeight:900,letterSpacing:.5,color:"#64748b",textTransform:"uppercase"}}>{label}</div>
    <div style={{fontSize:30,fontWeight:950,marginTop:5}}>{typeof value==="number"?number(value):value}</div>
    {note&&<div style={{fontSize:12,color:"#64748b",marginTop:5,lineHeight:1.4}}>{note}</div>}
  </div>;
}

export default function Page(){
  const [data,setData]=useState<Preview|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  async function load(){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/admin/go-live-cutover",{cache:"no-store"});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Could not load cutover preview.");
      setData(payload);
    }catch(error){
      setMessage(error instanceof Error?error.message:"Could not load cutover preview.");
    }finally{setBusy(false)}
  }

  useEffect(()=>{void load()},[]);

  return <main style={{minHeight:"100vh",background:"#f3f5f7",color:"#172033",padding:"34px 34px 110px"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:20,flexWrap:"wrap"}}>
      <div>
        <p style={{margin:0,color:"#b45309",fontWeight:950,fontSize:12,letterSpacing:.7}}>ADMIN · GO-LIVE PREPARATION</p>
        <h1 style={{margin:"6px 0 6px"}}>Go-Live Cutover Center</h1>
        <p style={{margin:0,maxWidth:900,lineHeight:1.55,color:"#475569"}}>Dry-run the production cutover before launch day. This screen reads the current database and shows exactly what the future shop reset would clear and what must remain protected.</p>
      </div>
      <button onClick={()=>void load()} disabled={busy} style={{padding:"10px 15px",border:0,borderRadius:9,background:"#172033",color:"white",fontWeight:900,cursor:"pointer",opacity:busy?.6:1}}>{busy?"Checking…":"Refresh Dry Run"}</button>
    </header>

    <section style={{...panel,marginTop:18,borderColor:"#f59e0b",background:"#fffbeb"}}>
      <div style={{fontWeight:950,color:"#92400e"}}>DRY RUN ONLY — NOTHING ON THIS SCREEN CAN DELETE DATA</div>
      <p style={{margin:"6px 0 0",lineHeight:1.5}}>The actual one-time reset is intentionally disabled while we are testing the plan. Breakdowns remain live and protected. Inventory is also not altered by the Repair Board reset; the final EMDECS inventory snapshot will be handled separately.</p>
    </section>

    {message&&<section style={{...panel,marginTop:18,borderColor:"#ef4444",color:"#991b1b"}}><b>{message}</b></section>}

    {data&&<>
      <section style={{marginTop:24}}>
        <h2 style={{marginBottom:10}}>Would be cleared on go-live</h2>
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          <Metric label="Sandbox Repairs" value={data.willClear.repairs} note={`${number(data.willClear.openRepairs)} open · ${number(data.willClear.completedRepairs)} completed/test`} />
          <Metric label="Labor Entries" value={data.willClear.laborEntries} note={`${number(data.willClear.activeLaborTimers)} active timer(s) right now`} />
          <Metric label="Repair Part Lines" value={data.willClear.repairPartLines} note="Links to sandbox shop repairs; inventory opening balance is separate." />
          <Metric label="DVIR Rows" value={data.willClear.dvirDefects} note={`${number(data.willClear.unrepairedDvirDefects)} currently unrepaired`} />
          <Metric label="OOS Flags" value={data.willClear.oosUnitsWithoutActiveBreakdown} note="Only units with no active live Breakdown would be reset." />
        </div>
      </section>

      <section style={{marginTop:28}}>
        <h2 style={{marginBottom:10}}>Protected — must survive cutover</h2>
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          <Metric label="Breakdown Repairs" value={data.protected.breakdownRepairRows} note={`${number(data.protected.activeBreakdowns)} active · ${number(data.protected.breakdownRows)} total Breakdown records`} />
          <Metric label="Historical ROs" value={data.protected.historicalRos} note="EMDECS/Norlow historical repair records are separate from the sandbox Repair Board." />
          <Metric label="Active Equipment" value={data.protected.equipmentRows} note="Master Equipment and Geotab identity stay intact." />
          <Metric label="PM / Annual Events" value={data.protected.maintenanceEvents} note="Maintenance history and setup stay intact." />
          <Metric label="Inventory Parts" value={data.protected.inventoryParts} note={`${number(data.protected.inventoryStockRows)} warehouse stock rows`} />
          <Metric label="Current Stock Qty" value={data.protected.inventoryQuantity} note={`${number(data.protected.inventoryOperations)} inventory operation(s) currently recorded`} />
        </div>
      </section>

      <section style={{...panel,marginTop:28}}>
        <h2 style={{marginTop:0}}>EMDECS work-history readiness</h2>
        {data.historyImport?<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          <div><b>Status</b><div>{data.historyImport.status||"—"}</div></div>
          <div><b>Last source</b><div>{data.historyImport.sourceName||"—"}</div></div>
          <div><b>Source ROs</b><div>{number(data.historyImport.sourceRoCount)}</div></div>
          <div><b>Imported ROs</b><div>{number(data.historyImport.importedRoCount)}</div></div>
          <div><b>Unmatched ROs</b><div>{number(data.historyImport.unmatchedRoCount)}</div></div>
          <div><b>Completed</b><div>{data.historyImport.completedAt||"—"}</div></div>
        </div>:<p>No cumulative historical repair import is registered yet.</p>}
      </section>

      <section style={{...panel,marginTop:18}}>
        <h2 style={{marginTop:0}}>Planned launch sequence</h2>
        <ol style={{margin:"8px 0 0",paddingLeft:23,lineHeight:1.75}}>{data.plan.map((step,index)=><li key={index}>{step}</li>)}</ol>
      </section>

      <section style={{...panel,marginTop:18,borderColor:"#cbd5e1"}}>
        <h2 style={{marginTop:0}}>DVIR cutover</h2>
        <p style={{marginBottom:6}}>Current saved cutoff: <b>{data.dvirCutoffAt||"Not set — normal 24-hour Geotab lookback is still active"}</b></p>
        <p style={{margin:0,color:"#64748b"}}>On the real cutover, we will save the go-live timestamp first, clear the local DVIR staging rows, and Geotab will only be queried from the later of that cutoff or the normal 24-hour lookback.</p>
      </section>
    </>}
  </main>;
}
