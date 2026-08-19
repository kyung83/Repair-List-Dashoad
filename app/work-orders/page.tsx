"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";
import InlineWorkOrderReviewEditor from "./inline-review-editor";

type PartOption = {
  id:number;
  partNumber:string;
  description:string;
  quantityOnHand:number;
  unitCost:number|null;
  location:string;
};
type UsedPart = {
  usageId:number;
  repairId:string;
  repairIssue:string;
  partId:number;
  partNumber:string;
  description:string;
  quantity:number;
  unitCost:number;
  lineCost:number;
  costRecorded:boolean;
};
type LaborEntry = {
  repairId:string;
  repairIssue:string;
  id:number;
  technicianId:number|null;
  technician:string;
  laborDate:string;
  hours:number;
  rate:number;
  amount:number;
  notes:string;
};
type TechnicianNote = {
  repairId:string;
  repairIssue:string;
  id:number;
  technicianId:number|null;
  technician:string;
  detail:string;
  createdAt:string;
};
type Repair = {
  id:string;
  numericId:number;
  equipmentId:number|null;
  unit:string;
  issue:string;
  status:string;
  assignedTo:string;
  technicianId:number|null;
  location:string;
  laborHours:number;
  laborRate:number;
  laborCost:number;
  partCost:number;
  outsideCost:number;
  totalCost:number;
  completedAt:string;
  reviewedAt:string;
};
type ReviewPackage = {
  id:string;
  repairIds:string[];
  unit:string;
  equipmentId:number|null;
  technician:string;
  technicianId:number|null;
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
  defaultLaborRate:number;
  parts:PartOption[];
  repairs:Repair[];
  reviewPackages:ReviewPackage[];
  summary:{needsReview:number;reviewed:number;openRepairs:number;completedRepairs:number;completedValue:number};
  canApprove:boolean;
  user:{id:number;displayName:string;role:string};
  updatedAt:string;
};
type ReviewFilter="needs"|"reviewed"|"all";

function isComplete(item:Repair){return item.status.toLowerCase().includes("complete");}
function money(value:number){return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:2});}
function dateTime(value:string){if(!value)return "—";const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}

