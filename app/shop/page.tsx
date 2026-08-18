"use client";

import { useEffect, useMemo, useState } from "react";
import MaintenanceChecklistPanel from "./maintenance-checklist-panel";
import FoundRepairControl from "./found-repair-control";
import { yardLabel } from "@/lib/yards";

type User={id:number;username:string;displayName:string;role:"viewer"|"mechanic"|"manager"|"admin";technicianId:number|null;yard?:string;yardAssigned?:boolean};
type UsedPart={partId:number;partNumber:string;description:string;quantity:number};
type PlannedPart={id:number;partId:number;partNumber:string;description:string;quantity:number;usedQuantity:number;kitName:string};
type LaborEntry={id:number;technician:string;laborDate:string;hours:number;rate:number;notes:string};
type Repair={id:string;equipmentId:number|null;unit:string;issue:string;status:string;location:string;technicianId:number|null;assignedTo:string;laborHours:number;plannedParts:PlannedPart[];usedParts:UsedPart[];laborEntries:LaborEntry[];yard?:string};
type WarehouseStock={warehouseCode:string;warehouseName:string;quantityOnHand:number;physicalOnHand:number;reserved:number;available:number;onOrder:number;minimumQuantity:number};
type Part={id:number;partNumber:string;description:string;quantityOnHand:number;physicalOnHand?:number;reserved?:number;available?:number;onOrder?:number;location:string;warehouseStocks?:WarehouseStock[]};
type PartRequest={id:number;repairId:string;repairNumericId:number;partId:number;partNumber:string;description:string;warehouseCode:string;warehouseName:string;unit:string;technicianId:number|null;assignedTo:string;priority:string;outOfService:boolean;requestedQuantity:number;reservedQuantity:number;usedQuantity:number;remainingQuantity:number;shortageQuantity:number;state:"awaiting_parts"|"partially_available"|"available"|"used";createdAt:string;updatedAt:string};
type Timer={repairId:string;startedAt:string;title:string;unit:string};
type ShopData={user:User;activeTimer:Timer|null;repairs:Repair[];parts:Part[];partRequests?:PartRequest[];partsReadyCount?:number;updatedAt:string};
type View="mine"|"available"|"all";
type ActionResult={ok?:boolean;error?:string;repairId?:string;hours?:number;laborStarted?:boolean;completed?:boolean;removed?:boolean;requestId?:number;awaitingParts?:boolean;partiallyAvailable?:boolean;reservedQuantity?:number;shortageQuantity?:number;usedImmediately?:number;warehouseCode?:string;quantity?:number;partNumber?:string;nextRepairId?:string|null;waitingOnPart?:boolean;skipped?:boolean;unitDone?:boolean;partAvailable?:boolean;needsPart?:boolean;switched?:boolean};
type UnitGroup={key:string;unit:string;equipmentId:number|null;repairs:Repair[]};

