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
  confirmationPhrase:string;
  canExecute:boolean;
  blockers:{
    inventoryLinkedSandboxRows:number;
    alreadyCompleted:boolean;
    detail:{
      total:number;
      operationHeaders:number;
      operationLines:number;
      lifecycleEvents:number;
      coreObligations:number;
      recoveredTireSources:number;
      recoveredTireDispositions:number;
    };
  };
  plan:string[];
};

const panel={background:"white",border:"1px solid #d7ded9",borderRadius:14,padding:18} as const;
const number=(value:number)=>Number(value||0).toLocaleString();

function Metric({label,value,note}:{label:string;value:string|number;note?:string}){
  return <div style={{...panel,minWidth:190,flex:"1 1 190px"}}>
    <div style={{fontSize:12,fontWeight:900,letterSpacing:.5,color:"#68746f",textTransform:"uppercase"}}>{label}</div>
    <div style={{fontSize:30,fontWeight:950,marginTop:5}}>{typeof value==="number"?number(value):value}</div>
    {note&&<div style={{fontSize:12,color:"#68746f",marginTop:5,lineHeight:1.4}}>{note}</div>}
  </div>;
}

export default function Page(){
  const [data,setData]=useState<Preview|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [confirmation,setConfirmation]=useState("");

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

  async function runCutover(){
    if(!data?.canExecute||confirmation!==data.confirmationPhrase)return;
    const finalOkay=window.confirm("FINAL WARNING: This will permanently clear sandbox/test shop repairs and local DVIR staging rows. Breakdowns, active equipment master records, maintenance history, and inventory are protected. Continue?");
    if(!finalOkay)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/admin/go-live-cutover",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({confirmation}),
      });
      const payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Cutover could not be completed.");
      setMessage(`GO-LIVE CUTOVER COMPLETED at ${payload.completedAt}. Inventory, Breakdowns, and active equipment passed protection checks.`);
      setConfirmation("");
      await load();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Cutover could not be completed.");
    }finally{setBusy(false)}
  }

  return <main style={{minHeight:"100vh",background:"#f4f6f4",color:"#1b2421",padding:"34px 34px 110px"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:20,flexWrap:"wrap"}}>
      <div>
        <p style={{margin:0,color:"#b45309",fontWeight:950,fontSize:12,letterSpacing:.7}}>ADMIN · GO-LIVE PREPARATION</p>
        <h1 style={{margin:"6px 0 6px"}}>Go-Live Cutover Center</h1>
        <p style={{margin:0,maxWidth:900,lineHeight:1.55,color:"#475569"}}>Review the production cutover before launch, then run the one-time sandbox reset when ready. The action is administrator-only and protected by inventory, Breakdown, and active-equipment checks.</p>
      </div>
      <button onClick={()=>void load()} disabled={busy} style={{padding:"10px 15px",border:0,borderRadius:9,background:"#1b2421",color:"white",fontWeight:900,cursor:"pointer",opacity:busy?.6:1}}>{busy?"Checking…":"Refresh Preview"}</button>
    </header>

    <section style={{...panel,marginTop:18,borderColor:data?.goLiveCompletedAt?"#86b99b":"#f59e0b",background:data?.goLiveCompletedAt?"#f2fbf5":"#fffbeb"}}>
      <div style={{fontWeight:950,color:data?.goLiveCompletedAt?"#176440":"#92400e"}}>{data?.goLiveCompletedAt?"CUTOVER COMPLETED":"CUTOVER ARMED — ADMIN ONLY"}</div>
      <p style={{margin:"6px 0 0",lineHeight:1.5}}>{data?.goLiveCompletedAt
        ?`The one-time shop cutover completed at ${data.goLiveCompletedAt}. It cannot be run again.`
        :"The one-time reset can now be run after review. Breakdown repairs and Breakdown records are excluded from deletion. Active equipment/master identities remain intact. Inventory quantities, stock rows, operation counts, and inventory repair links are protected and verified."}</p>
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

      {!data.goLiveCompletedAt&&<section style={{...panel,marginTop:18,border:"2px solid #b45309",background:"#fffaf0"}}>
        <h2 style={{marginTop:0,color:"#92400e"}}>Run one-time production cutover</h2>
        <p style={{lineHeight:1.5,marginBottom:10}}>This permanently removes sandbox/test non-Breakdown shop repairs, clears local DVIR staging, and resets OOS flags only where there is no active Breakdown.</p>
        <div style={{display:"grid",gap:6,fontSize:13,marginBottom:14}}>
          <div>✅ <b>Breakdowns protected:</b> {number(data.protected.breakdownRows)} Breakdown record(s) and {number(data.protected.breakdownRepairRows)} Breakdown repair(s).</div>
          <div>✅ <b>Active equipment protected:</b> {number(data.protected.equipmentRows)} active master equipment record(s); no equipment is deleted.</div>
          <div>✅ <b>Inventory protected:</b> {number(data.protected.inventoryParts)} parts · {number(data.protected.inventoryStockRows)} stock rows · {number(data.protected.inventoryQuantity)} total on-hand · {number(data.protected.inventoryOperations)} operations.</div>
        </div>
        {data.blockers.inventoryLinkedSandboxRows>0&&<div style={{padding:12,border:"1px solid #ef4444",background:"#fff1f2",color:"#991b1b",fontWeight:800,marginBottom:12}}>
          CUTOVER BLOCKED: {number(data.blockers.inventoryLinkedSandboxRows)} sandbox repair link(s) are part of inventory audit history. These must be resolved before the cutover can run so inventory history is not altered.
        </div>}
        <label style={{display:"grid",gap:6,maxWidth:420,fontWeight:850}}>
          Type <code>{data.confirmationPhrase}</code> to unlock the cutover
          <input value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off" spellCheck={false}
            style={{padding:11,border:"1px solid #c5cdd2",borderRadius:8,fontSize:15,fontWeight:850}}/>
        </label>
        <button type="button" onClick={()=>void runCutover()}
          disabled={busy||!data.canExecute||confirmation!==data.confirmationPhrase}
          style={{marginTop:12,padding:"12px 18px",border:0,borderRadius:9,background:"#b42318",color:"white",fontWeight:950,cursor:"pointer",opacity:(busy||!data.canExecute||confirmation!==data.confirmationPhrase)?.45:1}}>
          {busy?"Running Cutover…":"RUN GO-LIVE CUTOVER"}
        </button>
      </section>}

      <section style={{...panel,marginTop:18}}>
        <h2 style={{marginTop:0}}>Planned launch sequence</h2>
        <ol style={{margin:"8px 0 0",paddingLeft:23,lineHeight:1.75}}>{data.plan.map((step,index)=><li key={index}>{step}</li>)}</ol>
      </section>

      <section style={{...panel,marginTop:18,borderColor:"#cbd5e1"}}>
        <h2 style={{marginTop:0}}>DVIR cutover</h2>
        <p style={{marginBottom:6}}>Current saved cutoff: <b>{data.dvirCutoffAt||"Not set — normal 24-hour Geotab lookback is still active"}</b></p>
        <p style={{margin:0,color:"#68746f"}}>On the real cutover, we will save the go-live timestamp first, clear the local DVIR staging rows, and Geotab will only be queried from the later of that cutoff or the normal 24-hour lookback.</p>
      </section>
    </>}
  </main>;
}
