"use client";

import RepairTeamPanel from './repair-team-panel';

import {useEffect,useState,type ReactNode} from "react";
import MaintenanceChecklistPanel from "./maintenance-checklist-panel";
import FoundRepairControl from "./found-repair-control";
import RepairPhotoControl from "./repair-photo-control";
import TechnicianRepairTools from "./technician-repair-tools-v2";
import CurrentRepairTypeControl from "./current-repair-type-control";
import MechanicUnitHistory from "./mechanic-unit-history";
import LoganPilotAddRepair from "./logan-pilot-add-repair";

type UsedPart={partId:number;partNumber:string;description:string;quantity:number};
type PlannedPart={id:number;partId:number;partNumber:string;description:string;quantity:number;usedQuantity:number;kitName:string};
type LaborEntry={id:number;technician:string;laborDate:string;hours:number;rate:number;notes:string};
type Repair={teamIds?:number[];id:string;unit:string;issue:string;status:string;technicianId:number|null;assignedTo:string;laborHours:number;pullThru:boolean;plannedParts:PlannedPart[];usedParts:UsedPart[];laborEntries:LaborEntry[];handoffNote?:string};
type PartRequest={id:number;repairId:string;partNumber:string;description:string;reservedQuantity:number;shortageQuantity:number};
type Timer={repairId:string;startedAt:string;title:string;unit:string};

type Props={
  timer:Timer;
  repair:Repair;
  unitRepairs:Repair[];
  requests:PartRequest[];
  technicianId:number|null;
  now:number;
  busy:boolean;
  message?:string;
  handoffPanel?:ReactNode;
  onRepaired:()=>void;
  onDoneWorking:()=>void;
  onTeamChanged:()=>void;
  onChooseRepair:(repair:Repair)=>void;
  onFoundRepairAdded:()=>void|Promise<void>;
  pilot?:boolean;
  onUsePlannedPart:(repair:Repair,part:PlannedPart)=>void;
  onUseReservedPart:(request:PartRequest)=>void;
};