function timerStartMs(value:string){const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";return Date.parse(normalized)}
function duration(startedAt:string,now:number){const ms=Math.max(0,now-timerStartMs(startedAt)),total=Math.floor(ms/1000),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function unitKey(repair:Repair){if(repair.equipmentId!=null)return `equipment-${repair.equipmentId}`;return `unit-${repair.unit.trim().toLowerCase()||repair.id}`}
function sameUnit(left:Repair,right:Repair){return unitKey(left)===unitKey(right)}
function groupByUnit(repairs:Repair[]){const groups=new Map<string,UnitGroup>();for(const repair of repairs){const key=unitKey(repair),existing=groups.get(key);if(existing)existing.repairs.push(repair);else groups.set(key,{key,unit:repair.unit,equipmentId:repair.equipmentId,repairs:[repair]})}return [...groups.values()]}
function numberText(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function prettyYard(value:string|undefined){return yardLabel(value)||"Shop"}
function lineState(repair:Repair,activeId:string|undefined){if(repair.id===activeId)return "WORKING NOW";if(repair.status.trim().toLowerCase()==="waiting on part")return "WAITING ON PART";return "OPEN"}

export default function ShopPage(){
  const[data,setData]=useState<ShopData|null>(null),[view,setView]=useState<View>("mine"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now()),[selectedId,setSelectedId]=useState<string|null>(null),[partId,setPartId]=useState(""),[partQuantity,setPartQuantity]=useState(1),[needPart,setNeedPart]=useState(false);

  async function load(){
    const response=await fetch("/api/shop",{cache:"no-store"}),payload=await response.json() as ShopData&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Shop jobs could not be loaded.");
    setData(payload);
    setSelectedId(current=>payload.activeTimer?.repairId??(current&&payload.repairs.some(repair=>repair.id===current)?current:null));
    if(payload.user.role==="manager"||payload.user.role==="admin")setView(current=>current==="mine"&&!payload.user.technicianId?"all":current);
  }
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Shop jobs could not be loaded."));const id=window.setInterval(()=>void load().catch(()=>undefined),30000);return()=>window.clearInterval(id)},[]);
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id)},[]);

  async function action(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),result=await response.json() as ActionResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Shop action failed.");
      if(result.nextRepairId)setSelectedId(result.nextRepairId);else if(result.unitDone)setSelectedId(null);else if(result.repairId&&!result.completed)setSelectedId(result.repairId);else if(result.completed)setSelectedId(null);
      if(result.partAvailable)setMessage(`${result.partNumber||"Part"} was available and applied. Keep working on this repair.`);
      else if(result.unitDone)setMessage(typeof result.hours==="number"?`Unit session ended. ${result.hours.toFixed(2)} hours were saved to the current repair.`:"Unit session ended. Open repairs remain open.");
      else if(result.waitingOnPart)setMessage(result.nextRepairId?"Waiting on Part saved. Labor moved to the next repair.":"Waiting on Part saved. No other repair was started.");
      else if(result.skipped)setMessage(result.nextRepairId?"Skipped for now. Labor moved to the next repair.":"Skipped for now. No other repair was started.");
      else if(result.completed)setMessage(result.nextRepairId?"Repair completed. Labor moved to the next repair.":"Repair completed. No other repair was started.");
      else if(result.switched)setMessage("Labor saved to the previous repair and started on this repair.");
      else if(result.laborStarted)setMessage("Unit workspace opened. Labor started automatically.");
      await load();return result;
    }catch(error){setMessage(error instanceof Error?error.message:"Shop action failed.");return null}finally{setBusy(false)}
  }

  function availabilityFor(part:Part,repair:Repair){const code=String(repair.yard||data?.user.yard||"").toUpperCase();if(!code)return Number(part.available??part.quantityOnHand??0);return Number(part.warehouseStocks?.find(stock=>stock.warehouseCode===code)?.available??0)}
  async function startUnit(repair:Repair){setNeedPart(false);setSelectedId(repair.id);await action({action:"startUnit",repairId:repair.id})}
  async function chooseRepair(repair:Repair){if(!data)return;if(!data.activeTimer){setNeedPart(false);setSelectedId(repair.id);return}const active=data.repairs.find(item=>item.id===data.activeTimer?.repairId);if(!active||!sameUnit(active,repair)){setSelectedId(repair.id);setMessage("Finish the current unit before moving to another unit.");return}if(repair.id!==active.id){setNeedPart(false);await action({action:"switchRepair",repairId:repair.id})}}
  async function reportOutcome(outcome:"repaired"|"waiting_part"|"skip",repair:Repair){if(outcome==="waiting_part"){const shortage=(data?.partRequests??[]).some(request=>request.repairId===repair.id&&request.shortageQuantity>0);if(!shortage){setNeedPart(true);setMessage("Select the needed part and quantity, then tap Done.");return}}setNeedPart(false);await action({action:"repairOutcome",repairId:repair.id,outcome})}
  async function submitWaitingPart(repair:Repair){if(!partId){setMessage("Choose the needed part.");return}if(!Number.isFinite(partQuantity)||partQuantity<=0){setMessage("Enter a positive quantity.");return}const result=await action({action:"repairOutcome",repairId:repair.id,outcome:"waiting_part",partId:Number(partId),quantity:partQuantity});if(result){setPartId("");setPartQuantity(1);setNeedPart(false)}}
  async function doneUnit(){await action({action:"doneUnit"});setNeedPart(false)}

  async function addPartToRepair(repair:Repair){if(!partId){setMessage("Choose a part first.");return}if(!Number.isFinite(partQuantity)||partQuantity<=0){setMessage("Enter a positive part quantity.");return}const result=await action({action:"usePart",repairId:repair.id,partId:Number(partId),quantity:partQuantity});if(result){setPartId("");setPartQuantity(1);if(result.awaitingParts)setMessage(`${result.partNumber}: Parts Desk updated automatically. Tap WAITING ON PART when you are ready to move on.`);else setMessage(`${numberText(result.usedImmediately||partQuantity)} part unit(s) used from ${result.warehouseCode||prettyYard(repair.yard)} inventory.`)}}
  async function usePlannedPart(repair:Repair,planned:PlannedPart){const remaining=Math.max(0,planned.quantity-planned.usedQuantity);if(remaining<=0)return;const result=await action({action:"usePart",repairId:repair.id,partId:planned.partId,quantity:remaining});if(result)setMessage(result.awaitingParts?`${planned.partNumber}: Parts Desk updated automatically. Tap WAITING ON PART when you are ready to move on.`:`${numberText(result.usedImmediately||remaining)} × ${planned.partNumber} used from ${result.warehouseCode}.`)}
  async function useReserved(request:PartRequest){const result=await action({action:"useReservedPart",requestId:request.id,quantity:request.reservedQuantity});if(result)setMessage(`${numberText(result.quantity||request.reservedQuantity)} × ${request.partNumber} used from reserved ${request.warehouseCode} stock.`)}

  const mine=useMemo(()=>!data?.user.technicianId?[]:data.repairs.filter(repair=>repair.technicianId===data.user.technicianId),[data]);
  const available=useMemo(()=>data?.repairs.filter(repair=>repair.technicianId===null)??[],[data]);
  const visible=useMemo(()=>!data?[]:view==="mine"?mine:view==="available"?available:data.repairs,[data,view,mine,available]);
  const visibleGroups=useMemo(()=>groupByUnit(visible),[visible]);
  const mineGroups=useMemo(()=>groupByUnit(mine),[mine]);
  const availableGroups=useMemo(()=>groupByUnit(available),[available]);
  const allGroups=useMemo(()=>groupByUnit(data?.repairs??[]),[data]);
  const selected=useMemo(()=>data?.repairs.find(repair=>repair.id===selectedId)??null,[data,selectedId]);
  const activeRepair=useMemo(()=>data?.repairs.find(repair=>repair.id===data.activeTimer?.repairId)??null,[data]);
  const workspaceRepair=activeRepair??selected;
  const unitRepairs=useMemo(()=>workspaceRepair&&data?data.repairs.filter(repair=>sameUnit(repair,workspaceRepair)):[],[data,workspaceRepair]);
  const selectedRequests=useMemo(()=>selected?(data?.partRequests??[]).filter(request=>request.repairId===selected.id):[],[data,selected]);
  const readyForMe=useMemo(()=>(data?.partRequests??[]).filter(request=>request.reservedQuantity>0&&(!data?.user.technicianId||request.technicianId===data.user.technicianId)),[data]);

  return <main style={{minHeight:"100vh",background:"#f3f5f7",padding:"30px 30px 90px",color:"#182331"}}>
    <header style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"flex-end",flexWrap:"wrap"}}><div><p style={{margin:0,color:"#f47b20",fontWeight:900,fontSize:12,letterSpacing:".16em"}}>TECHNICIAN SHOP QUEUE</p><h1 style={{margin:"7px 0 5px",fontSize:34,color:"#0d1b2b"}}>Shop Jobs</h1><p style={{margin:0,color:"#667482"}}>Report what happened. The software handles labor, status, parts, and the next repair.</p></div><div style={{textAlign:"right"}}><strong style={{display:"block"}}>{data?.user.displayName??"Loading…"}</strong><span style={{fontSize:13,color:"#667482"}}>{data?.user.username?`@${data.user.username}`:""}</span></div></header>
    {message&&<div style={noticeStyle}>{message}</div>}
    {data?.user.role==="mechanic"&&!data.user.technicianId&&<div style={{...noticeStyle,background:"#fff1f0",borderColor:"#efb3ad"}}>Your login is not linked to a technician record yet. Ask an administrator to update the account.</div>}

    {readyForMe.length>0&&<section style={readySection}><strong style={{color:"#176440"}}>Parts ready for {readyForMe.length} repair line{readyForMe.length===1?"":"s"}</strong><div style={{fontSize:12,color:"#5e7567",marginTop:3}}>Receiving allocated these automatically.</div><div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:9}}>{readyForMe.slice(0,6).map(request=><button key={request.id} onClick={()=>setSelectedId(request.repairId)} style={readyButton}>Unit {request.unit||"—"} · {request.partNumber} · {numberText(request.reservedQuantity)} ready</button>)}</div></section>}

    {data?.activeTimer&&<section style={workingBanner}><div><p style={{margin:"0 0 5px",fontSize:12,fontWeight:900,letterSpacing:".16em",color:"#ff9a4c"}}>WORKING NOW</p><button onClick={()=>setSelectedId(data.activeTimer!.repairId)} style={activeJobButton}>Unit {data.activeTimer.unit||"—"} — {data.activeTimer.title}</button><div style={{marginTop:5,color:"#cbd6df",fontSize:12}}>Labor is being allocated to this repair automatically.</div></div><span style={timerStyle}>{duration(data.activeTimer.startedAt,now)}</span></section>}

    <section style={{marginTop:22,display:"flex",gap:10,flexWrap:"wrap"}}><button onClick={()=>setView("mine")} style={view==="mine"?activeTab:tabButton}>My Units ({mineGroups.length})</button><button onClick={()=>setView("available")} style={view==="available"?activeTab:tabButton}>Available Units ({availableGroups.length})</button><button onClick={()=>setView("all")} style={view==="all"?activeTab:tabButton}>All Open Units ({allGroups.length})</button></section>

    {workspaceRepair&&data&&<section style={workspaceStyle}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",flexWrap:"wrap"}}><div><p style={eyebrow}>UNIT WORKSPACE</p><h2 style={{margin:"6px 0 4px",fontSize:28}}>Unit {workspaceRepair.unit||"—"}</h2><div style={{color:"#667482"}}>{unitRepairs.length} open repair{unitRepairs.length===1?"":"s"} · {prettyYard(workspaceRepair.yard)} inventory</div></div>{data.activeTimer&&activeRepair&&sameUnit(activeRepair,workspaceRepair)&&<button disabled={busy} onClick={()=>void doneUnit()} style={doneUnitButton}>DONE WORKING ON UNIT</button>}</div>

      <div style={{marginTop:16,display:"grid",gap:9}}>{unitRepairs.map(repair=>{const state=lineState(repair,data.activeTimer?.repairId),rowMine=repair.technicianId===data.user.technicianId&&data.user.technicianId!==null,rowAvailable=repair.technicianId===null,clickable=rowMine||rowAvailable||repair.id===data.activeTimer?.repairId;return <button key={repair.id} disabled={busy||!clickable} onClick={()=>void chooseRepair(repair)} style={{...repairRow,...(state==="WORKING NOW"?workingRow:state==="WAITING ON PART"?waitingRow:{})}}><div style={{minWidth:0,textAlign:"left"}}><strong style={{display:"block",fontSize:17,color:"#172431"}}>{repair.issue}</strong><span style={{display:"block",marginTop:3,fontSize:12,color:"#687783"}}>{rowAvailable?"Unassigned":`Assigned to ${repair.assignedTo||"technician"}`} · {repair.laborHours.toFixed(2)} hr logged</span></div><span style={state==="WORKING NOW"?workingBadge:state==="WAITING ON PART"?waitingBadge:openBadge}>{state}</span></button>})}</div>

      {selected&&sameUnit(selected,workspaceRepair)&&(()=>{const running=data.activeTimer?.repairId===selected.id,repairMine=selected.technicianId===data.user.technicianId&&data.user.technicianId!==null,repairAvailable=selected.technicianId===null,canStart=!data.activeTimer&&Boolean(data.user.technicianId)&&(repairMine||repairAvailable);return <div style={{marginTop:20,paddingTop:18,borderTop:"1px solid #e0e5e9"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}><div><p style={eyebrow}>{running?"WORKING NOW":"SELECTED REPAIR"}</p><h3 style={{margin:"6px 0 4px",fontSize:23}}>{selected.issue}</h3><div style={{color:"#667482",fontSize:13}}>{selected.location||"No location"} · {lineState(selected,data.activeTimer?.repairId)}</div></div>{canStart&&<button disabled={busy} onClick={()=>void startUnit(selected)} style={startUnitButton}>START WORKING ON UNIT</button>}</div>

        {running&&<><div style={outcomeGrid}><button disabled={busy} onClick={()=>void reportOutcome("repaired",selected)} style={repairedButton}>REPAIRED<span>Save labor · close this repair · continue</span></button><button disabled={busy} onClick={()=>void reportOutcome("waiting_part",selected)} style={waitingButton}>WAITING ON PART<span>Save labor · update Parts Desk · continue</span></button><button disabled={busy} onClick={()=>void reportOutcome("skip",selected)} style={skipButton}>SKIP FOR NOW<span>Save labor · leave open · continue</span></button><FoundRepairControl repairId={selected.id} unit={selected.unit} onAdded={load}/></div>
          {needPart&&<div style={partPrompt}><div><strong>What part is needed?</strong><div style={{fontSize:12,color:"#6c7882",marginTop:2}}>Only the part and quantity are required.</div></div><select value={partId} onChange={event=>setPartId(event.target.value)} style={inputStyle} disabled={busy}><option value="">Search / select part</option>{data.parts.map(part=><option key={part.id} value={part.id}>{part.partNumber} — {part.description} ({numberText(availabilityFor(part,selected))} available)</option>)}</select><input aria-label="Part quantity" type="number" min="0.01" step="any" value={partQuantity} onChange={event=>setPartQuantity(Number(event.target.value))} style={inputStyle} disabled={busy}/><button disabled={busy} onClick={()=>void submitWaitingPart(selected)} style={promptDoneButton}>DONE</button></div>}</>}

        {repairMine&&<MaintenanceChecklistPanel repairId={selected.id} canWork={!data.activeTimer||running}/>} 

        <div style={{marginTop:20,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(310px,1fr))",gap:16}}><div style={workspaceCard}><h3 style={workspaceHeading}>Parts</h3>
          {selectedRequests.length>0&&<div style={{display:"grid",gap:7,marginBottom:12}}>{selectedRequests.map(request=><div key={request.id} style={requestRow}><div><strong>{request.partNumber}</strong><div style={{fontSize:11,color:"#667482"}}>{request.description}</div></div><div style={{fontSize:11,color:"#5f6f7d"}}>{numberText(request.reservedQuantity)} reserved · {numberText(request.shortageQuantity)} awaiting</div>{repairMine&&request.reservedQuantity>0&&<button disabled={busy} onClick={()=>void useReserved(request)} style={smallUseButton}>Use Reserved</button>}</div>)}</div>}
          {selected.plannedParts.length>0&&<div style={plannedBox}><strong>PM Kit · Planned Parts</strong><div style={{display:"grid",gap:7,marginTop:8}}>{selected.plannedParts.map(planned=>{const remaining=Math.max(0,planned.quantity-planned.usedQuantity);return <div key={planned.id} style={plannedRow}><div><strong>{planned.partNumber} · {numberText(remaining)} remaining</strong><div style={{fontSize:11,color:"#6f7d88"}}>{planned.description}</div></div>{repairMine&&remaining>0&&<button disabled={busy} onClick={()=>void usePlannedPart(selected,planned)} style={smallUseButton}>Use / Request</button>}</div>})}</div></div>}
          <div style={{marginTop:12}}><strong style={sectionLabel}>Parts Actually Used</strong>{selected.usedParts.length?selected.usedParts.map(part=><span key={part.partId} style={chip}>{part.partNumber} × {numberText(part.quantity)}</span>):<span style={mutedText}>No parts used yet.</span>}</div>
          {repairMine&&<div style={{marginTop:12,display:"grid",gridTemplateColumns:"minmax(160px,1fr) 90px auto",gap:8}}><select value={partId} onChange={event=>setPartId(event.target.value)} style={inputStyle} disabled={busy}><option value="">Choose / request part</option>{data.parts.map(part=><option key={part.id} value={part.id}>{part.partNumber} — {part.description} ({numberText(availabilityFor(part,selected))} available)</option>)}</select><input type="number" min="0.01" step="any" value={partQuantity} onChange={event=>setPartQuantity(Number(event.target.value))} style={inputStyle} disabled={busy}/><button disabled={busy} onClick={()=>void addPartToRepair(selected)} style={secondaryButton}>Use / Request</button></div>}
        </div><div style={workspaceCard}><h3 style={workspaceHeading}>Labor</h3><strong style={{display:"block",fontSize:25}}>{selected.laborHours.toFixed(2)} hours logged</strong>{running&&data.activeTimer&&<div style={{marginTop:8,fontWeight:900,color:"#a94a08"}}>Current repair: {duration(data.activeTimer.startedAt,now)}</div>}<div style={{marginTop:10,display:"grid",gap:5}}>{selected.laborEntries.slice(0,8).map(entry=><div key={entry.id} style={{fontSize:12,color:"#657383"}}>{entry.laborDate} · {entry.technician} · {entry.hours.toFixed(2)} hr{entry.notes?` · ${entry.notes}`:""}</div>)}{!selected.laborEntries.length&&<span style={mutedText}>Saved labor segments will appear here.</span>}</div></div></div>
      </div>})()}
    </section>}

    <section style={{marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(330px,1fr))",gap:14}}>{visibleGroups.map(group=>{const runningRepair=group.repairs.find(repair=>data?.activeTimer?.repairId===repair.id)??null,totalHours=group.repairs.reduce((sum,repair)=>sum+repair.laborHours,0),firstWorkable=group.repairs.find(repair=>repair.technicianId===data?.user.technicianId||repair.technicianId===null)??group.repairs[0];return <article key={group.key} style={{...unitCard,border:runningRepair?"2px solid #f47b20":"1px solid #dce2e7"}}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline"}}><strong style={{fontSize:18}}>UNIT {group.unit||"—"}</strong><span style={{fontSize:12,fontWeight:900,color:"#5d6975"}}>{group.repairs.length} OPEN</span></div><div style={{marginTop:5,color:"#667482",fontSize:12}}>{totalHours.toFixed(2)} total labor hours</div><div style={{marginTop:12,display:"grid",gap:7}}>{group.repairs.map(repair=><div key={repair.id} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"9px 0",borderTop:"1px solid #edf0f2"}}><span style={{fontWeight:800}}>{repair.issue}</span><span style={lineState(repair,data?.activeTimer?.repairId)==="WAITING ON PART"?waitingBadge:lineState(repair,data?.activeTimer?.repairId)==="WORKING NOW"?workingBadge:openBadge}>{lineState(repair,data?.activeTimer?.repairId)}</span></div>)}</div>{runningRepair?<button onClick={()=>setSelectedId(runningRepair.id)} style={unitButton}>OPEN UNIT WORKSPACE</button>:!data?.activeTimer&&firstWorkable&&data?.user.technicianId?<button disabled={busy} onClick={()=>void startUnit(firstWorkable)} style={startUnitWide}>START WORKING ON UNIT</button>:<button onClick={()=>setSelectedId(firstWorkable?.id??null)} style={unitButton}>VIEW UNIT</button>}</article>})}{data&&!visibleGroups.length&&<div style={emptyState}>No units in this view.</div>}</section>
  </main>
}

const noticeStyle={marginTop:18,padding:12,borderRadius:10,background:"#fff8e6",border:"1px solid #f2c66d"} as const;
const readySection={marginTop:16,padding:15,border:"2px solid #62a77d",borderRadius:12,background:"#f0fbf4"} as const;
const readyButton={border:"1px solid #8abd9b",borderRadius:999,padding:"7px 10px",background:"white",color:"#176440",fontWeight:900,cursor:"pointer",fontSize:11} as const;
const workingBanner={marginTop:20,background:"#0d1b2b",color:"white",borderRadius:14,padding:20,display:"flex",justifyContent:"space-between",gap:20,alignItems:"center",flexWrap:"wrap" as const} as const;
const activeJobButton={display:"block",border:0,padding:0,background:"transparent",color:"white",textAlign:"left" as const,fontSize:22,fontWeight:900,cursor:"pointer"} as const;
const timerStyle={fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",fontSize:28,fontWeight:900} as const;
const tabButton={border:"1px solid #cdd5dc",borderRadius:999,padding:"9px 14px",background:"white",color:"#283645",fontWeight:800,cursor:"pointer"} as const;
const activeTab={...tabButton,background:"#0d1b2b",borderColor:"#0d1b2b",color:"white"} as const;
const workspaceStyle={marginTop:18,background:"white",border:"1px solid #d6dde3",borderRadius:15,padding:20,boxShadow:"0 8px 30px #12202f12"} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:900,letterSpacing:".14em"} as const;
const doneUnitButton={border:"1px solid #9ca9b3",borderRadius:10,padding:"11px 14px",background:"white",color:"#253440",fontWeight:900,cursor:"pointer"} as const;
const repairRow={width:"100%",display:"grid",gridTemplateColumns:"minmax(180px,1fr) auto",gap:14,alignItems:"center",padding:"14px 15px",border:"1px solid #dde3e8",borderRadius:11,background:"#fbfcfd",cursor:"pointer",textAlign:"left" as const} as const;
const workingRow={border:"3px solid #f47b20",background:"#fff6ef",boxShadow:"0 5px 18px #f47b2020"} as const;
const waitingRow={border:"2px solid #e3ba69",background:"#fff9ed"} as const;
const workingBadge={display:"inline-flex",padding:"7px 10px",borderRadius:999,background:"#f47b20",color:"white",fontWeight:900,fontSize:11,whiteSpace:"nowrap" as const} as const;
const waitingBadge={display:"inline-flex",padding:"7px 10px",borderRadius:999,background:"#fff0c8",color:"#80520a",fontWeight:900,fontSize:11,whiteSpace:"nowrap" as const} as const;
const openBadge={display:"inline-flex",padding:"7px 10px",borderRadius:999,background:"#edf1f4",color:"#53616d",fontWeight:900,fontSize:11,whiteSpace:"nowrap" as const} as const;
const startUnitButton={border:0,borderRadius:10,padding:"12px 16px",background:"#f47b20",color:"white",fontWeight:900,cursor:"pointer"} as const;
const outcomeGrid={marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:10} as const;
const outcomeBase={border:0,borderRadius:12,padding:"16px",fontWeight:900,fontSize:16,cursor:"pointer",textAlign:"left" as const} as const;
const repairedButton={...outcomeBase,background:"#16784c",color:"white"} as const;
const waitingButton={...outcomeBase,background:"#f0ad2d",color:"#2c261b"} as const;
const skipButton={...outcomeBase,background:"#e8edf1",color:"#253440"} as const;
const partPrompt={marginTop:12,padding:13,border:"2px solid #e1b256",borderRadius:11,background:"#fff9ed",display:"grid",gridTemplateColumns:"minmax(180px,1.4fr) minmax(180px,2fr) 90px auto",gap:8,alignItems:"end"} as const;
const inputStyle={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #ccd4db",borderRadius:8,background:"white",color:"#182331"} as const;
const promptDoneButton={border:0,borderRadius:9,padding:"11px 14px",background:"#0d1b2b",color:"white",fontWeight:900,cursor:"pointer"} as const;
const workspaceCard={border:"1px solid #e0e5e9",borderRadius:11,padding:15,background:"#fbfcfd"} as const;
const workspaceHeading={margin:"0 0 11px",color:"#0d1b2b",fontSize:17} as const;
const requestRow={display:"grid",gridTemplateColumns:"minmax(150px,1fr) auto auto",gap:9,alignItems:"center",padding:"9px 10px",border:"1px solid #e3ba69",borderRadius:8,background:"#fff9ed"} as const;
const smallUseButton={border:"1px solid #81ad8f",borderRadius:7,padding:"7px 9px",background:"#e9f7ed",color:"#176440",fontWeight:900,fontSize:11,cursor:"pointer"} as const;
const plannedBox={padding:12,borderRadius:10,background:"#fff9ed",border:"1px solid #ebc986"} as const;
const plannedRow={display:"grid",gridTemplateColumns:"minmax(160px,1fr) auto",gap:8,alignItems:"center",padding:"8px 9px",borderRadius:8,background:"white",border:"1px solid #eadcc3"} as const;
const sectionLabel={display:"block",marginBottom:6,color:"#52616c",fontSize:11,textTransform:"uppercase" as const,letterSpacing:".05em"} as const;
const chip={display:"inline-block",padding:"5px 8px",borderRadius:999,background:"#eef2f5",fontSize:12,margin:"0 5px 5px 0"} as const;
const mutedText={color:"#7b8792",fontSize:13} as const;
const secondaryButton={border:"1px solid #cbd3da",borderRadius:9,padding:"9px 12px",background:"#f7f9fa",color:"#182331",fontWeight:800,cursor:"pointer"} as const;
const unitCard={background:"white",borderRadius:13,padding:18,boxShadow:"0 4px 18px #12202f0d"} as const;
const unitButton={width:"100%",marginTop:12,border:"1px solid #cbd3da",borderRadius:9,padding:"10px 12px",background:"white",color:"#182331",fontWeight:900,cursor:"pointer"} as const;
const startUnitWide={...unitButton,background:"#f47b20",borderColor:"#f47b20",color:"white"} as const;
const emptyState={gridColumn:"1 / -1",background:"white",border:"1px dashed #cbd4dc",borderRadius:13,padding:34,textAlign:"center" as const,color:"#667482"} as const;