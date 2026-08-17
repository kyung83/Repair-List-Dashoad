"use client";

import { useEffect, useMemo, useState } from "react";
import MaintenanceChecklistPanel from "./maintenance-checklist-panel";
import { yardLabel } from "@/lib/yards";

type User = {
  id:number; username:string; displayName:string;
  role:"viewer"|"mechanic"|"manager"|"admin";
  technicianId:number|null; yard?:string; yardAssigned?:boolean;
};
type UsedPart={partId:number;partNumber:string;description:string;quantity:number};
type PlannedPart={id:number;partId:number;partNumber:string;description:string;quantity:number;usedQuantity:number;kitName:string};
type LaborEntry={id:number;technician:string;laborDate:string;hours:number;rate:number;notes:string};
type Repair={
  id:string;equipmentId:number|null;unit:string;issue:string;status:string;location:string;
  technicianId:number|null;assignedTo:string;laborHours:number;plannedParts:PlannedPart[];
  usedParts:UsedPart[];laborEntries:LaborEntry[];yard?:string;
};
type WarehouseStock={warehouseCode:string;warehouseName:string;quantityOnHand:number;physicalOnHand:number;reserved:number;available:number;onOrder:number;minimumQuantity:number};
type Part={id:number;partNumber:string;description:string;quantityOnHand:number;physicalOnHand?:number;reserved?:number;available?:number;onOrder?:number;location:string;warehouseStocks?:WarehouseStock[]};
type PartRequest={
  id:number;repairId:string;repairNumericId:number;partId:number;partNumber:string;description:string;
  warehouseCode:string;warehouseName:string;unit:string;technicianId:number|null;assignedTo:string;
  priority:string;outOfService:boolean;requestedQuantity:number;reservedQuantity:number;usedQuantity:number;
  remainingQuantity:number;shortageQuantity:number;state:"awaiting_parts"|"partially_available"|"available"|"used";
  createdAt:string;updatedAt:string;
};
type Timer={repairId:string;startedAt:string;title:string;unit:string};
type ShopData={user:User;activeTimer:Timer|null;repairs:Repair[];parts:Part[];partRequests?:PartRequest[];partsReadyCount?:number;updatedAt:string};
type View="mine"|"available"|"all";
type ActionResult={
  ok?:boolean;error?:string;repairId?:string;hours?:number;laborStarted?:boolean;completed?:boolean;removed?:boolean;
  requestId?:number;awaitingParts?:boolean;partiallyAvailable?:boolean;reservedQuantity?:number;shortageQuantity?:number;
  usedImmediately?:number;warehouseCode?:string;quantity?:number;partNumber?:string;
};
type UnitGroup={key:string;unit:string;equipmentId:number|null;repairs:Repair[]};

