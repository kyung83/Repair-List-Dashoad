"use client";

import { useEffect, useMemo, useState } from "react";
import ModuleTabs from "../../module-tabs";

type Repair = {
  id:string;
  issue:string;
  status:string;
  laborHours:number;
  laborCost:number;
  partCost:number;
  outsideCost:number;
  totalCost:number;
};
type LaborEntry = {
  repairId:string;
  repairIssue:string;
  id:number;
  technician:string;
  laborDate:string;
  hours:number;
  rate:number;
  amount:number;
  notes:string;
  startedAt?:string;
  endedAt?:string;
};
type UsedPart = {
  usageId:number;
  repairId:string;
  repairIssue:string;
  partNumber:string;
  description:string;
  quantity:number;
  unitCost:number;
  lineCost:number;
  costRecorded:boolean;
};
type TechnicianNote = {
  repairId:string;
  repairIssue:string;
  id:number;
  technician:string;
  detail:string;
  createdAt:string;
};
type ReviewPackage = {
  id:string;
  repairIds:string[];
  unit:string;
  technician:string;
  completionDate:string;
  completedAt:string;
  reviewed:boolean;
  reviewedAt:string;
  reviewedBy:string;
  reviewNote:string;
  repairs:Repair[];
  technicianNotes:TechnicianNote[];
  laborEntries:LaborEntry[];
  usedParts:UsedPart[];
  missingPartCostLines:number;
  laborHours:number;
  laborCost:number;
  partCost:number;
  outsideCost:number;
  totalCost:number;
};
type WorkOrderData = {
  reviewPackages:ReviewPackage[];
  updatedAt:string;
};

function money(value:number){
  return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:2});
}
function dateTime(value:string){
  if(!value)return "—";
  const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();
}
function timeOnly(value:string|undefined){
  if(!value)return "";
  const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
}
function workOrderNumber(item:ReviewPackage){
  return item.repairIds.map((id)=>id.replace(/^repair-/,"R-")).join(" / ") || item.id;
}

export default function PrintWorkOrdersPage(){
  const[data,setData]=useState<WorkOrderData|null>(null);
  const[selectedId,setSelectedId]=useState("");
  const[query,setQuery]=useState("");
  const[message,setMessage]=useState("");

  useEffect(()=>{
    let cancelled=false;
    void fetch("/api/work-orders",{cache:"no-store"})
      .then(async(response)=>{
        const payload=await response.json() as WorkOrderData&{error?:string};
        if(!response.ok)throw new Error(payload.error||"Unable to load completed work orders.");
        if(cancelled)return;
        setData(payload);
        const requested=new URLSearchParams(window.location.search).get("id")||"";
        const preferred=payload.reviewPackages.find((item)=>item.id===requested)?.id||payload.reviewPackages[0]?.id||"";
        setSelectedId(preferred);
      })
      .catch((error:unknown)=>{if(!cancelled)setMessage(error instanceof Error?error.message:"Unable to load completed work orders.");});
    return()=>{cancelled=true;};
  },[]);

  const visible=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return (data?.reviewPackages??[]).filter((item)=>!needle||[
      item.unit,item.technician,item.completedAt,item.reviewedBy,item.reviewNote,workOrderNumber(item),
      ...item.repairs.map((repair)=>repair.issue),
      ...item.usedParts.flatMap((part)=>[part.partNumber,part.description]),
    ].join(" ").toLowerCase().includes(needle));
  },[data,query]);
  const selected=(data?.reviewPackages??[]).find((item)=>item.id===selectedId)??null;

  function choose(id:string){
    setSelectedId(id);
    const url=new URL(window.location.href);
    url.searchParams.set("id",id);
    window.history.replaceState(null,"",`${url.pathname}${url.search}`);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  return <main className="work-order-print-shell">
    <style>{printCss}</style>
    <div className="work-order-print-controls">
      <ModuleTabs module="shop"/>
      <header className="print-control-header">
        <div>
          <p className="eyebrow">WORK ORDER PRINTING</p>
          <h1>Print completed work orders</h1>
          <p>Select a completed work order below. The printout uses the full printable area of a US Letter sheet and includes repairs, notes, labor, parts and totals.</p>
        </div>
        <button type="button" className="primary-button" disabled={!selected} onClick={()=>window.print()}>PRINT SELECTED WORK ORDER</button>
      </header>
      {message&&<div className="notice">{message}</div>}
      <div className="selector-grid">
        <aside className="work-order-picker">
          <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search unit, repair, technician, part..." />
          <div className="picker-count">{visible.length} completed work order{visible.length===1?"":"s"}</div>
          <div className="picker-list">
            {visible.map((item)=><button key={item.id} type="button" className={item.id===selectedId?"selected":""} onClick={()=>choose(item.id)}>
              <strong>Unit {item.unit||"—"}</strong>
              <span>{dateTime(item.completedAt)}</span>
              <span>{item.technician||"Unassigned"} · {item.repairs.length} repair{item.repairs.length===1?"":"s"}</span>
              <span>{workOrderNumber(item)} · {money(item.totalCost)}</span>
            </button>)}
            {!visible.length&&<div className="empty-picker">No completed work orders match the search.</div>}
          </div>
        </aside>
        <div className="screen-preview-note">
          <strong>Print preview</strong>
          <span>This preview is proportioned as an 8.5 × 11 inch Letter sheet. Printing removes the screen controls and expands the work order to the printer's full available Letter page.</span>
        </div>
      </div>
    </div>

    {selected?<WorkOrderSheet item={selected}/>:<div className="work-order-print-sheet print-empty">Choose a completed work order to preview and print.</div>}
  </main>;
}