export default function WorkOrdersPage(){
  const [data,setData]=useState<WorkOrderData|null>(null);
  const [message,setMessage]=useState("");
  const [query,setQuery]=useState("");
  const [reviewFilter,setReviewFilter]=useState<ReviewFilter>("needs");
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
  const [saving,setSaving]=useState("");

  async function load(){
    const response=await fetch("/api/work-orders",{cache:"no-store"});
    const payload=await response.json() as WorkOrderData&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Unable to load work orders.");
    setData(payload);
  }

  useEffect(()=>{void load().catch((error:unknown)=>setMessage(error instanceof Error?error.message:"Unable to load work orders."));},[]);

  const visiblePackages=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return (data?.reviewPackages??[]).filter((item)=>{
      if(reviewFilter==="needs"&&item.reviewed)return false;
      if(reviewFilter==="reviewed"&&!item.reviewed)return false;
      if(!needle)return true;
      return [
        item.unit,item.technician,item.completionDate,item.reviewedBy,item.reviewNote,
        ...item.repairs.flatMap((repair)=>[repair.id,repair.issue,repair.status]),
        ...item.technicianNotes.flatMap((note)=>[note.technician,note.detail]),
        ...item.usedParts.flatMap((part)=>[part.partNumber,part.description]),
      ].join(" ").toLowerCase().includes(needle);
    });
  },[data,query,reviewFilter]);

  const openRepairs=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return (data?.repairs??[]).filter((item)=>!isComplete(item)&&(!needle||[item.unit,item.issue,item.assignedTo,item.location].join(" ").toLowerCase().includes(needle)));
  },[data,query]);

  function toggle(id:string){setExpanded((current)=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}

  async function approve(item:ReviewPackage){
    setSaving(item.id);setMessage("");
    try{
      const response=await fetch("/api/work-orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"approveWorkOrder",repairIds:item.repairIds,reviewNote:reviewNotes[item.id]??""})});
      const payload=await response.json() as {error?:string};
      if(!response.ok)throw new Error(payload.error||"Work order could not be approved.");
      setMessage(`Approved completed work order for Unit ${item.unit}.`);
      setReviewNotes((current)=>({...current,[item.id]:""}));
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Work order could not be approved.");}
    finally{setSaving("");}
  }

  const summary=data?.summary??{needsReview:0,reviewed:0,openRepairs:0,completedRepairs:0,completedValue:0};

  return <main style={{minHeight:"100vh",background:"#f3f5f7",padding:"30px 34px 80px",color:"#182331"}}>
    <ModuleTabs module="shop"/>
    <header style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"flex-end",flexWrap:"wrap"}}>
      <div>
        <p style={{margin:0,color:"#f47b20",fontSize:11,fontWeight:900,letterSpacing:".14em"}}>WORK ORDER REVIEW</p>
        <h1 style={{margin:"6px 0 0",fontSize:31}}>Completed work for manager review</h1>
        <p style={{margin:"7px 0 0",color:"#64748b",maxWidth:900,fontSize:13}}>Open a completed work order and correct repair wording, labor, parts and outside cost directly in the review rows before approval.</p>
      </div>
      <div style={{display:"flex",gap:7}}><a href="/repair-board" style={linkButtonStyle}>Repair Board</a><button type="button" onClick={()=>void load()} style={buttonStyle}>Refresh</button></div>
    </header>

    {message&&<div style={{marginTop:12,padding:10,background:"#fff8e6",border:"1px solid #f2c66d",fontSize:12}}>{message}</div>}

    <section style={{marginTop:16,display:"grid",gridTemplateColumns:"repeat(5,minmax(120px,1fr))",border:"1px solid #cfd6db",background:"white"}}>
      <Metric label="Needs review" value={String(summary.needsReview)}/><Metric label="Reviewed" value={String(summary.reviewed)}/><Metric label="Open repairs" value={String(summary.openRepairs)}/><Metric label="Completed repairs" value={String(summary.completedRepairs)}/><Metric label="Completed value" value={money(summary.completedValue)} last/>
    </section>

    <section style={{marginTop:12,border:"1px solid #cfd6db",background:"white"}}>
      <div style={{padding:10,borderBottom:"1px solid #dce2e7",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <strong style={{fontSize:12,marginRight:4}}>COMPLETED WORK ORDERS</strong>
        <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search unit, technician, repair, note, part..." style={{...inputStyle,flex:1,minWidth:280}}/>
        <select value={reviewFilter} onChange={(event)=>setReviewFilter(event.target.value as ReviewFilter)} style={{...inputStyle,width:165}}><option value="needs">Needs review</option><option value="reviewed">Reviewed history</option><option value="all">All completed</option></select>
        <span style={{color:"#6c7886",fontSize:11,minWidth:85,textAlign:"right"}}>{visiblePackages.length} shown</span>
      </div>

      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:1220}}>
        <thead><tr style={headRowStyle}><th style={thStyle}>Unit</th><th style={thStyle}>Completed</th><th style={thStyle}>Technician</th><th style={thStyle}>Repairs</th><th style={thStyle}>Notes</th><th style={thStyle}>Labor</th><th style={thStyle}>Parts</th><th style={thStyle}>Outside</th><th style={thStyle}>Total</th><th style={thStyle}>Review status</th><th style={thStyle}>Review</th></tr></thead>
        <tbody>{visiblePackages.map((item)=>{
          const open=expanded.has(item.id);
          return <Fragment key={item.id}>
            <tr style={{borderTop:"1px solid #e7ebee",background:item.reviewed?"#f8faf9":"#fffdf6"}}>
              <td style={{...tdStyle,fontWeight:900,fontSize:13}}>{item.unit||"—"}</td><td style={tdStyle}>{dateTime(item.completedAt)}</td><td style={tdStyle}><strong>{item.technician||"Unassigned"}</strong></td><td style={tdStyle}>{item.repairs.length}</td><td style={tdStyle}>{item.technicianNotes.length}</td><td style={tdStyle}>{item.laborHours.toFixed(2)} hr<br/><small>{money(item.laborCost)}</small></td><td style={tdStyle}>{item.usedParts.length} line{item.usedParts.length===1?"":"s"}<br/><small>{money(item.partCost)}{item.missingPartCostLines?` · ${item.missingPartCostLines} cost missing`:""}</small></td><td style={tdStyle}>{money(item.outsideCost)}</td><td style={{...tdStyle,fontWeight:900}}>{money(item.totalCost)}</td><td style={tdStyle}><span style={{display:"inline-flex",padding:"3px 7px",border:`1px solid ${item.reviewed?"#9fcab4":"#e7b34e"}`,background:item.reviewed?"#e9f6ef":"#fff4cf",color:item.reviewed?"#176440":"#8a5a00",fontSize:10,fontWeight:900}}>{item.reviewed?"REVIEWED":"NEEDS REVIEW"}</span>{item.reviewed&&<small style={{display:"block",marginTop:3,color:"#64748b"}}>{item.reviewedBy||"Manager"}</small>}</td><td style={tdStyle}><button type="button" onClick={()=>toggle(item.id)} style={buttonStyle}>{open?"Close":"Review"}</button></td>
            </tr>
            {open&&<tr style={{borderTop:"1px solid #e7ebee",background:"#fafbfc"}}><td colSpan={11} style={{padding:14}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(150px,1fr))",gap:10}}><Detail label="Unit" value={item.unit||"—"}/><Detail label="Technician" value={item.technician||"Unassigned"}/><Detail label="Completed" value={dateTime(item.completedAt)}/><Detail label="Labor cost" value={money(item.laborCost)}/><Detail label={item.missingPartCostLines?"Recorded total":"Total cost"} value={money(item.totalCost)}/></div>

              <InlineWorkOrderReviewEditor item={item} canManage={Boolean(data?.canApprove)} defaultLaborRate={data?.defaultLaborRate??0} parts={data?.parts??[]} onChanged={load}/>

              {!item.reviewed&&<div style={{marginTop:12,padding:12,border:"1px solid #e0c47a",background:"#fffaf0"}}><strong style={{fontSize:11}}>MANAGER / ADMIN REVIEW</strong><textarea value={reviewNotes[item.id]??""} onChange={(event)=>setReviewNotes((current)=>({...current,[item.id]:event.target.value}))} placeholder="Optional review note" maxLength={1000} style={{...inputStyle,width:"100%",minHeight:60,marginTop:7,resize:"vertical"}}/>{data?.canApprove?<button type="button" disabled={saving===item.id} onClick={()=>void approve(item)} style={{...buttonStyle,marginTop:7,fontWeight:900}}>{saving===item.id?"Saving...":"APPROVE WORK ORDER"}</button>:<div style={{marginTop:7,fontSize:11,color:"#7a858d"}}>Manager or administrator access is required to approve.</div>}</div>}
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table>{!visiblePackages.length&&<div style={{padding:24,color:"#64748b",textAlign:"center",fontSize:12}}>No completed work orders match this view.</div>}</div>
    </section>

    <section style={{marginTop:14,border:"1px solid #cfd6db",background:"white"}}><div style={{padding:10,borderBottom:"1px solid #dce2e7",fontSize:12,fontWeight:900}}>OPEN REPAIRS — NOT YET COMPLETED</div><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:850}}><thead><tr style={headRowStyle}><th style={thStyle}>Unit</th><th style={thStyle}>Repair</th><th style={thStyle}>Technician</th><th style={thStyle}>Location</th><th style={thStyle}>Labor</th></tr></thead><tbody>{openRepairs.slice(0,100).map((repair)=><tr key={repair.id} style={{borderTop:"1px solid #e7ebee"}}><td style={{...tdStyle,fontWeight:900}}>{repair.unit||"—"}</td><td style={tdStyle}>{repair.issue}</td><td style={tdStyle}>{repair.assignedTo||"Unassigned"}</td><td style={tdStyle}>{repair.location||"—"}</td><td style={tdStyle}>{repair.laborHours.toFixed(2)} hr</td></tr>)}</tbody></table>{!openRepairs.length&&<div style={emptyStyle}>No open repairs match this search.</div>}</div></section>

    <footer style={{marginTop:9,color:"#74808a",fontSize:10,textAlign:"right"}}>{data?`Snapshot updated ${new Date(data.updatedAt).toLocaleString()}`:"Loading work order review..."}</footer>
  </main>;
}

function Metric({label,value,last=false}:{label:string;value:string;last?:boolean}){return <article style={{minHeight:64,padding:"10px 12px",borderRight:last?0:"1px solid #dce2e7"}}><span style={{display:"block",color:"#6f7b84",fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".05em"}}>{label}</span><strong style={{display:"block",marginTop:4,color:"#0d1b2b",fontSize:21}}>{value}</strong></article>;}
function Detail({label,value}:{label:string;value:string}){return <div><span style={{display:"block",color:"#74808a",fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".04em"}}>{label}</span><strong style={{display:"block",marginTop:2,fontSize:11,color:"#263746"}}>{value}</strong></div>;}

const inputStyle={minHeight:34,padding:"6px 8px",border:"1px solid #c7ced3",borderRadius:4,background:"white",color:"#263746"} as const;
const buttonStyle={minHeight:30,padding:"0 9px",border:"1px solid #bcc5cb",borderRadius:4,background:"white",color:"#263746",fontSize:10,fontWeight:900} as const;
const linkButtonStyle={...buttonStyle,display:"inline-flex",alignItems:"center",textDecoration:"none"} as const;
const headRowStyle={background:"#eef1f2",color:"#5b6770",fontSize:9,letterSpacing:".05em",textTransform:"uppercase" as const,textAlign:"left" as const};
const thStyle={padding:"7px 8px",borderRight:"1px solid #d7dde1"} as const;
const tdStyle={padding:"8px",fontSize:11,verticalAlign:"middle"} as const;
const emptyStyle={padding:10,borderTop:"1px solid #edf0f2",color:"#7a858d",fontSize:11} as const;
