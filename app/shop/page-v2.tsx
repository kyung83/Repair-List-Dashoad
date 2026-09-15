"use client";

import {useEffect,useMemo,useState} from "react";
import CurrentWorkHome from "./current-work-home";

type User={id:number;username:string;displayName:string;role:"viewer"|"mechanic"|"manager"|"admin";technicianId:number|null;yard?:string};
type TechnicianOption={id:number;name:string};
type UsedPart={partId:number;partNumber:string;description:string;quantity:number};
type PlannedPart={id:number;partId:number;partNumber:string;description:string;quantity:number;usedQuantity:number;kitName:string};
type LaborEntry={id:number;technician:string;laborDate:string;hours:number;rate:number;notes:string};
type Repair={id:string;equipmentId:number|null;unit:string;issue:string;status:string;location:string;technicianId:number|null;assignedTo:string;laborHours:number;plannedParts:PlannedPart[];usedParts:UsedPart[];laborEntries:LaborEntry[];yard?:string;handoffNote?:string};
type Part={id:number;partNumber:string;description:string;quantityOnHand:number};
type PartRequest={id:number;repairId:string;repairNumericId:number;partId:number;partNumber:string;description:string;warehouseCode:string;warehouseName:string;unit:string;technicianId:number|null;assignedTo:string;priority:string;outOfService:boolean;requestedQuantity:number;reservedQuantity:number;usedQuantity:number;remainingQuantity:number;shortageQuantity:number;state:string;createdAt:string;updatedAt:string};
type Timer={repairId:string;startedAt:string;title:string;unit:string};
type ShopData={user:User;activeTimer:Timer|null;repairs:Repair[];parts:Part[];technicians?:TechnicianOption[];partRequests?:PartRequest[];updatedAt:string};
type View="mine"|"available"|"all";
type ActionResult={ok?:boolean;error?:string;repairId?:string;hours?:number;laborStarted?:boolean;completed?:boolean;nextRepairId?:string|null;waitingOnPart?:boolean;unitDone?:boolean;partAvailable?:boolean;switched?:boolean;handoff?:boolean;handedOffCount?:number;handoffTarget?:string;awaitingParts?:boolean;partNumber?:string;quantity?:number;warehouseCode?:string};
type UnitGroup={key:string;unit:string;equipmentId:number|null;repairs:Repair[]};

function keyFor(repair:Repair){return repair.equipmentId!=null?`equipment-${repair.equipmentId}`:`unit-${repair.unit.trim().toLowerCase()||repair.id}`}
function sameUnit(a:Repair,b:Repair){return keyFor(a)===keyFor(b)}
function groupByUnit(repairs:Repair[]){const groups=new Map<string,UnitGroup>();for(const repair of repairs){const key=keyFor(repair),current=groups.get(key);if(current)current.repairs.push(repair);else groups.set(key,{key,unit:repair.unit,equipmentId:repair.equipmentId,repairs:[repair]})}return [...groups.values()]}
function numberText(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}