function timerStartMs(value:string){const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";return Date.parse(normalized)}
function duration(startedAt:string,now:number){const ms=Math.max(0,now-timerStartMs(startedAt)),total=Math.floor(ms/1000),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function numberText(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function state(repair:Repair,activeId:string){if(repair.id===activeId)return "WORKING NOW";if(repair.status.trim().toLowerCase()==="waiting on part")return "WAITING ON PART";return "OPEN"}

export default function CurrentWorkHome(props:Props){
  const {timer,repair,unitRepairs,requests,technicianId,now,busy}=props;
  const pilot=Boolean(props.pilot);
  const [pilotTool,setPilotTool]=useState<"notes"|"parts"|"photos"|"checklist"|"history">("notes");
  const [closeBlock,setCloseBlock]=useState<{reason:string;message:string}|null>(null);
  const runningTime=duration(timer.startedAt,now);
  const noUnit=!String(repair.unit||timer.unit||"").trim();
  const unitHref=noUnit?"":`/unit?unit=${encodeURIComponent(repair.unit)}`;
  const repairMine=technicianId!==null&&(repair.technicianId===technicianId||(repair.teamIds||[]).includes(technicianId));
  const otherRepairs=unitRepairs.filter(item=>item.id!==timer.repairId);
  const visibleOtherRepairs=noUnit?[]:otherRepairs;

  useEffect(()=>{
    if(!pilot)return;
    setCloseBlock(null);
    const blocked=(event:Event)=>{
      const info=(event as CustomEvent<{repairId?:string;reason?:string;message?:string}>).detail;
      if(!info||info.repairId!==repair.id)return;
      setCloseBlock({reason:info.reason||"server",message:info.message||"Finish the required step before marking this repair REPAIRED."});
      if(info.reason==="repair-type"||info.reason==="checklist"){
        setPilotTool(info.reason==="repair-type"?"notes":"checklist");
        window.requestAnimationFrame(()=>document.getElementById(info.reason==="repair-type"?"current-repair-type":"pilot-panel-checklist")?.scrollIntoView({behavior:"smooth",block:"center"}));
      }else if(info.reason==="tire"){
        window.requestAnimationFrame(()=>document.getElementById("shop-tire-position-required")?.scrollIntoView({behavior:"smooth",block:"center"}));
      }else{
        window.requestAnimationFrame(()=>document.getElementById("pilot-close-guidance")?.scrollIntoView({behavior:"smooth",block:"center"}));
      }
    };
    const updated=(event:Event)=>{
      const info=(event as CustomEvent<{repairId?:string}>).detail;
      if(info?.repairId===repair.id)setCloseBlock(null);
    };
    window.addEventListener("shop-repair-close-blocked",blocked);
    window.addEventListener("shop-repair-close-updated",updated);
    return()=>{
      window.removeEventListener("shop-repair-close-blocked",blocked);
      window.removeEventListener("shop-repair-close-updated",updated);
    };
  },[pilot,repair.id]);

  function goToCloseRequirement(reason:string){
    if(reason==="repair-type"||reason==="checklist"){
      setPilotTool(reason==="repair-type"?"notes":"checklist");
      window.requestAnimationFrame(()=>document.getElementById(reason==="repair-type"?"current-repair-type":"pilot-panel-checklist")?.scrollIntoView({behavior:"smooth",block:"center"}));
    }else if(reason==="tire"){
      document.getElementById("shop-tire-position-required")?.scrollIntoView({behavior:"smooth",block:"center"});
    }else if(reason==="helper"){
      const helpers=document.getElementById("pilot-helper-panel") as HTMLDetailsElement|null;
      if(helpers){helpers.open=true;helpers.scrollIntoView({behavior:"smooth",block:"center"});}
    }
  }

  function goToFinalReview(){window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})}
  const partsAndLaborPanel=(<section style={twoCol}>
          {!noUnit&&<div style={miniCard}><strong style={miniTitle}>Parts Actually Used</strong>{repair.usedParts.length?<div style={chipWrap}>{repair.usedParts.map(part=><span key={part.partId} style={chip}>{part.partNumber} × {numberText(part.quantity)}</span>)}</div>:<div style={empty}>No parts used yet.</div>}
            {requests.length>0&&<div style={requestList}>{requests.map(request=><div key={request.id} style={requestRow}><span><b>{request.partNumber}</b><br/><small>{numberText(request.reservedQuantity)} reserved · {numberText(request.shortageQuantity)} awaiting</small></span>{request.reservedQuantity>0&&<button disabled={busy} onClick={()=>props.onUseReservedPart(request)} style={smallButton}>Use Reserved</button>}</div>)}</div>}
            {repair.plannedParts.length>0&&<div style={requestList}>{repair.plannedParts.map(planned=>{const remaining=Math.max(0,planned.quantity-planned.usedQuantity);return <div key={planned.id} style={requestRow}><span><b>{planned.partNumber}</b><br/><small>{numberText(remaining)} remaining · {planned.description}</small></span>{remaining>0&&<button disabled={busy} onClick={()=>props.onUsePlannedPart(repair,planned)} style={smallButton}>Use / Request</button>}</div>;})}</div>}
          </div>}
          <div style={miniCard}><strong style={miniTitle}>Labor Summary</strong><div style={laborGrid}><div><span>Current {noUnit?"Work":"Repair"} Time</span><strong style={liveTime}>{runningTime}</strong></div><div><span>{pilot?"Saved Labor (excludes current timer)":`Total Hours ${noUnit?"on Work Order":"on Unit"}`}</span><strong style={hours}>{repair.laborHours.toFixed(2)} hrs</strong></div></div></div>
        </section>);
  const maintenanceBlock=repairMine?(<MaintenanceChecklistPanel repairId={repair.id} canWork compact={pilot} showNotes={!pilot}>
    {!pilot&&partsAndLaborPanel}
  </MaintenanceChecklistPanel>):null;

  return <main style={page}>
    <div style={{...shell,...(pilot?{gap:10}:{})}}>
      {props.message&&<div style={notice}>{props.message}</div>}
      {repair.pullThru&&<div style={pullThruNotice}><strong>PULL THRU</strong><span>This unit is coming through the shop. Be ready for it.</span></div>}


      {!pilot&&<section style={unitStrip}>
        <div><span style={crumb}>MY WORK · WORKING NOW</span>{noUnit?<strong style={unitLink}>SHOP / NO UNIT</strong>:<a href={unitHref} style={unitLink}>Unit {repair.unit} ↗</a>}</div>
        <div style={unitStatus}><strong>{noUnit?"SHOP LABOR":"REPAIR"}</strong><span>● Open</span></div>
      </section>}

      <section style={{...workingCard,...(pilot?{padding:"12px 14px",alignItems:"center",flexWrap:"wrap" as const,gap:9}:{})}}>
        <div style={{minWidth:0,flex:"1 1 200px"}}>
          <p style={{...workingEyebrow,...(pilot?{marginBottom:2,fontSize:10,letterSpacing:".07em"}:{})}}>{pilot?"MY WORK · WORKING NOW":"WORKING NOW"}</p>
          {pilot&&!noUnit
            ?<a href={unitHref} style={{...workingUnit,display:"block",color:"white",fontSize:25,textDecoration:"none"}}>Unit {timer.unit||repair.unit} ↗</a>
            :<h1 style={workingUnit}>{noUnit?"SHOP / NO UNIT":`Unit ${timer.unit||repair.unit}`}</h1>}
          <div style={{...workingIssue,...(pilot?{marginTop:3,fontSize:15,lineHeight:1.25}:{})}}>{timer.title||repair.issue}</div>
          {pilot&&<div style={pilotSavedTime}>Current timer is running · {repair.laborHours.toFixed(2)} hrs previously saved on this repair</div>}
          {!pilot&&<div style={tracking}>● &nbsp; Labor is tracking automatically {noUnit?"to you, not to a fleet unit.":"while this unit is open."}</div>}
        </div>
        <div style={{...timerStyle,...(pilot?{fontSize:23}:{})}}>◷ {runningTime}</div>
      </section>




      {pilot&&visibleOtherRepairs.length>0&&<details id="pilot-other-repairs" defaultOpen style={pilotOtherCard}>
        <summary style={pilotOtherSummary}>Other repairs on {repair.unit} <span style={countBadge}>{visibleOtherRepairs.length}</span></summary>
        <div style={pilotOtherList}>{visibleOtherRepairs.map(item=><button key={item.id} type="button" disabled={busy} onClick={()=>props.onChooseRepair(item)} title={item.issue} style={pilotOtherRow}>
          <span style={{minWidth:0,textAlign:"left"}}><strong style={{display:"block",fontSize:12,lineHeight:1.3}}>{item.issue}</strong><span style={repairMeta}>{state(item,timer.repairId)} · {item.technicianId===null?"Unassigned":`Assigned to ${item.assignedTo||"technician"}`}</span></span><span aria-hidden="true">›</span>
        </button>)}</div>
      </details>}
      {pilot?<>{repair.technicianId===technicianId&&technicianId!==null&&<details id="pilot-helper-panel" style={pilotSetupFold}>
        <summary style={pilotSetupSummary}>+ ADD / MANAGE HELPER <span style={pilotSetupHint}>Tap to expand</span></summary>
        <div style={pilotSetupContents}>
          <RepairTeamPanel repairId={repair.id} editable compact onChanged={props.onTeamChanged}/>
        </div>
      </details>}</>:<>
        <RepairTeamPanel repairId={repair.id} editable={repair.technicianId===technicianId&&technicianId!==null} compact={pilot} onChanged={props.onTeamChanged}/>
        {repairMine&&<CurrentRepairTypeControl repairId={repair.id}/>}
      </>}

      {pilot&&<section id="pilot-close-guidance" style={pilotCloseGuide}>
        <strong>REPAIRED — what is required?</strong>
        <span>Choose a Repair Type in Notes, save tire positions if requested, and finish any required checklist. Helpers must stop their own timers first. DONE WORKING saves labor without closing the repair.</span>
        {closeBlock&&<div role="alert" style={pilotCloseError}>
          <strong>Cannot mark repaired yet:</strong> {closeBlock.message}
          {["repair-type","tire","checklist","helper"].includes(closeBlock.reason)&&<button type="button" onClick={()=>goToCloseRequirement(closeBlock.reason)} style={pilotCloseAction}>
            {closeBlock.reason==="repair-type"?"OPEN REPAIR TYPE":closeBlock.reason==="tire"?"GO TO TIRE POSITIONS":closeBlock.reason==="checklist"?"OPEN CHECKLIST":"SHOW HELPERS"}
          </button>}
        </div>}
      </section>}
      <section id={pilot?"pilot-actions":undefined} style={{...actionGrid,gridTemplateColumns:pilot||noUnit?"repeat(2,minmax(0,1fr))":"repeat(3,minmax(0,1fr))",...(pilot?{gap:8}:{})}}>
        <button data-shop-action="repaired" disabled={busy} onClick={props.onRepaired} style={pilot?{...repairedButton,minHeight:82,padding:"10px 8px"}:repairedButton}><span style={pilot?{...actionIcon,fontSize:22}:actionIcon}>✓</span><strong>{noUnit?"DONE":"REPAIRED"}</strong><small>Save labor & close this {noUnit?"work order":"repair"}</small></button>
        <button data-shop-action="done-working" disabled={busy} onClick={props.onDoneWorking} style={pilot?{...doneButton,minHeight:82,padding:"10px 8px"}:doneButton}><span style={pilot?{...actionIcon,fontSize:22}:actionIcon}>▶▶</span><strong>DONE WORKING</strong><small>Keep open / hand off</small></button>
        {!noUnit&&<FoundRepairControl repairId={repair.id} unit={repair.unit} onAdded={props.onFoundRepairAdded}/>}
        {pilot&&<div id="pilot-add-repair" style={{scrollMarginTop:72}}><LoganPilotAddRepair onSaved={props.onFoundRepairAdded}/></div>}
      </section>

      {props.handoffPanel}
      {repair.handoffNote&&pilot&&<div style={handoffNotice}><strong>SHIFT HANDOFF</strong><div>{repair.handoffNote}</div></div>}

      {pilot&&<section id="pilot-workspace" style={pilotWorkspace}>
        <nav aria-label="Work tools" role="tablist" style={pilotNav}>
          {(["notes","parts","photos","checklist","history"] as const).map(tool=><button
            key={tool} id={`pilot-tab-${tool}`} type="button" role="tab" aria-selected={pilotTool===tool} aria-controls={`pilot-panel-${tool}`}
            onClick={()=>setPilotTool(tool)} style={{...pilotNavButton,...(pilotTool===tool?pilotNavSelected:{})}}>
            {tool==="checklist"?"Checklist / Review":tool.charAt(0).toUpperCase()+tool.slice(1)}
          </button>)}
        </nav>
        <div id="pilot-panel-notes" role="tabpanel" aria-labelledby="pilot-tab-notes" hidden={pilotTool!=="notes"} style={{...pilotTabPanel,display:pilotTool==="notes"?"grid":"none"}}>
          {repairMine?<><TechnicianRepairTools repairId={repair.id} canWork mode="notes" compact/><CurrentRepairTypeControl repairId={repair.id}/></>:<div style={empty}>Only assigned repair team members can edit notes.</div>}
        </div>
        <div id="pilot-panel-parts" role="tabpanel" aria-labelledby="pilot-tab-parts" hidden={pilotTool!=="parts"} style={{...pilotTabPanel,display:pilotTool==="parts"?"grid":"none"}}>
          {repairMine&&partsAndLaborPanel}
          {repairMine?<TechnicianRepairTools repairId={repair.id} canWork mode="parts" compact/>:<div style={empty}>Parts access requires an assigned repair.</div>}
        </div>
        <div id="pilot-panel-photos" role="tabpanel" aria-labelledby="pilot-tab-photos" hidden={pilotTool!=="photos"} style={{...pilotTabPanel,display:pilotTool==="photos"?"grid":"none"}}>
          <RepairPhotoControl repairId={repair.id} canWork compact/>
        </div>
        <div id="pilot-panel-checklist" role="tabpanel" aria-labelledby="pilot-tab-checklist" hidden={pilotTool!=="checklist"} style={{...pilotTabPanel,display:pilotTool==="checklist"?"grid":"none"}}>
          {maintenanceBlock??<div style={empty}>Checklist and final review are available to assigned team members.</div>}
        </div>
        <div id="pilot-panel-history" role="tabpanel" aria-labelledby="pilot-tab-history" hidden={pilotTool!=="history"} style={{...pilotTabPanel,display:pilotTool==="history"?"grid":"none"}}>
          {repairMine&&!noUnit?<MechanicUnitHistory repairId={repair.id} unit={repair.unit} currentIssue={repair.issue}/>:<div style={empty}>Unit history is not available for this work order.</div>}
        </div>
      </section>}

      {!pilot&&repairMine&&!noUnit&&<MechanicUnitHistory repairId={repair.id} unit={repair.unit} currentIssue={repair.issue}/>}

      {!pilot&&<RepairPhotoControl repairId={repair.id} canWork />}

      {!pilot&&repairMine&&!noUnit&&<TechnicianRepairTools repairId={repair.id} canWork mode="parts"/>}

      {!pilot&&visibleOtherRepairs.length>0&&<section style={card}>
        <div style={{...cardTitleRow,...(pilot?{marginBottom:6}:{})}}><strong style={cardTitle}>🔧 Other Repairs on This Unit</strong><span style={countBadge}>{visibleOtherRepairs.length}</span></div>
        <div style={{...repairList,...(pilot?{gap:5}:{})}}>{visibleOtherRepairs.map(item=>{const s=state(item,timer.repairId);return <button key={item.id} disabled={busy} onClick={()=>props.onChooseRepair(item)} style={{...repairRow,...(pilot?{padding:"8px 10px",gap:7,borderRadius:8}:{})}} title={item.issue}><div style={{minWidth:0,textAlign:"left"}}><strong style={pilot?{fontSize:13,lineHeight:1.25,display:"block"}:undefined}>{item.issue}</strong><div style={{...repairMeta,...(pilot?{marginTop:2}:{})}}>{s} · {item.technicianId===null?"Unassigned":`Assigned to ${item.assignedTo||"technician"}`}</div></div><span style={{...chevron,...(pilot?{fontSize:20}:{})}}>›</span></button>})}</div>
      </section>}

      {!pilot&&repair.handoffNote&&<div style={handoffNotice}><strong>SHIFT HANDOFF</strong><div>{repair.handoffNote}</div></div>}

      {!pilot&&maintenanceBlock}


      {!noUnit&&<nav style={quickTools} aria-label="Current repair tools">
        <a href="/repair-board" style={quickButton}>▣<span>DVIR</span></a>
        <button type="button" onClick={()=>window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})} style={quickButton}>▤<span>Photos</span></button>
        <button type="button" onClick={()=>document.getElementById("unit-work-history")?.scrollIntoView({behavior:"smooth",block:"start"})} style={quickButton}>◷<span>History</span></button>
        <a href={unitHref} style={quickButton}>▰<span>Unit Info</span></a>
        <button type="button" onClick={goToFinalReview} style={finalButton}>▧<span>Final Review</span></button>
      </nav>}
    </div>
  </main>;
}