function timerStartMs(value:string){const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";return Date.parse(normalized)}
function duration(startedAt:string,now:number){const ms=Math.max(0,now-timerStartMs(startedAt)),total=Math.floor(ms/1000),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function unitKey(repair:Repair){if(repair.equipmentId!=null)return `equipment-${repair.equipmentId}`;return `unit-${repair.unit.trim().toLowerCase()||repair.id}`}
function sameUnit(left:Repair,right:Repair){return unitKey(left)===unitKey(right)}
function groupByUnit(repairs:Repair[]){const groups=new Map<string,UnitGroup>();for(const repair of repairs){const key=unitKey(repair),existing=groups.get(key);if(existing)existing.repairs.push(repair);else groups.set(key,{key,unit:repair.unit,equipmentId:repair.equipmentId,repairs:[repair]})}return [...groups.values()]}
function numberText(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function prettyYard(value:string|undefined){return yardLabel(value)||"Shop"}

export default function ShopPage(){
  const[data,setData]=useState<ShopData|null>(null),[view,setView]=useState<View>("mine"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now()),[selectedId,setSelectedId]=useState<string|null>(null),[partId,setPartId]=useState(""),[partQuantity,setPartQuantity]=useState(1);

  async function load(){
    const response=await fetch("/api/shop",{cache:"no-store"}),payload=await response.json() as ShopData&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Shop jobs could not be loaded.");
    setData(payload);setSelectedId(current=>current&&payload.repairs.some(repair=>repair.id===current)?current:payload.activeTimer?.repairId??null);
    if(payload.user.role==="manager"||payload.user.role==="admin")setView(current=>current==="mine"&&!payload.user.technicianId?"all":current);
  }
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Shop jobs could not be loaded."));const id=window.setInterval(()=>void load().catch(()=>undefined),30000);return()=>window.clearInterval(id)},[]);
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id)},[]);

  async function action(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),result=await response.json() as ActionResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Shop action failed.");
      if(result.repairId&&!result.completed)setSelectedId(result.repairId);
      if(result.completed){setSelectedId(null);setMessage(typeof result.hours==="number"?`Repair completed. ${result.hours.toFixed(2)} hours of running labor were saved.`:"Repair completed.")}
      else if(typeof result.hours==="number")setMessage(`Labor saved: ${result.hours.toFixed(2)} hours.`);
      else if(result.laborStarted)setMessage("Job opened. Labor timer started automatically.");
      await load();return result;
    }catch(error){setMessage(error instanceof Error?error.message:"Shop action failed.");return null}finally{setBusy(false)}
  }
  async function openJob(id:string){setSelectedId(id);await action({action:"openRepair",repairId:id})}
  function availabilityFor(part:Part,repair:Repair){const code=String(repair.yard||data?.user.yard||"").toUpperCase();if(!code)return Number(part.available??part.quantityOnHand??0);return Number(part.warehouseStocks?.find(stock=>stock.warehouseCode===code)?.available??0)}

  async function addPartToRepair(repair:Repair){
    if(!partId){setMessage("Choose a part first.");return}if(!Number.isFinite(partQuantity)||partQuantity<=0){setMessage("Enter a positive part quantity.");return}
    const result=await action({action:"usePart",repairId:repair.id,partId:Number(partId),quantity:partQuantity});
    if(result){setPartId("");setPartQuantity(1);if(result.awaitingParts)setMessage(result.reservedQuantity?`${numberText(result.reservedQuantity)} reserved in ${result.warehouseCode}; ${numberText(result.shortageQuantity||0)} still awaiting. Parts Desk was updated automatically.`:`Part request queued for ${result.warehouseCode}. Parts Desk was updated automatically.`);else setMessage(`${numberText(result.usedImmediately||partQuantity)} part unit(s) used from ${result.warehouseCode||prettyYard(repair.yard)} inventory.`)}
  }
  async function usePlannedPart(repair:Repair,planned:PlannedPart){const remaining=Math.max(0,planned.quantity-planned.usedQuantity);if(remaining<=0)return;const result=await action({action:"usePart",repairId:repair.id,partId:planned.partId,quantity:remaining});if(result)setMessage(result.awaitingParts?`${planned.partNumber}: ${numberText(result.reservedQuantity||0)} reserved, ${numberText(result.shortageQuantity||0)} awaiting. Parts Desk was updated automatically.`:`${numberText(result.usedImmediately||remaining)} × ${planned.partNumber} used from ${result.warehouseCode}.`)}
  async function useReserved(request:PartRequest){const result=await action({action:"useReservedPart",requestId:request.id,quantity:request.reservedQuantity});if(result)setMessage(`${numberText(result.quantity||request.reservedQuantity)} × ${request.partNumber} used from reserved ${request.warehouseCode} stock.`)}
  async function removePlannedPart(repair:Repair,planned:PlannedPart){if(!window.confirm(`Mark ${planned.partNumber} — ${planned.description} as not needed for this PM?\n\nThis only removes it from this PM. It does not change the master PM kit or inventory.`))return;const result=await action({action:"removePlannedPart",repairId:repair.id,plannedPartId:planned.id});if(result)setMessage(`${planned.partNumber} marked not needed for this PM.`)}
  async function completeJob(repair:Repair){if(!window.confirm(`Complete the repair for Unit ${repair.unit||"—"}: ${repair.issue}?`))return;await action({action:"completeRepair",repairId:repair.id})}

  const mine=useMemo(()=>!data?.user.technicianId?[]:data.repairs.filter(repair=>repair.technicianId===data.user.technicianId),[data]);
  const available=useMemo(()=>data?.repairs.filter(repair=>repair.technicianId===null)??[],[data]);
  const visible=useMemo(()=>!data?[]:view==="mine"?mine:view==="available"?available:data.repairs,[data,view,mine,available]);
  const visibleGroups=useMemo(()=>groupByUnit(visible),[visible]),mineGroups=useMemo(()=>groupByUnit(mine),[mine]),availableGroups=useMemo(()=>groupByUnit(available),[available]),allGroups=useMemo(()=>groupByUnit(data?.repairs??[]),[data]);
  const selected=useMemo(()=>data?.repairs.find(repair=>repair.id===selectedId)??null,[data,selectedId]);
  const selectedUnitRepairs=useMemo(()=>selected&&data?data.repairs.filter(repair=>sameUnit(repair,selected)):[],[data,selected]);
  const selectedRequests=useMemo(()=>selected?(data?.partRequests??[]).filter(request=>request.repairId===selected.id):[],[data,selected]);
  const readyForMe=useMemo(()=>(data?.partRequests??[]).filter(request=>request.reservedQuantity>0&&(!data?.user.technicianId||request.technicianId===data.user.technicianId)),[data]);

  return <main style={{minHeight:"100vh",background:"#f3f5f7",padding:"34px 34px 100px",color:"#182331"}}>
    <header style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"flex-end",flexWrap:"wrap"}}><div><p style={{margin:0,color:"#f47b20",fontWeight:900,fontSize:12,letterSpacing:".16em"}}>TECHNICIAN SHOP QUEUE</p><h1 style={{margin:"7px 0 5px",fontSize:34,color:"#0d1b2b"}}>Shop Jobs</h1><p style={{margin:0,color:"#667482"}}>Jobs are grouped by unit. Parts availability is scoped to the job's yard.</p></div><div style={{textAlign:"right"}}><strong style={{display:"block"}}>{data?.user.displayName??"Loading…"}</strong><span style={{fontSize:13,color:"#667482"}}>{data?.user.username?`@${data.user.username}`:""}</span></div></header>
    {message&&<div style={noticeStyle}>{message}</div>}
    {data?.user.role==="mechanic"&&!data.user.technicianId&&<div style={{...noticeStyle,background:"#fff1f0",borderColor:"#efb3ad"}}>Your login exists, but it is not linked to a technician record yet. Ask an administrator to open Users and save your mechanic account.</div>}

    {readyForMe.length>0&&<section style={{marginTop:16,padding:15,border:"2px solid #62a77d",borderRadius:12,background:"#f0fbf4"}}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><strong style={{color:"#176440"}}>Parts ready for {readyForMe.length} repair line{readyForMe.length===1?"":"s"}</strong><div style={{fontSize:12,color:"#5e7567",marginTop:3}}>Receiving allocated these automatically. Open the repair to use the reserved quantity.</div></div></div><div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:9}}>{readyForMe.slice(0,6).map(request=><button key={request.id} onClick={()=>setSelectedId(request.repairId)} style={readyButton}>Unit {request.unit||"—"} · {request.partNumber} · {numberText(request.reservedQuantity)} ready</button>)}</div></section>}

    {data?.activeTimer&&<section style={{marginTop:20,background:"#0d1b2b",color:"white",borderRadius:14,padding:20,display:"flex",justifyContent:"space-between",gap:20,alignItems:"center",flexWrap:"wrap"}}><div><p style={{margin:"0 0 5px",fontSize:11,fontWeight:900,letterSpacing:".15em",color:"#ff9a4c"}}>LABOR RUNNING</p><button onClick={()=>setSelectedId(data.activeTimer!.repairId)} style={activeJobButton}>Unit {data.activeTimer.unit||"—"} — {data.activeTimer.title}</button><div style={{marginTop:5,color:"#cbd6df"}}>Started {new Date(timerStartMs(data.activeTimer.startedAt)).toLocaleString()}</div></div><div style={{display:"flex",alignItems:"center",gap:16}}><span style={{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",fontSize:28,fontWeight:900}}>{duration(data.activeTimer.startedAt,now)}</span><button disabled={busy} onClick={()=>void action({action:"stopLabor",repairId:data.activeTimer?.repairId})} style={dangerButton}>Stop Labor</button></div></section>}

    <section style={{marginTop:22,display:"flex",gap:10,flexWrap:"wrap"}}><button onClick={()=>setView("mine")} style={view==="mine"?activeTab:tabButton}>My Units ({mineGroups.length})</button><button onClick={()=>setView("available")} style={view==="available"?activeTab:tabButton}>Available Units ({availableGroups.length})</button><button onClick={()=>setView("all")} style={view==="all"?activeTab:tabButton}>All Open Units ({allGroups.length})</button></section>

    {selected&&data&&(()=>{const repairMine=selected.technicianId===data.user.technicianId&&data.user.technicianId!==null,repairAvailable=selected.technicianId===null,running=data.activeTimer?.repairId===selected.id,canOpen=Boolean(data.user.technicianId)&&(repairMine||repairAvailable),blockedByOtherTimer=Boolean(data.activeTimer&&!running),canManageChecklist=repairMine||data.user.role==="manager"||data.user.role==="admin";return <section style={workspaceStyle}>
      <div style={{display:"flex",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}><div><p style={{margin:0,color:"#f47b20",fontSize:11,fontWeight:900,letterSpacing:".14em"}}>UNIT WORKSPACE</p><h2 style={{margin:"7px 0 4px",fontSize:27,color:"#0d1b2b"}}>Unit {selected.unit||"—"}</h2><div style={{color:"#667482"}}>{selectedUnitRepairs.length} open job{selectedUnitRepairs.length===1?"":"s"} · {prettyYard(selected.yard)} inventory</div></div></div>
      <div style={{marginTop:15,display:"grid",gap:8}}>{selectedUnitRepairs.map(repair=>{const rowMine=repair.technicianId===data.user.technicianId&&data.user.technicianId!==null,rowAvailable=repair.technicianId===null,rowRunning=data.activeTimer?.repairId===repair.id,rowCanOpen=Boolean(data.user.technicianId)&&(rowMine||rowAvailable)&&!data.activeTimer;return <div key={repair.id} style={{...unitJobRow,borderColor:repair.id===selected.id?"#f47b20":"#dfe5ea"}}><button onClick={()=>setSelectedId(repair.id)} style={unitJobTitle}>{repair.issue}</button><div style={{minWidth:160,color:"#667482",fontSize:12}}>{repair.status||"Open"} · {rowAvailable?"Unassigned":`Assigned to ${repair.assignedTo||"technician"}`}</div><div style={{display:"flex",gap:7,justifyContent:"flex-end",flexWrap:"wrap"}}>{rowCanOpen&&<button disabled={busy} onClick={()=>void openJob(repair.id)} style={smallPrimaryButton}>Open & Start</button>}{rowRunning&&<span style={runningBadge}>Labor Running</span>}<button onClick={()=>setSelectedId(repair.id)} style={smallSecondaryButton}>Work on Job</button></div></div>})}</div>

      <div style={{marginTop:20,paddingTop:18,borderTop:"1px solid #e1e6ea"}}><div style={{display:"flex",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}><div><p style={{margin:0,color:"#f47b20",fontSize:11,fontWeight:900,letterSpacing:".14em"}}>SELECTED REPAIR</p><h3 style={{margin:"6px 0 4px",fontSize:23,color:"#0d1b2b"}}>{selected.issue}</h3><div style={{color:"#667482"}}>{selected.location||"No location"} · {selected.status} · {repairAvailable?"Unassigned":`Assigned to ${selected.assignedTo||"technician"}`}</div></div><div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}>{canOpen&&!data.activeTimer&&<button disabled={busy} onClick={()=>void openJob(selected.id)} style={primaryButton}>Open Job & Start Labor</button>}{running&&<button disabled={busy} onClick={()=>void action({action:"stopLabor",repairId:selected.id})} style={dangerButton}>Stop Labor</button>}{repairMine&&!blockedByOtherTimer&&<button disabled={busy} onClick={()=>void completeJob(selected)} style={completeButton}>Complete Repair</button>}</div></div>
      {!repairMine&&repairAvailable&&<div style={smallNotice}>Open this job first. Opening it assigns it to you and starts the labor timer.</div>}{!repairMine&&!repairAvailable&&<div style={lockedNotice}>This repair is assigned to {selected.assignedTo||"another technician"}. You can see it, but only that technician or a manager can work it.</div>}{repairMine&&blockedByOtherTimer&&<div style={smallNotice}>You have labor running on another repair. Stop that timer before opening or completing this one.</div>}
      <MaintenanceChecklistPanel repairId={selected.id} canWork={canManageChecklist&&!blockedByOtherTimer}/>

      <div style={{marginTop:20,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(330px,1fr))",gap:16}}><div style={workspaceCard}><h3 style={workspaceHeading}>Parts</h3>
        {selectedRequests.length>0&&<div style={{display:"grid",gap:7,marginBottom:13}}>{selectedRequests.map(request=><div key={request.id} style={{...requestRow,borderColor:request.shortageQuantity>0?"#e3ba69":"#7eb391",background:request.shortageQuantity>0?"#fff9ed":"#f1faf4"}}><div><strong>{request.partNumber}</strong><span>{request.description}</span></div><div style={{fontSize:11,color:"#5f6f7d"}}>{numberText(request.usedQuantity)} used · {numberText(request.reservedQuantity)} reserved · {numberText(request.shortageQuantity)} awaiting</div>{repairMine&&request.reservedQuantity>0&&<button disabled={busy} onClick={()=>void useReserved(request)} style={plannedUseButton}>Use {numberText(request.reservedQuantity)} Reserved</button>}</div>)}</div>}
        {selected.plannedParts.length>0&&<div style={plannedBox}><div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"baseline",flexWrap:"wrap"}}><strong style={{color:"#76420a"}}>PM Kit · Planned Parts</strong><span style={{color:"#8c6233",fontSize:11}}>{selected.plannedParts[0]?.kitName||"PM Kit"}</span></div><div style={{marginTop:9,display:"grid",gap:7}}>{selected.plannedParts.map(planned=>{const remaining=Math.max(0,planned.quantity-planned.usedQuantity),inventoryPart=data.parts.find(part=>part.id===planned.partId),stock=inventoryPart?availabilityFor(inventoryPart,selected):0;return <div key={planned.id} style={plannedRow}><div style={{minWidth:0}}><strong style={{display:"block",color:"#253542"}}>{planned.partNumber} · {numberText(planned.quantity)} planned</strong><span style={{display:"block",marginTop:2,color:"#697782",fontSize:11}}>{planned.description}</span><span style={{display:"block",marginTop:2,color:planned.usedQuantity>=planned.quantity?"#176440":"#7c684e",fontSize:10,fontWeight:800}}>{numberText(planned.usedQuantity)} used · {numberText(remaining)} remaining · {numberText(stock)} available in {prettyYard(selected.yard)}</span></div><div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>{remaining<=0?<span style={usedBadge}>Used</span>:<>{repairMine&&<button disabled={busy} onClick={()=>void usePlannedPart(selected,planned)} style={plannedUseButton}>{stock+0.000001>=remaining?`Use ${numberText(remaining)}`:`Request ${numberText(remaining)}`}</button>}{repairMine&&planned.usedQuantity<=0&&<button disabled={busy} onClick={()=>void removePlannedPart(selected,planned)} style={notNeededButton}>Not Needed</button>}</>}</div></div>})}</div></div>}
        <div style={{minHeight:32,marginTop:selected.plannedParts.length?13:0}}><strong style={{display:"block",marginBottom:6,color:"#52616c",fontSize:11,textTransform:"uppercase",letterSpacing:".05em"}}>Parts Actually Used</strong>{selected.usedParts.length?selected.usedParts.map(part=><span key={part.partId} style={chip}>{part.partNumber} × {numberText(part.quantity)}</span>):<span style={mutedText}>No parts used yet.</span>}</div>
        {repairMine&&<div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 90px auto",gap:8}}><select value={partId} onChange={event=>setPartId(event.target.value)} style={inputStyle} disabled={busy}><option value="">Choose / request part</option>{data.parts.map(part=>{const qty=availabilityFor(part,selected);return <option key={part.id} value={part.id}>{part.partNumber} — {part.description} ({numberText(qty)} available)</option>})}</select><input type="number" min="0.01" step="any" value={partQuantity} onChange={event=>setPartQuantity(Number(event.target.value))} style={inputStyle} disabled={busy}/><button disabled={busy} onClick={()=>void addPartToRepair(selected)} style={secondaryButton}>Use / Request</button></div>}
      </div><div style={workspaceCard}><h3 style={workspaceHeading}>Labor</h3><strong style={{display:"block",fontSize:25,color:"#0d1b2b"}}>{selected.laborHours.toFixed(2)} hours logged</strong>{running&&data.activeTimer&&<div style={{marginTop:8,color:"#b45309",fontWeight:800}}>Current timer: {duration(data.activeTimer.startedAt,now)}</div>}<div style={{marginTop:10,display:"grid",gap:5}}>{selected.laborEntries.slice(0,6).map(entry=><div key={entry.id} style={{fontSize:12,color:"#657383"}}>{entry.laborDate} · {entry.technician} · {entry.hours.toFixed(2)} hr{entry.notes?` · ${entry.notes}`:""}</div>)}{!selected.laborEntries.length&&<span style={mutedText}>Completed timer sessions will appear here.</span>}</div></div></div></div>
    </section>})()}

    <section style={{marginTop:16,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))",gap:14}}>{visibleGroups.map(group=>{const runningRepair=group.repairs.find(repair=>data?.activeTimer?.repairId===repair.id)??null,selectedInGroup=group.repairs.some(repair=>repair.id===selectedId),totalHours=group.repairs.reduce((sum,repair)=>sum+repair.laborHours,0),locations=[...new Set(group.repairs.map(repair=>repair.location).filter(Boolean))];return <article key={group.key} style={{background:"white",border:runningRepair?"2px solid #f47b20":selectedInGroup?"2px solid #0d1b2b":"1px solid #dce2e7",borderRadius:13,padding:18,boxShadow:"0 4px 18px #12202f0d"}}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline"}}><span style={{fontSize:15,color:"#f47b20",fontWeight:900}}>UNIT {group.unit||"—"}</span><span style={{fontSize:12,fontWeight:900,color:"#5d6975"}}>{group.repairs.length} OPEN JOB{group.repairs.length===1?"":"S"}</span></div><div style={{marginTop:7,color:"#667482",fontSize:12}}>{locations.length?locations.join(" · "):"No location"} · {totalHours.toFixed(2)} total labor hours</div><div style={{marginTop:13,display:"grid",gap:8}}>{group.repairs.map(repair=>{const repairMine=repair.technicianId===data?.user.technicianId&&data?.user.technicianId!==null,repairAvailable=repair.technicianId===null,repairRunning=data?.activeTimer?.repairId===repair.id,canOpen=Boolean(data?.user.technicianId)&&(repairMine||repairAvailable)&&!data?.activeTimer,partsWaiting=(data?.partRequests??[]).filter(request=>request.repairId===repair.id&&request.shortageQuantity>0).length;return <div key={repair.id} style={queueJobRow}><button onClick={()=>setSelectedId(repair.id)} style={queueJobTitle}>{repair.issue}</button><div style={{marginTop:3,color:"#667482",fontSize:11}}>{repair.status||"Open"} · {repairAvailable?"Unassigned":`Assigned to ${repair.assignedTo||"technician"}`} · {repair.laborHours.toFixed(2)} hr{partsWaiting?` · ${partsWaiting} part line awaiting`:""}</div><div style={{marginTop:8,display:"flex",gap:7,flexWrap:"wrap"}}>{canOpen&&<button disabled={busy} onClick={()=>void openJob(repair.id)} style={smallPrimaryButton}>Open Job</button>}{repairRunning&&<span style={runningBadge}>Labor Running</span>}<button onClick={()=>setSelectedId(repair.id)} style={smallSecondaryButton}>View</button></div></div>})}</div><button onClick={()=>setSelectedId(runningRepair?.id??group.repairs[0]?.id??null)} style={unitButton}>View All {group.repairs.length} Job{group.repairs.length===1?"":"s"} for Unit {group.unit||"—"}</button></article>})}{data&&!visibleGroups.length&&<div style={{gridColumn:"1 / -1",background:"white",border:"1px dashed #cbd4dc",borderRadius:13,padding:34,textAlign:"center",color:"#667482"}}><strong style={{display:"block",color:"#24313d",marginBottom:5}}>No units in this view</strong>{view==="available"?"There are no units with unassigned open repairs right now.":"Assigned and open unit jobs will appear here."}</div>}</section>
  </main>
}

const noticeStyle={marginTop:18,padding:12,borderRadius:10,background:"#fff8e6",border:"1px solid #f2c66d"} as const;
const tabButton={border:"1px solid #cdd5dc",borderRadius:999,padding:"9px 14px",background:"white",color:"#283645",fontWeight:800,cursor:"pointer"} as const;
const activeTab={...tabButton,background:"#0d1b2b",borderColor:"#0d1b2b",color:"white"} as const;
const primaryButton={border:0,borderRadius:9,padding:"10px 14px",background:"#f47b20",color:"white",fontWeight:900,cursor:"pointer"} as const;
const smallPrimaryButton={border:0,borderRadius:7,padding:"7px 9px",background:"#f47b20",color:"white",fontWeight:900,fontSize:11,cursor:"pointer"} as const;
const secondaryButton={border:"1px solid #cbd3da",borderRadius:9,padding:"9px 12px",background:"#f7f9fa",color:"#182331",fontWeight:800,cursor:"pointer"} as const;
const smallSecondaryButton={border:"1px solid #cbd3da",borderRadius:7,padding:"6px 9px",background:"#f7f9fa",color:"#182331",fontWeight:800,fontSize:11,cursor:"pointer"} as const;
const dangerButton={border:0,borderRadius:9,padding:"10px 14px",background:"#c83e32",color:"white",fontWeight:900,cursor:"pointer"} as const;
const completeButton={border:0,borderRadius:9,padding:"10px 14px",background:"#16784c",color:"white",fontWeight:900,cursor:"pointer"} as const;
const inputStyle={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #ccd4db",borderRadius:8,background:"white",color:"#182331"} as const;
const workspaceStyle={marginTop:18,background:"white",border:"1px solid #d6dde3",borderRadius:15,padding:20,boxShadow:"0 8px 30px #12202f12"} as const;
const workspaceCard={border:"1px solid #e0e5e9",borderRadius:11,padding:15,background:"#fbfcfd"} as const;
const workspaceHeading={margin:"0 0 11px",color:"#0d1b2b",fontSize:17} as const;
const chip={display:"inline-block",padding:"5px 8px",borderRadius:999,background:"#eef2f5",fontSize:12,margin:"0 5px 5px 0"} as const;
const plannedBox={padding:12,borderRadius:10,background:"#fff9ed",border:"1px solid #ebc986"} as const;
const plannedRow={display:"grid",gridTemplateColumns:"minmax(180px,1fr) auto",gap:10,alignItems:"center",padding:"9px 10px",borderRadius:8,background:"white",border:"1px solid #eadcc3"} as const;
const requestRow={display:"grid",gridTemplateColumns:"minmax(170px,1fr) auto auto",gap:9,alignItems:"center",padding:"9px 10px",border:"1px solid",borderRadius:8} as const;
const plannedUseButton={border:"1px solid #81ad8f",borderRadius:7,padding:"7px 9px",background:"#e9f7ed",color:"#176440",fontWeight:900,fontSize:11,cursor:"pointer"} as const;
const notNeededButton={border:"1px solid #c8b9a1",borderRadius:7,padding:"7px 9px",background:"#f7f3ed",color:"#6d5a40",fontWeight:900,fontSize:11,cursor:"pointer"} as const;
const usedBadge={display:"inline-flex",alignItems:"center",minHeight:29,padding:"0 9px",borderRadius:999,background:"#e5f6eb",color:"#176440",fontWeight:900,fontSize:11} as const;
const mutedText={color:"#7b8792",fontSize:13} as const;
const smallNotice={marginTop:12,padding:"9px 11px",borderRadius:8,background:"#fff8e6",color:"#7a5316",fontSize:12} as const;
const lockedNotice={marginTop:12,padding:"9px 11px",borderRadius:8,background:"#f3f5f7",color:"#657383",fontSize:12} as const;
const activeJobButton={display:"block",border:0,padding:0,background:"transparent",color:"white",textAlign:"left" as const,fontSize:22,fontWeight:900,cursor:"pointer"} as const;
const queueJobRow={padding:11,border:"1px solid #e1e6ea",borderRadius:9,background:"#fbfcfd"} as const;
const queueJobTitle={display:"block",width:"100%",border:0,padding:0,background:"transparent",color:"#182331",textAlign:"left" as const,fontSize:15,fontWeight:900,cursor:"pointer"} as const;
const unitJobRow={display:"grid",gridTemplateColumns:"minmax(220px,1fr) minmax(160px,auto) auto",gap:12,alignItems:"center",padding:"10px 12px",border:"1px solid #dfe5ea",borderRadius:9,background:"#fbfcfd"} as const;
const unitJobTitle={border:0,padding:0,background:"transparent",color:"#0d1b2b",fontWeight:900,textAlign:"left" as const,cursor:"pointer"} as const;
const runningBadge={display:"inline-flex",alignItems:"center",padding:"6px 9px",borderRadius:999,background:"#fff0e4",color:"#a94a08",fontWeight:900,fontSize:11} as const;
const unitButton={width:"100%",marginTop:12,border:"1px solid #cbd3da",borderRadius:9,padding:"9px 12px",background:"white",color:"#182331",fontWeight:900,cursor:"pointer"} as const;
const readyButton={border:"1px solid #8abd9b",borderRadius:999,padding:"7px 10px",background:"white",color:"#176440",fontWeight:900,cursor:"pointer",fontSize:11} as const;