export default function ShopPage(){
  const[data,setData]=useState<ShopData|null>(null);
  const[view,setView]=useState<View>("mine");
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  const[now,setNow]=useState(Date.now());
  const[handoffOpen,setHandoffOpen]=useState(false);
  const[handoffTechId,setHandoffTechId]=useState("");
  const[handoffNote,setHandoffNote]=useState("");

  async function load(){
    const response=await fetch("/api/shop",{cache:"no-store"});
    const payload=await response.json() as ShopData&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Shop jobs could not be loaded.");
    setData(payload);
    if(!payload.activeTimer)setHandoffOpen(false);
    if((payload.user.role==="manager"||payload.user.role==="admin")&&!payload.user.technicianId)setView("all");
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Shop jobs could not be loaded."));const id=window.setInterval(()=>void load().catch(()=>undefined),30000);return()=>window.clearInterval(id)},[]);
  useEffect(()=>{const refresh=()=>void load().catch(()=>undefined);window.addEventListener("shop-jobs-refresh",refresh);return()=>window.removeEventListener("shop-jobs-refresh",refresh)},[]);
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id)},[]);

  async function action(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as ActionResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Shop action failed.");
      if(result.handoff)setMessage(`Shift handoff saved. ${result.handedOffCount||1} open repair${result.handedOffCount===1?"":"s"} moved to ${result.handoffTarget||"the next shift"}. Your labor was saved and all recorded work stayed with the repair.`);
      else if(result.unitDone)setMessage(typeof result.hours==="number"?`Done working. ${result.hours.toFixed(2)} hours were saved.`:"Done working. Open repairs remain open.");
      else if(result.completed)setMessage(result.nextRepairId?"Repair completed. Labor moved to the next repair.":"Repair completed.");
      else if(result.switched)setMessage("Labor saved to the previous repair and started on this repair.");
      else if(result.laborStarted)setMessage("Unit workspace opened. Labor started automatically.");
      await load();
      return result;
    }catch(error){setMessage(error instanceof Error?error.message:"Shop action failed.");return null}finally{setBusy(false)}
  }

  async function startRepair(repair:Repair){await action({action:"startUnit",repairId:repair.id})}
  async function chooseRepair(repair:Repair){
    if(!data?.activeTimer)return;
    const active=data.repairs.find(item=>item.id===data.activeTimer?.repairId);
    if(!active||!sameUnit(active,repair)){setMessage("Finish the current unit before moving to another unit.");return}
    if(repair.id!==active.id)await action({action:"switchRepair",repairId:repair.id});
  }
  async function repaired(repair:Repair){await action({action:"repairOutcome",repairId:repair.id,outcome:"repaired"})}
  async function doneForNow(){const result=await action({action:"doneUnit"});if(result){setHandoffOpen(false);setHandoffNote("");setHandoffTechId("")}}
  async function handoff(){
    const note=handoffNote.trim();
    if(!note){setMessage("Enter what is left to do for the next shift.");window.requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="Shift handoff note"]')?.focus());return}
    const result=await action({action:"doneUnit",handoff:true,targetTechnicianId:handoffTechId?Number(handoffTechId):null,handoffNote:note});
    if(result){setHandoffOpen(false);setHandoffNote("");setHandoffTechId("")}
  }
  async function usePlannedPart(repair:Repair,planned:PlannedPart){const remaining=Math.max(0,planned.quantity-planned.usedQuantity);if(remaining<=0)return;const result=await action({action:"usePart",repairId:repair.id,partId:planned.partId,quantity:remaining});if(result)setMessage(result.awaitingParts?`${planned.partNumber}: Parts Desk updated automatically.`:`${numberText(result.quantity||remaining)} × ${planned.partNumber} applied${result.warehouseCode?` from ${result.warehouseCode}`:""}.`)}
  async function useReserved(request:PartRequest){const result=await action({action:"useReservedPart",requestId:request.id,quantity:request.reservedQuantity});if(result)setMessage(`${numberText(result.quantity||request.reservedQuantity)} × ${request.partNumber} used from reserved stock.`)}

  const activeRepair=useMemo(()=>data?.repairs.find(repair=>repair.id===data.activeTimer?.repairId)??null,[data]);
  const activeUnitRepairs=useMemo(()=>activeRepair&&data?data.repairs.filter(repair=>sameUnit(repair,activeRepair)):[],[data,activeRepair]);
  const activeRequests=useMemo(()=>activeRepair?(data?.partRequests??[]).filter(request=>request.repairId===activeRepair.id):[],[data,activeRepair]);
  const mine=useMemo(()=>data?.user.technicianId?data.repairs.filter(repair=>repair.technicianId===data.user.technicianId):[],[data]);
  const available=useMemo(()=>data?.repairs.filter(repair=>repair.technicianId===null)??[],[data]);
  const visible=useMemo(()=>!data?[]:view==="mine"?mine:view==="available"?available:data.repairs,[data,view,mine,available]);
  const groups=useMemo(()=>groupByUnit(visible),[visible]);
  const mineGroups=useMemo(()=>groupByUnit(mine),[mine]);
  const availableGroups=useMemo(()=>groupByUnit(available),[available]);
  const allGroups=useMemo(()=>groupByUnit(data?.repairs??[]),[data]);
  const techOptions=useMemo(()=>(data?.technicians??[]).filter(tech=>tech.id!==data?.user.technicianId),[data]);

  if(data?.activeTimer&&activeRepair){
    const handoffPanel=handoffOpen?<section style={handoffPanelStyle}>
      <div><strong style={{fontSize:16,color:"#17324a"}}>Done working on this unit</strong><div style={helper}>Keep it assigned to yourself, or hand the unfinished work to the next shift.</div></div>
      <button type="button" disabled={busy} onClick={()=>void doneForNow()} style={keepButton}>DONE FOR NOW — KEEP ASSIGNED TO ME</button>
      <div style={orLine}>OR HAND OFF</div>
      <label style={label}>Hand off to<select value={handoffTechId} onChange={event=>setHandoffTechId(event.target.value)} style={input} disabled={busy}><option value="">Leave Unassigned — next shift can pick it up</option>{techOptions.map(tech=><option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
      <label style={label}>What is left to do? *<textarea aria-label="Shift handoff note" value={handoffNote} onChange={event=>setHandoffNote(event.target.value)} maxLength={500} rows={3} placeholder="What still needs to be completed?" style={{...input,resize:"vertical"}} disabled={busy}/></label>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}><button type="button" onClick={()=>setHandoffOpen(false)} style={cancelButton} disabled={busy}>CANCEL</button><button type="button" onClick={()=>void handoff()} style={handoffButton} disabled={busy}>HAND OFF TO NEXT SHIFT</button></div>
    </section>:null;

    return <CurrentWorkHome
      timer={data.activeTimer}
      repair={activeRepair}
      unitRepairs={activeUnitRepairs}
      requests={activeRequests}
      technicianId={data.user.technicianId}
      now={now}
      busy={busy}
      message={message}
      handoffPanel={handoffPanel}
      onRepaired={()=>void repaired(activeRepair)}
      onDoneWorking={()=>setHandoffOpen(open=>!open)}
      onChooseRepair={repair=>void chooseRepair(repair)}
      onFoundRepairAdded={load}
      onUsePlannedPart={(repair,part)=>void usePlannedPart(repair,part)}
      onUseReservedPart={request=>void useReserved(request as PartRequest)}
    />;
  }

  return <main style={page}>
    <div style={shell}>
      <header style={header}><div><p style={eyebrow}>TECHNICIAN SHOP QUEUE</p><h1 style={title}>Shop Jobs</h1><p style={subtitle}>Pick a unit. Labor starts automatically when you begin working.</p></div><div style={{textAlign:"right"}}><strong>{data?.user.displayName??"Loading…"}</strong><div style={userName}>{data?.user.username?`@${data.user.username}`:""}</div></div></header>
      {message&&<div style={notice}>{message}</div>}
      {data?.user.role==="mechanic"&&!data.user.technicianId&&<div style={errorNotice}>Your login is not linked to a technician record yet. Ask an administrator to update the account.</div>}
      <div style={tabs}><button onClick={()=>setView("mine")} style={view==="mine"?activeTab:tab}>My Units ({mineGroups.length})</button><button onClick={()=>setView("available")} style={view==="available"?activeTab:tab}>Available Units ({availableGroups.length})</button><button onClick={()=>setView("all")} style={view==="all"?activeTab:tab}>All Open Units ({allGroups.length})</button></div>
      <section style={queue}>{groups.map(group=>{const workable=group.repairs.find(repair=>repair.technicianId===data?.user.technicianId||repair.technicianId===null);return <article key={group.key} style={unitCard}><div style={unitHeader}><a href={`/unit?unit=${encodeURIComponent(group.unit)}`} style={unitLink}>Unit {group.unit||"—"} ↗</a><span style={openCount}>{group.repairs.length} OPEN</span></div><div style={repairList}>{group.repairs.map(repair=><div key={repair.id} style={repairRow}><div><strong>{repair.issue}</strong><div style={repairMeta}>{repair.technicianId===null?"Unassigned":`Assigned to ${repair.assignedTo||"technician"}`} · {repair.laborHours.toFixed(2)} hr logged</div></div><span style={statusBadge}>{repair.status}</span></div>)}</div>{workable&&data?.user.technicianId?<button disabled={busy} onClick={()=>void startRepair(workable)} style={startButton}>START WORKING ON UNIT</button>:<a href={`/unit?unit=${encodeURIComponent(group.unit)}`} style={viewButton}>VIEW UNIT</a>}</article>})}{data&&!groups.length&&<div style={empty}>No units in this view.</div>}</section>
    </div>
  </main>;
}