const pilotNav={position:"sticky" as const,top:0,zIndex:40,display:"flex",gap:5,overflowX:"auto" as const,padding:"8px",border:"1px solid #cbd9df",borderRadius:11,background:"#f7fafc",boxShadow:"0 4px 12px #102a5314",scrollbarWidth:"thin" as const} as const;
const pilotNavButton={flex:"0 0 auto",padding:"10px 12px",minHeight:44,border:"1px solid #cad5df",borderRadius:9,background:"white",color:"#173f37",fontSize:12,fontWeight:850,cursor:"pointer"} as const;
const pilotNavSelected={background:"#173f37",borderColor:"#173f37",color:"white"} as const;
const pilotWorkspace={display:"grid",gap:8,minWidth:0,alignContent:"start"} as const;
const pilotTabPanel={gap:10,minWidth:0,alignContent:"start",padding:"2px 0"} as const;
const pilotSavedTime={marginTop:6,fontSize:11,color:"#d1e5da",lineHeight:1.35} as const;
const pilotOtherCard={padding:"10px 12px",border:"1px solid #d7e1e6",borderRadius:12,background:"white"} as const;
const pilotOtherSummary={display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,color:"#102a53",fontSize:13,fontWeight:900,cursor:"pointer",minHeight:31} as const;
const pilotOtherList={display:"grid",gap:5,marginTop:8} as const;
const pilotOtherRow={width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:9,padding:"8px 10px",border:"1px solid #dde5eb",borderRadius:8,background:"#f9fbfc",color:"#1b2421",cursor:"pointer"} as const;
const pilotCloseGuide={padding:"9px 11px",border:"1px solid #cbd9df",borderRadius:10,background:"#f7fafc",fontSize:11,color:"#3c5260",display:"grid",gap:4,lineHeight:1.45} as const;
const pilotCloseError={padding:"9px 10px",border:"1px solid #dfb46c",borderRadius:8,background:"#fff7eb",color:"#714514",fontSize:12,fontWeight:700,display:"grid",gap:7} as const;
const pilotCloseAction={justifySelf:"start",border:"1px solid #9fb4c7",background:"white",borderRadius:7,padding:"8px 10px",color:"#173f37",fontSize:11,fontWeight:900,cursor:"pointer"} as const;
const pilotSetupFold={padding:"9px 12px",border:"1px solid #d7e1e6",borderRadius:10,background:"white"} as const;
const pilotSetupSummary={display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,minHeight:30,fontSize:12,fontWeight:900,color:"#173f37",cursor:"pointer"} as const;
const pilotSetupHint={fontSize:11,fontWeight:600,color:"#637783"} as const;
const pilotSetupContents={display:"grid",gap:9,marginTop:10} as const;
const page={minHeight:"100vh",background:"#f4f6f4",padding:"18px clamp(10px,2vw,20px) 36px",color:"#173f37"} as const;
const shell={maxWidth:860,margin:"0 auto",display:"grid",gap:12} as const;
const notice={padding:"10px 12px",border:"1px solid #f2c66d",borderRadius:10,background:"#fff8e6",fontSize:13,fontWeight:800} as const;
const pullThruNotice={display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"12px 14px",border:"2px solid #e98216",borderRadius:12,background:"#fff2df",color:"#8b4a08",fontSize:13,fontWeight:850} as const;
const unitStrip={display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",padding:"14px 16px",borderRadius:14,background:"white",border:"1px solid #dbe2e8",boxShadow:"0 5px 18px #173f370b"} as const;
const crumb={display:"block",fontSize:11,fontWeight:900,color:"#617181",letterSpacing:".08em",marginBottom:4} as const;
const unitLink={display:"block",fontSize:27,fontWeight:950,color:"#102a53",textDecoration:"none"} as const;
const unitStatus={display:"grid",justifyItems:"end",gap:5,fontSize:12,color:"#5f6f7d"} as const;
const workingCard={display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",padding:"19px",borderRadius:16,background:"linear-gradient(135deg,#173f37,#173f37)",color:"white",boxShadow:"0 9px 26px #173f372b"} as const;
const workingEyebrow={margin:"0 0 5px",fontSize:12,fontWeight:950,letterSpacing:".15em",color:"#ff8b32"} as const;
const workingUnit={margin:0,fontSize:30,lineHeight:1.08} as const;
const workingIssue={marginTop:7,fontSize:18,lineHeight:1.25,fontWeight:750} as const;
const tracking={marginTop:9,fontSize:12,color:"#cfdae4"} as const;
const timerStyle={fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",fontSize:26,fontWeight:950,whiteSpace:"nowrap" as const} as const;
const actionGrid={display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10} as const;
const actionBase={minHeight:122,borderRadius:14,padding:"14px 10px",display:"grid",alignContent:"center",justifyItems:"center",gap:5,textAlign:"center" as const,fontWeight:950,cursor:"pointer"} as const;
const repairedButton={...actionBase,border:0,background:"#19945d",color:"white"} as const;
const doneButton={...actionBase,border:"1px solid #c8d8e7",background:"#e9f2fb",color:"#102a53"} as const;
const actionIcon={fontSize:26,lineHeight:1} as const;
const card={padding:"14px",borderRadius:14,background:"white",border:"1px solid #d8e0e7",boxShadow:"0 4px 15px #173f3709"} as const;
const cardTitleRow={display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:9} as const;
const cardTitle={fontSize:16,color:"#102a53"} as const;
const countBadge={minWidth:24,height:24,borderRadius:999,display:"grid",placeItems:"center",background:"#edf2f6",fontSize:11,fontWeight:950} as const;
const repairList={display:"grid",gap:8} as const;
const repairRow={width:"100%",display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",alignItems:"center",gap:10,padding:"12px",borderRadius:10,border:"1px solid #dce3e8",background:"#fbfcfb",color:"#1b2421",cursor:"pointer"} as const;
const repairMeta={marginTop:4,fontSize:11,color:"#68746f",fontWeight:800} as const;
const chevron={fontSize:28,color:"#102a53"} as const;
const handoffNotice={padding:"12px",border:"1px solid #75a6df",borderRadius:11,background:"#f2f7fd",fontSize:12,color:"#24445f",display:"grid",gap:4} as const;
const twoCol={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12,marginTop:12} as const;
const miniCard={padding:"14px",borderRadius:13,background:"white",border:"1px solid #d8e0e7",minWidth:0} as const;
const miniTitle={display:"block",fontSize:15,color:"#102a53",marginBottom:9} as const;
const empty={fontSize:12,color:"#7a8791"} as const;
const chipWrap={display:"flex",flexWrap:"wrap" as const,gap:6} as const;
const chip={padding:"6px 8px",borderRadius:999,background:"#eef2f5",fontSize:11,fontWeight:800} as const;
const requestList={display:"grid",gap:7,marginTop:9} as const;
const requestRow={display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",fontSize:11,padding:"8px",borderRadius:8,background:"#f7f9fb"} as const;
const smallButton={border:"1px solid #94b5a0",borderRadius:7,padding:"7px 8px",background:"#eef8f1",color:"#176440",fontSize:10,fontWeight:950,cursor:"pointer"} as const;
const laborGrid={display:"grid",gridTemplateColumns:"1fr 1fr",gap:10} as const;
const liveTime={display:"block",marginTop:5,fontSize:24,color:"#f06419"} as const;
const hours={display:"block",marginTop:5,fontSize:24,color:"#102a53"} as const;
const quickTools={display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:9} as const;
const quickButton={minHeight:78,border:"1px solid #d4dde5",borderRadius:12,background:"white",color:"#102a53",display:"grid",placeItems:"center",alignContent:"center",gap:5,textDecoration:"none",fontSize:20,fontWeight:950,cursor:"pointer"} as const;
const finalButton={...quickButton,border:"2px solid #ff6b16",color:"#e85f16",background:"#fffaf6"} as const;