function WorkOrderSheet({item}:{item:ReviewPackage}){
  return <article className="work-order-print-sheet">
    <header className="sheet-header">
      <img src="/northern-logistics-logo-exact.svg?v=1" alt="Northern Logistics Worldwide" />
      <div className="sheet-title">
        <div className="sheet-kicker">MAINTENANCE</div>
        <h2>WORK ORDER</h2>
        <div className="work-order-number">{workOrderNumber(item)}</div>
      </div>
    </header>

    <section className="identity-grid print-block">
      <Info label="Unit" value={item.unit||"—"} strong/>
      <Info label="Completed" value={dateTime(item.completedAt)}/>
      <Info label="Technician" value={item.technician||"Unassigned"}/>
      <Info label="Review status" value={item.reviewed?"REVIEWED":"NEEDS REVIEW"}/>
      <Info label="Reviewed by" value={item.reviewedBy||"—"}/>
      <Info label="Reviewed at" value={dateTime(item.reviewedAt)}/>
    </section>

    <PrintSection title="Repairs completed">
      <table className="print-table repairs-table">
        <thead><tr><th>Repair</th><th>Description</th><th>Status</th><th>Labor</th><th>Parts</th><th>Outside</th><th>Total</th></tr></thead>
        <tbody>{item.repairs.map((repair)=><tr key={repair.id}>
          <td className="nowrap">{repair.id.replace(/^repair-/,"R-")}</td>
          <td>{repair.issue}</td>
          <td>{repair.status}</td>
          <td className="num">{repair.laborHours.toFixed(2)} hr<br/><small>{money(repair.laborCost)}</small></td>
          <td className="num">{money(repair.partCost)}</td>
          <td className="num">{money(repair.outsideCost)}</td>
          <td className="num"><strong>{money(repair.totalCost)}</strong></td>
        </tr>)}</tbody>
      </table>
    </PrintSection>

    <PrintSection title="Technician repair notes">
      {item.technicianNotes.length?<div className="notes-list">{item.technicianNotes.map((note)=><div className="note-row" key={note.id}>
        <div className="note-meta"><strong>{note.technician||"Technician"}</strong><span>{dateTime(note.createdAt)}</span><span>{note.repairId.replace(/^repair-/,"R-")}</span></div>
        <div className="note-detail">{note.detail}</div>
      </div>)}</div>:<div className="empty-section">No technician repair notes recorded.</div>}
    </PrintSection>

    <PrintSection title="Labor">
      {item.laborEntries.length?<table className="print-table">
        <thead><tr><th>Date / time</th><th>Repair</th><th>Technician</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Labor note</th></tr></thead>
        <tbody>{item.laborEntries.map((entry)=>{
          const start=timeOnly(entry.startedAt);const end=timeOnly(entry.endedAt);const range=start&&end?`${start}–${end}`:start?`Started ${start}`:end?`Ended ${end}`:"";
          return <tr key={entry.id}><td className="nowrap">{entry.laborDate}{range&&<small>{range}</small>}</td><td>{entry.repairId.replace(/^repair-/,"R-")}</td><td>{entry.technician||"—"}</td><td className="num">{Number(entry.hours||0).toFixed(2)}</td><td className="num">{money(entry.rate)}</td><td className="num">{money(entry.amount)}</td><td>{entry.notes||entry.repairIssue||"—"}</td></tr>;
        })}</tbody>
      </table>:<div className="empty-section">No labor entries recorded.</div>}
    </PrintSection>

    <PrintSection title="Parts applied">
      {item.usedParts.length?<table className="print-table">
        <thead><tr><th>Part number</th><th>Description</th><th>Repair</th><th>Qty</th><th>Unit cost</th><th>Line total</th></tr></thead>
        <tbody>{item.usedParts.map((part)=><tr key={part.usageId}><td className="nowrap"><strong>{part.partNumber}</strong></td><td>{part.description}</td><td>{part.repairId.replace(/^repair-/,"R-")}</td><td className="num">{part.quantity}</td><td className="num">{part.costRecorded?money(part.unitCost):"Cost missing"}</td><td className="num">{part.costRecorded?money(part.lineCost):"—"}</td></tr>)}</tbody>
      </table>:<div className="empty-section">No parts were recorded on this work order.</div>}
      {item.missingPartCostLines>0&&<div className="cost-warning">{item.missingPartCostLines} part line{item.missingPartCostLines===1?" is":"s are"} missing recorded cost.</div>}
    </PrintSection>

    <section className="sheet-bottom print-block">
      <div className="review-box">
        <div className="section-title">Manager review</div>
        <div className="review-note">{item.reviewNote||"No manager review note recorded."}</div>
        <div className="signature-grid"><span>Reviewed by: <strong>{item.reviewedBy||"________________________"}</strong></span><span>Date: <strong>{item.reviewedAt?dateTime(item.reviewedAt):"________________"}</strong></span></div>
      </div>
      <div className="totals-box">
        <Total label="Labor" value={`${item.laborHours.toFixed(2)} hr · ${money(item.laborCost)}`}/>
        <Total label="Parts" value={money(item.partCost)}/>
        <Total label="Outside" value={money(item.outsideCost)}/>
        <Total label="WORK ORDER TOTAL" value={money(item.totalCost)} grand/>
      </div>
    </section>

    <footer className="sheet-footer">Northern Logistics Worldwide · Unit {item.unit||"—"} · {workOrderNumber(item)}</footer>
  </article>;
}

