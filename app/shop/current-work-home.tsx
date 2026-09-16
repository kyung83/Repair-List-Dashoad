"use client";

import type {ReactNode} from "react";
import MaintenanceChecklistPanel from "./maintenance-checklist-panel";
import FoundRepairControl from "./found-repair-control";
import RepairPhotoControl from "./repair-photo-control";
import TechnicianRepairTools from "./technician-repair-tools-v2";

type UsedPart={partId:number;partNumber:string;description:string;quantity:number};
type PlannedPart={id:number;partId:number;partNumber:string;description:string;quantity:number;usedQuantity:number;kitName:string};
type LaborEntry={id:number;technician:string;laborDate:string;hours:number;rate:number;notes:string};
type Repair={id:string;unit:string;issue:string;status:string;technicianId:number|null;assignedTo:string;laborHours:number;plannedParts:PlannedPart[];usedParts:UsedPart[];laborEntries:LaborEntry[];handoffNote?:string};
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
  onChooseRepair:(repair:Repair)=>void;
  onFoundRepairAdded:()=>void|Promise<void>;
  onUsePlannedPart:(repair:Repair,part:PlannedPart)=>void;
  onUseReservedPart:(request:PartRequest)=>void;
};

function timerStartMs(value:string){const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";return Date.parse(normalized)}
function duration(startedAt:string,now:number){const ms=Math.max(0,now-timerStartMs(startedAt)),total=Math.floor(ms/1000),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function numberText(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function state(repair:Repair,activeId:string){if(repair.id===activeId)return "WORKING NOW";if(repair.status.trim().toLowerCase()==="waiting on part")return "WAITING ON PART";return "OPEN"}

export default function CurrentWorkHome(props:Props){
  const {timer,repair,unitRepairs,requests,technicianId,now,busy}=props;
  const runningTime=duration(timer.startedAt,now);
  const unitHref=`/unit?unit=${encodeURIComponent(repair.unit)}`;
  const repairMine=repair.technicianId===technicianId&&technicianId!==null;
  const otherRepairs=unitRepairs.filter(item=>item.id!==timer.repairId);

  function goToFinalReview(){window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})}

  return <main style={page}>
    <div style={shell}>
      {props.message&&<div style={notice}>{props.message}</div>}

      <section style={unitStrip}>
        <div><span style={crumb}>MY WORK · WORKING NOW</span><a href={unitHref} style={unitLink}>Unit {repair.unit||"—"} ↗</a></div>
        <div style={unitStatus}><strong>REPAIR</strong><span>● Open</span></div>
      </section>

      <section style={workingCard}>
        <div style={{minWidth:0}}><p style={workingEyebrow}>WORKING NOW</p><h1 style={workingUnit}>Unit {timer.unit||repair.unit||"—"}</h1><div style={workingIssue}>{timer.title||repair.issue}</div><div style={tracking}>● &nbsp; Labor is tracking automatically while this unit is open.</div></div>
        <div style={timerStyle}>◷ {runningTime}</div>
      </section>

      <section style={actionGrid}>
        <button disabled={busy} onClick={props.onRepaired} style={repairedButton}><span style={actionIcon}>✓</span><strong>REPAIRED</strong><small>Save labor & close this repair</small></button>
        <button disabled={busy} onClick={props.onDoneWorking} style={doneButton}><span style={actionIcon}>▶▶</span><strong>DONE WORKING</strong><small>Hand off / leave unassigned</small></button>
        <FoundRepairControl repairId={repair.id} unit={repair.unit} onAdded={props.onFoundRepairAdded}/>
      </section>

      {props.handoffPanel}

      <RepairPhotoControl repairId={repair.id} canWork />

      {repairMine&&<TechnicianRepairTools repairId={repair.id} canWork mode="parts"/>}

      {otherRepairs.length>0&&<section style={card}>
        <div style={cardTitleRow}><strong style={cardTitle}>🔧 Other Repairs on This Unit</strong><span style={countBadge}>{otherRepairs.length}</span></div>
        <div style={repairList}>{otherRepairs.map(item=>{const s=state(item,timer.repairId);return <button key={item.id} disabled={busy} onClick={()=>props.onChooseRepair(item)} style={repairRow}><div style={{minWidth:0,textAlign:"left"}}><strong>{item.issue}</strong><div style={repairMeta}>{s} · {item.technicianId===null?"Unassigned":`Assigned to ${item.assignedTo||"technician"}`}</div></div><span style={chevron}>›</span></button>})}</div>
      </section>}

      {repair.handoffNote&&<div style={handoffNotice}><strong>SHIFT HANDOFF</strong><div>{repair.handoffNote}</div></div>}

      {repairMine&&<MaintenanceChecklistPanel repairId={repair.id} canWork>
        <section style={twoCol}>
          <div style={miniCard}><strong style={miniTitle}>Parts Actually Used</strong>{repair.usedParts.length?<div style={chipWrap}>{repair.usedParts.map(part=><span key={part.partId} style={chip}>{part.partNumber} × {numberText(part.quantity)}</span>)}</div>:<div style={empty}>No parts used yet.</div>}
            {requests.length>0&&<div style={requestList}>{requests.map(request=><div key={request.id} style={requestRow}><span><b>{request.partNumber}</b><br/><small>{numberText(request.reservedQuantity)} reserved · {numberText(request.shortageQuantity)} awaiting</small></span>{request.reservedQuantity>0&&<button disabled={busy} onClick={()=>props.onUseReservedPart(request)} style={smallButton}>Use Reserved</button>}</div>)}</div>}
            {repair.plannedParts.length>0&&<div style={requestList}>{repair.plannedParts.map(planned=>{const remaining=Math.max(0,planned.quantity-planned.usedQuantity);return <div key={planned.id} style={requestRow}><span><b>{planned.partNumber}</b><br/><small>{numberText(remaining)} remaining · {planned.description}</small></span>{remaining>0&&<button disabled={busy} onClick={()=>props.onUsePlannedPart(repair,planned)} style={smallButton}>Use / Request</button>}</div>})}</div>}
          </div>
          <div style={miniCard}><strong style={miniTitle}>Labor Summary</strong><div style={laborGrid}><div><span>Current Repair Time</span><strong style={liveTime}>{runningTime}</strong></div><div><span>Total Hours on Unit</span><strong style={hours}>{repair.laborHours.toFixed(2)} hrs</strong></div></div></div>
        </section>
      </MaintenanceChecklistPanel>}

      <nav style={quickTools} aria-label="Current repair tools">
        <a href="/repair-board" style={quickButton}>▣<span>DVIR</span></a>
        <button type="button" onClick={()=>window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})} style={quickButton}>▤<span>Photos</span></button>
        <a href={unitHref} style={quickButton}>◷<span>History</span></a>
        <a href={unitHref} style={quickButton}>▰<span>Unit Info</span></a>
        <button type="button" onClick={goToFinalReview} style={finalButton}>▧<span>Final Review</span></button>
      </nav>
    </div>
  </main>;
}