const page={minHeight:"100vh",background:"#f4f6f8",padding:"26px clamp(12px,3vw,30px) 100px",color:"#182331"} as const;
const shell={maxWidth:1100,margin:"0 auto"} as const;
const header={display:"flex",justifyContent:"space-between",gap:18,alignItems:"flex-end",flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".15em"} as const;
const title={margin:"5px 0 4px",fontSize:32,color:"#102a43"} as const;
const subtitle={margin:0,color:"#687783",fontSize:13} as const;
const userName={fontSize:12,color:"#778591",marginTop:2} as const;
const notice={marginTop:14,padding:11,border:"1px solid #f2c66d",borderRadius:10,background:"#fff8e6",fontSize:13,fontWeight:800} as const;
const errorNotice={...notice,background:"#fff1f0",borderColor:"#efb3ad"} as const;
const tabs={display:"flex",gap:8,flexWrap:"wrap" as const,marginTop:20} as const;
const tab={border:"1px solid #ccd5dd",borderRadius:999,padding:"9px 13px",background:"white",color:"#253440",fontWeight:900,cursor:"pointer"} as const;
const activeTab={...tab,background:"#102a43",borderColor:"#102a43",color:"white"} as const;
const queue={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:13,marginTop:16} as const;
const unitCard={padding:16,borderRadius:14,background:"white",border:"1px solid #d9e0e6",boxShadow:"0 5px 18px #13283d09"} as const;
const unitHeader={display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"} as const;
const unitLink={fontSize:20,fontWeight:950,color:"#102a53",textDecoration:"none"} as const;
const openCount={fontSize:10,fontWeight:950,color:"#657383"} as const;
const repairList={display:"grid",gap:8,marginTop:10} as const;
const repairRow={display:"flex",justifyContent:"space-between",gap:10,padding:"10px 0",borderTop:"1px solid #edf0f2",fontSize:13} as const;
const repairMeta={fontSize:11,color:"#71808b",marginTop:3} as const;
const statusBadge={height:"fit-content",padding:"5px 7px",borderRadius:999,background:"#edf2f5",fontSize:9,fontWeight:950,color:"#53616d",whiteSpace:"nowrap" as const} as const;
const startButton={width:"100%",marginTop:12,border:0,borderRadius:10,padding:"12px",background:"#f47b20",color:"white",fontWeight:950,cursor:"pointer"} as const;
const viewButton={display:"block",marginTop:12,border:"1px solid #cbd4dc",borderRadius:10,padding:"11px",background:"white",color:"#253440",fontWeight:950,textAlign:"center" as const,textDecoration:"none"} as const;
const empty={gridColumn:"1 / -1",padding:30,border:"1px dashed #cbd4dc",borderRadius:13,background:"white",textAlign:"center" as const,color:"#667482"} as const;
const handoffPanelStyle={padding:15,border:"2px solid #75a6df",borderRadius:13,background:"#f2f7fd",display:"grid",gap:11} as const;
const helper={marginTop:3,fontSize:11,color:"#60717e"} as const;
const keepButton={border:"1px solid #7b8a96",borderRadius:9,padding:"11px",background:"white",color:"#253440",fontWeight:950,cursor:"pointer"} as const;
const orLine={textAlign:"center" as const,fontSize:10,fontWeight:950,letterSpacing:".1em",color:"#2e628e"} as const;
const label={display:"grid",gap:5,fontSize:11,fontWeight:950,color:"#425565"} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"10px",border:"1px solid #bdc9d4",borderRadius:8,background:"white",color:"#182331"} as const;
const cancelButton={border:"1px solid #9ca9b3",borderRadius:9,padding:"10px 13px",background:"white",color:"#253440",fontWeight:950,cursor:"pointer"} as const;
const handoffButton={border:0,borderRadius:9,padding:"10px 13px",background:"#176fe6",color:"white",fontWeight:950,cursor:"pointer"} as const;