function Info({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <div className="info-cell"><span>{label}</span>{strong?<strong className="unit-value">{value}</strong>:<strong>{value}</strong>}</div>;
}
function PrintSection({title,children}:{title:string;children:React.ReactNode}){
  return <section className="sheet-section"><div className="section-title">{title}</div>{children}</section>;
}
function Total({label,value,grand=false}:{label:string;value:string;grand?:boolean}){
  return <div className={grand?"total-row grand":"total-row"}><span>{label}</span><strong>{value}</strong></div>;
}

const printCss=`
.work-order-print-shell{min-height:100vh;background:#eef1f3;padding:28px 32px 70px;color:#17212b;font-family:Arial,Helvetica,sans-serif}.work-order-print-controls{max-width:1500px;margin:0 auto 22px}.print-control-header{display:flex;align-items:flex-end;justify-content:space-between;gap:22px;flex-wrap:wrap}.print-control-header h1{margin:5px 0 0;font-size:30px}.print-control-header p:not(.eyebrow){max-width:860px;margin:7px 0 0;color:#66727d;font-size:13px;line-height:1.45}.eyebrow{margin:0;color:#f47b20;font-size:11px;font-weight:900;letter-spacing:.14em}.primary-button{border:1px solid #172b3e;background:#172b3e;color:white;padding:11px 16px;font-weight:900;cursor:pointer}.primary-button:disabled{opacity:.45;cursor:not-allowed}.notice{margin-top:12px;padding:10px;border:1px solid #dfb65d;background:#fff8e6}.selector-grid{display:grid;grid-template-columns:minmax(360px,620px) minmax(260px,1fr);gap:14px;margin-top:16px}.work-order-picker{border:1px solid #ccd4da;background:#fff;padding:10px}.work-order-picker>input{width:100%;box-sizing:border-box;min-height:38px;border:1px solid #b9c3cb;padding:8px 10px}.picker-count{padding:8px 2px 6px;color:#6b7680;font-size:11px;font-weight:800}.picker-list{max-height:310px;overflow:auto;border-top:1px solid #e1e5e8}.picker-list button{display:grid;grid-template-columns:1.1fr .95fr 1.35fr 1.1fr;gap:8px;width:100%;border:0;border-bottom:1px solid #e5e9ec;background:white;text-align:left;padding:9px;cursor:pointer;font-size:11px;color:#283846}.picker-list button:hover{background:#f5f8fa}.picker-list button.selected{background:#e9f2f8;box-shadow:inset 4px 0 #2d668b}.picker-list button span{color:#64717d}.empty-picker{padding:18px 8px;color:#707b84;font-size:12px}.screen-preview-note{align-self:start;border:1px solid #ccd4da;background:#fff;padding:15px;display:flex;flex-direction:column;gap:6px;font-size:12px;color:#66727d}.screen-preview-note strong{color:#203143;font-size:14px}.work-order-print-sheet{width:8.5in;min-height:11in;box-sizing:border-box;margin:0 auto;background:white;padding:.28in .3in;box-shadow:0 8px 26px rgba(23,39,54,.16);color:#111;font-size:10.5px;line-height:1.3}.print-empty{display:grid;place-items:center;color:#697681;font-size:15px}.sheet-header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #172b3e;padding-bottom:10px}.sheet-header img{width:2.65in;max-height:.7in;object-fit:contain;object-position:left center}.sheet-title{text-align:right}.sheet-kicker{font-size:8px;font-weight:900;letter-spacing:.15em;color:#f47b20}.sheet-title h2{font-size:25px;line-height:1;margin:3px 0 4px;letter-spacing:.04em}.work-order-number{font-size:9px;font-weight:800;color:#47525d}.identity-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:0;border:1px solid #aeb7bf;border-top:0}.info-cell{min-height:42px;padding:6px 8px;border-right:1px solid #c5ccd1;border-top:1px solid #c5ccd1;display:flex;flex-direction:column;justify-content:center}.info-cell:nth-child(3n){border-right:0}.info-cell span{font-size:7.5px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#65717b}.info-cell strong{font-size:10.5px;margin-top:2px}.info-cell .unit-value{font-size:17px}.sheet-section{margin-top:10px}.section-title{background:#172b3e;color:white;padding:5px 7px;font-size:8.5px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.print-table{width:100%;border-collapse:collapse;table-layout:auto}.print-table th{background:#edf0f2;border:1px solid #aeb7bf;padding:4px 5px;text-align:left;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em}.print-table td{border:1px solid #bdc5cb;padding:4px 5px;vertical-align:top}.print-table td small{display:block;margin-top:2px;font-size:7.5px;color:#505c66}.print-table .num{text-align:right;white-space:nowrap}.nowrap{white-space:nowrap}.repairs-table th:nth-child(2){width:39%}.notes-list{border:1px solid #bdc5cb;border-top:0}.note-row{padding:6px 7px;border-top:1px solid #d3d9dd;display:grid;grid-template-columns:1.3in 1fr;gap:8px}.note-row:first-child{border-top:0}.note-meta{display:flex;flex-direction:column;font-size:8px;color:#5f6c76}.note-meta strong{color:#17212b;font-size:9px}.note-detail{white-space:pre-wrap}.empty-section{border:1px solid #bdc5cb;border-top:0;padding:8px;color:#68747e;font-style:italic}.cost-warning{border:1px solid #d7a947;border-top:0;background:#fff7df;padding:5px 7px;font-weight:800}.sheet-bottom{display:grid;grid-template-columns:1fr 2.55in;gap:10px;margin-top:10px}.review-box,.totals-box{border:1px solid #aeb7bf}.review-box .section-title{margin:-1px -1px 0}.review-note{min-height:.45in;padding:7px;white-space:pre-wrap}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;border-top:1px solid #c7ced3;padding:6px 7px;font-size:8.5px}.total-row{display:flex;justify-content:space-between;gap:12px;padding:5px 7px;border-bottom:1px solid #c8cfd4}.total-row.grand{border-bottom:0;background:#172b3e;color:white;font-size:11px;padding:7px}.sheet-footer{margin-top:10px;padding-top:5px;border-top:1px solid #b9c1c7;text-align:center;font-size:7px;color:#68737c;letter-spacing:.04em}
@media(max-width:1050px){.selector-grid{grid-template-columns:1fr}.picker-list button{grid-template-columns:1fr 1fr}.work-order-print-sheet{width:100%;min-height:0}.work-order-print-shell{padding:20px 14px 60px}}
@page{size:Letter portrait;margin:.18in}
@media print{
  html,body{margin:0!important;padding:0!important;background:#fff!important;width:auto!important;min-width:0!important}
  .easy-nav,.work-order-print-controls{display:none!important}
  .work-order-print-shell{min-height:0!important;background:#fff!important;padding:0!important;margin:0!important}
  .work-order-print-sheet{width:100%!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;font-size:9.5px!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .sheet-header{padding-bottom:7px!important}.sheet-header img{width:2.45in!important}.sheet-title h2{font-size:23px!important}.identity-grid{grid-template-columns:1.15fr 1fr 1fr!important}.sheet-section{margin-top:7px!important}.section-title{padding:4px 6px!important}.print-table th,.print-table td{padding:3px 4px!important}.note-row{padding:4px 6px!important}.sheet-bottom{margin-top:7px!important}.sheet-footer{margin-top:7px!important}
  .print-block,.sheet-section,.note-row,.total-row,tr{break-inside:avoid;page-break-inside:avoid}
  thead{display:table-header-group}
}
`;