const page={minHeight:"100vh",background:"#f4f6f8",padding:"18px clamp(10px,2vw,20px) 36px",color:"#13283d"} as const;
const shell={maxWidth:860,margin:"0 auto",display:"grid",gap:12} as const;
const notice={padding:"10px 12px",border:"1px solid #f2c66d",borderRadius:10,background:"#fff8e6",fontSize:13,fontWeight:800} as const;
const unitStrip={display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",padding:"14px 16px",borderRadius:14,background:"white",border:"1px solid #dbe2e8",boxShadow:"0 5px 18px #13283d0b"} as const;
const crumb={display:"block",fontSize:11,fontWeight:900,color:"#617181",letterSpacing:".08em",marginBottom:4} as const;
const unitLink={display:"block",fontSize:27,fontWeight:950,color:"#102a53",textDecoration:"none"} as const;
const unitStatus={display:"grid",justifyItems:"end",gap:5,fontSize:12,color:"#5f6f7d"} as const;
const workingCard={display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",padding:"19px",borderRadius:16,background:"linear-gradient(135deg,#102a43,#0d1b2b)",color:"white",boxShadow:"0 9px 26px #102a432b"} as const;
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
const card={padding:"14px",borderRadius:14,background:"white",border:"1px solid #d8e0e7",boxShadow:"0 4px 15px #13283d09"} as const;
const cardTitleRow={display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:9} as const;
const cardTitle={fontSize:16,color:"#102a53"} as const;
const countBadge={minWidth:24,height:24,borderRadius:999,display:"grid",placeItems:"center",background:"#edf2f6",fontSize:11,fontWeight:950} as const;
const repairList={display:"grid",gap:8} as const;
const repairRow={width:"100%",display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",alignItems:"center",gap:10,padding:"12px",borderRadius:10,border:"1px solid #dce3e8",background:"#fbfcfd",color:"#182331",cursor:"pointer"} as const;
const repairMeta={marginTop:4,fontSize:11,color:"#667482",fontWeight:800} as const;
const chevron={fontSize:28,color:"#102a53"} as const;
const handoffNotice={padding:"12px",border:"1px solid #75a6df",borderRadius:11,background:"#f2f7fd",fontSize:12,color:"#24445f",display:"grid",gap:4} as const;
const twoCol={display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12,marginTop:12} as const;
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
