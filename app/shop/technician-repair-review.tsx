"use client";

import {useEffect,useMemo,useState} from "react";
import {createPortal} from "react-dom";
import type {ChecklistData} from "./maintenance-types";

type ReviewNote={id:number;detail:string;technician:string;createdAt:string;canEdit:boolean};
type ReviewPart={partId:number;partNumber:string;description:string;quantity:number;lastAppliedAt:string};
type ReviewLabor={id:number;technician:string;laborDate:string;hours:number;rate:number;notes:string;startedAt:string|null;endedAt:string|null};
type ReviewRequest={id:number;partId:number;partNumber:string;description:string;requestedQuantity:number;reservedQuantity:number;usedQuantity:number;remainingQuantity:number;shortageQuantity:number;status:string;createdAt:string;updatedAt:string};
type ReviewData={ok?:boolean;error?:string;canCorrect:boolean;repair:{id:string;unit:string;title:string;status:string};notes:ReviewNote[];parts:ReviewPart[];labor:ReviewLabor[];requests:ReviewRequest[];updatedAt:string};
type RemoveResult={ok?:boolean;error?:string;partNumber?:string;quantity?:number};
type EditResult={ok?:boolean;error?:string;note?:{id:number;detail:string}};
type Props={repairId:string;canWork:boolean;checklist:ChecklistData|null};

function qty(value:number){
  return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
}

function parseDate(value:string|null|undefined){
  if(!value)return null;
  const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";
  const parsed=Date.parse(normalized);
  return Number.isFinite(parsed)?new Date(parsed):null;
}

function dateTime(value:string|null|undefined){
  const parsed=parseDate(value);
  return parsed?parsed.toLocaleString():value||"";
}

function timeOnly(value:string|null|undefined){
  const parsed=parseDate(value);
  return parsed?parsed.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"";
}

function laborWhen(item:ReviewLabor){
  if(item.startedAt&&item.endedAt){
    const start=parseDate(item.startedAt);
    const day=start?start.toLocaleDateString():item.laborDate;
    return `${day} · ${timeOnly(item.startedAt)}–${timeOnly(item.endedAt)}`;
  }
  return `${item.laborDate} · Manual / no timer timestamp`;
}

export default function TechnicianRepairReview({repairId,canWork,checklist}:Props){
  const[mounted,setMounted]=useState(false),[data,setData]=useState<ReviewData|null>(null),[message,setMessage]=useState(""),[removingPartId,setRemovingPartId]=useState<number|null>(null),[loading,setLoading]=useState(false),[editingNoteId,setEditingNoteId]=useState<number|null>(null),[editDraft,setEditDraft]=useState(""),[savingNoteId,setSavingNoteId]=useState<number|null>(null);

  async function load(){
    setLoading(true);
    try{
      const response=await fetch(`/api/shop/repair-review?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});
      const result=await response.json() as ReviewData;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair review could not be loaded.");
      setData(result);
    }catch(error){setMessage(error instanceof Error?error.message:"Repair review could not be loaded.")}
    finally{setLoading(false)}
  }

  useEffect(()=>{setMounted(true);return()=>setMounted(false)},[]);
  useEffect(()=>{
    setEditingNoteId(null);setEditDraft("");setMessage("");
    void load();
    const interval=window.setInterval(()=>void load(),15000);
    const refresh=(event:Event)=>{
      const detail=(event as CustomEvent<{repairId?:string}>).detail;
      if(!detail?.repairId||detail.repairId===repairId)void load();
    };
    window.addEventListener("repair-review-refresh",refresh);
    return()=>{window.clearInterval(interval);window.removeEventListener("repair-review-refresh",refresh)};
  },[repairId]);

  const totals=useMemo(()=>({
    hours:(data?.labor??[]).reduce((sum,item)=>sum+Number(item.hours||0),0),
    partUnits:(data?.parts??[]).reduce((sum,item)=>sum+Number(item.quantity||0),0),
  }),[data]);

  const openRequests=useMemo(()=>(data?.requests??[]).filter(item=>item.status==="open"&&item.remainingQuantity>0.000001),[data]);
  const checklistCounts=useMemo(()=>{
    const items=checklist?.items??[];
    return {
      pass:items.filter(item=>item.result==="pass").length,
      fail:items.filter(item=>item.result==="fail").length,
      na:items.filter(item=>item.result==="na").length,
      pending:items.filter(item=>item.result==="pending").length,
    };
  },[checklist]);

  function beginEdit(item:ReviewNote){
    if(!item.canEdit)return;
    setEditingNoteId(item.id);setEditDraft(item.detail);setMessage("");
  }

  function cancelEdit(){
    setEditingNoteId(null);setEditDraft("");
  }

  async function saveEditedNote(item:ReviewNote){
    const detail=editDraft.trim();
    if(!item.canEdit||savingNoteId!==null)return;
    if(!detail){setMessage("Repair note cannot be blank.");return}
    setSavingNoteId(item.id);setMessage("");
    try{
      const response=await fetch("/api/shop/repair-review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"editNote",repairId,noteId:item.id,detail})});
      const result=await response.json() as EditResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair note could not be edited.");
      setData(current=>current?{...current,notes:current.notes.map(note=>note.id===item.id?{...note,detail:result.note?.detail??detail}:note)}:current);
      setEditingNoteId(null);setEditDraft("");setMessage("Repair note updated. The edit is kept in the repair audit history.");
    }catch(error){setMessage(error instanceof Error?error.message:"Repair note could not be edited.")}
    finally{setSavingNoteId(null)}
  }

  async function removePart(part:ReviewPart){
    if(!data?.canCorrect||removingPartId!==null)return;
    const confirmed=window.confirm(`Remove ${part.partNumber} × ${qty(part.quantity)} from this repair?\n\nThis will return the part to inventory. The shop screen will refresh afterward so every parts list matches.`);
    if(!confirmed)return;
    setRemovingPartId(part.partId);setMessage("");
    try{
      const response=await fetch("/api/shop/remove-applied-part",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repairId,partId:part.partId})});
      const result=await response.json() as RemoveResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Applied part could not be removed.");
      setData(current=>current?{...current,parts:current.parts.filter(item=>item.partId!==part.partId)}:current);
      setMessage(`${qty(result.quantity??part.quantity)} × ${result.partNumber??part.partNumber} removed and returned to inventory. Refreshing the shop screen…`);
      window.setTimeout(()=>window.location.reload(),500);
    }catch(error){setMessage(error instanceof Error?error.message:"Applied part could not be removed.")}
    finally{setRemovingPartId(null)}
  }

  if(!mounted)return null;

  const panel=<section style={outer}>
    <div style={card}>
      <div style={header}>
        <div><p style={eyebrow}>FINAL CHECK</p><h2 style={title}>Review Before Finishing</h2><div style={sub}>{data?`Unit ${data.repair.unit||"—"} · ${data.repair.title} · ${data.repair.status}`:"Everything recorded on this repair stays visible here."}</div>{!canWork&&data?.canCorrect&&<div style={correctionHint}>You can still correct your saved notes or mistaken parts here even while labor is on another repair.</div>}</div>
        <div style={headerActions}><div style={summary}>{data?.notes.length??0} notes · {qty(totals.partUnits)} parts · {totals.hours.toFixed(2)} saved hr</div><button type="button" onClick={()=>void load()} style={refreshButton} disabled={loading}>{loading?"Refreshing…":"REFRESH REVIEW"}</button></div>
      </div>
      {message&&<div style={notice}>{message}</div>}

      <div style={grid}>
        <div style={sectionCard}>
          <strong style={sectionTitle}>REPAIR NOTES</strong>
          <div style={hint}>Saved notes stay here. Technicians can edit their own notes; managers and admins can correct any note.</div>
          {data?.notes.length?<div style={list}>{data.notes.map(item=><div key={item.id} style={row}>{editingNoteId===item.id?<><textarea value={editDraft} onChange={event=>setEditDraft(event.target.value.slice(0,2000))} rows={4} style={editTextarea} disabled={savingNoteId!==null}/><div style={editActions}><button type="button" onClick={()=>void saveEditedNote(item)} style={saveEditButton} disabled={savingNoteId!==null}>{savingNoteId===item.id?"Saving…":"SAVE EDIT"}</button><button type="button" onClick={cancelEdit} style={cancelEditButton} disabled={savingNoteId!==null}>CANCEL</button></div></>:<><div style={{whiteSpace:"pre-wrap"}}>{item.detail}</div><div style={noteFooter}><div style={meta}>{item.technician} · {dateTime(item.createdAt)}</div>{item.canEdit&&<button type="button" onClick={()=>beginEdit(item)} style={editButton}>EDIT NOTE</button>}</div></>}</div>)}</div>:<div style={empty}>No repair notes saved yet.</div>}
        </div>

        <div style={sectionCard}>
          <strong style={sectionTitle}>PARTS ACTUALLY USED</strong>
          <div style={hint}>This is the live database list. Tap ✕ only if a part was entered by mistake.</div>
          {data?.parts.length?<div style={list}>{data.parts.map(part=><div key={part.partId} style={partRow}><div><strong>{part.partNumber}</strong><div style={description}>{part.description}</div>{part.lastAppliedAt&&<div style={meta}>Applied {dateTime(part.lastAppliedAt)}</div>}</div><div style={partActions}><strong style={partQty}>× {qty(part.quantity)}</strong><button type="button" aria-label={`Remove ${part.partNumber}`} title={data.canCorrect?"Remove mistaken part":"Part corrections are not available on this repair"} onClick={()=>void removePart(part)} style={removeButton} disabled={!data.canCorrect||removingPartId!==null}>{removingPartId===part.partId?"…":"✕"}</button></div></div>)}</div>:<div style={empty}>No parts applied to this repair.</div>}
          {openRequests.length>0&&<div style={requestBox}><strong style={{fontSize:12}}>STILL NEEDED / RESERVED</strong>{openRequests.map(request=><div key={request.id} style={requestRow}><span><strong>{request.partNumber}</strong> · {request.description}</span><span>{qty(request.reservedQuantity)} reserved · {qty(request.shortageQuantity)} awaiting</span></div>)}</div>}
        </div>

        <div style={sectionCard}>
          <strong style={sectionTitle}>LABOR SAVED</strong>
          {data?.labor.length?<div style={list}>{data.labor.map(item=><div key={item.id} style={row}><div><strong>{item.technician}</strong> · {item.hours.toFixed(2)} hr</div><div style={description}>{laborWhen(item)}</div>{item.notes&&<div style={meta}>{item.notes}</div>}</div>)}</div>:<div style={empty}>No saved labor segments yet. The running timer is saved when the technician switches, stops, or finishes.</div>}
        </div>
      </div>

      {checklist?.started&&<div style={checklistCard}>
        <div style={checklistHeader}><div><strong style={sectionTitle}>{checklist.eventType.toUpperCase()} CHECKLIST</strong><div style={hint}>Checklist results already recorded on this repair.</div></div><div style={checklistSummary}>{checklistCounts.pass} pass · {checklistCounts.fail} fail · {checklistCounts.na} N/A · {checklistCounts.pending} pending</div></div>
        <details style={details}><summary style={summaryButton}>VIEW CHECKLIST DETAILS</summary><div style={checklistList}>{checklist.items.map(item=><div key={`${item.number}-${item.id??"new"}`} style={checkRow}><span style={resultBadge(item.result)}>{item.result.toUpperCase()}</span><div><strong>{item.number}. {item.text}</strong><div style={meta}>{item.section}{item.notes?` · ${item.notes}`:""}{item.photos.length?` · ${item.photos.length} photo${item.photos.length===1?"":"s"}`:""}</div></div></div>)}</div></details>
      </div>}
    </div>
  </section>;

  return createPortal(panel,document.body);
}

function resultBadge(result:string){
  const base={display:"inline-flex",justifyContent:"center",minWidth:58,padding:"4px 7px",borderRadius:999,fontSize:10,fontWeight:950} as const;
  if(result==="pass")return {...base,background:"#e9f7ee",color:"#176440"} as const;
  if(result==="fail")return {...base,background:"#fff0f0",color:"#a12d2d"} as const;
  if(result==="na")return {...base,background:"#eef1f4",color:"#53616d"} as const;
  return {...base,background:"#fff4d7",color:"#80520a"} as const;
}

const outer={background:"#f3f5f7",padding:"0 30px 55px"} as const;
const card={maxWidth:1180,margin:"0 auto",border:"2px solid #173a5d",borderRadius:16,background:"white",padding:20,boxShadow:"0 8px 30px #12202f12"} as const;
const header={display:"flex",justifyContent:"space-between",gap:18,alignItems:"flex-start",flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".15em"} as const;
const title={margin:"5px 0 4px",fontSize:26,color:"#13283d"} as const;
const sub={fontSize:12,color:"#657383"} as const;
const correctionHint={marginTop:5,fontSize:11,fontWeight:800,color:"#176440"} as const;
const headerActions={display:"flex",alignItems:"center",gap:9,flexWrap:"wrap" as const} as const;
const summary={fontSize:12,fontWeight:900,color:"#52616d",background:"#f4f7f9",border:"1px solid #dde4ea",borderRadius:999,padding:"8px 11px"} as const;
const refreshButton={border:"1px solid #9ab1c5",borderRadius:9,padding:"8px 11px",background:"#eef5fa",color:"#173a5d",fontWeight:900,cursor:"pointer"} as const;
const notice={marginTop:12,padding:10,borderRadius:9,background:"#fff8e6",border:"1px solid #f2c66d",fontSize:12,fontWeight:800,color:"#5b6670"} as const;
const grid={marginTop:16,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12} as const;
const sectionCard={border:"1px solid #d8e0e6",borderRadius:12,background:"#fbfcfd",padding:13,minWidth:0} as const;
const sectionTitle={fontSize:13,color:"#173a5d",letterSpacing:".04em"} as const;
const hint={marginTop:3,fontSize:10,color:"#71808b"} as const;
const list={marginTop:9,display:"grid",gap:7,maxHeight:340,overflowY:"auto" as const} as const;
const row={border:"1px solid #e0e5e9",borderRadius:8,background:"white",padding:"8px 9px",fontSize:12,color:"#283645"} as const;
const noteFooter={display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap" as const} as const;
const editButton={border:"1px solid #a7bac9",borderRadius:7,padding:"5px 8px",background:"#f4f8fb",color:"#173a5d",fontWeight:900,fontSize:10,cursor:"pointer"} as const;
const editTextarea={width:"100%",boxSizing:"border-box" as const,padding:9,border:"1px solid #aebdca",borderRadius:8,background:"white",color:"#182331",fontSize:12,lineHeight:1.4,resize:"vertical" as const} as const;
const editActions={marginTop:7,display:"flex",gap:7,flexWrap:"wrap" as const} as const;
const saveEditButton={border:0,borderRadius:7,padding:"7px 10px",background:"#173a5d",color:"white",fontWeight:900,fontSize:10,cursor:"pointer"} as const;
const cancelEditButton={border:"1px solid #c9d2da",borderRadius:7,padding:"7px 10px",background:"white",color:"#52616d",fontWeight:900,fontSize:10,cursor:"pointer"} as const;
const meta={marginTop:3,fontSize:10,color:"#78858f"} as const;
const description={marginTop:2,fontSize:11,color:"#667482"} as const;
const empty={marginTop:9,fontSize:12,color:"#7b8790"} as const;
const partRow={display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",border:"1px solid #e0e5e9",borderRadius:8,background:"white",padding:"9px 10px",fontSize:12,color:"#283645"} as const;
const partActions={display:"flex",alignItems:"center",gap:8} as const;
const partQty={fontSize:15,color:"#173a5d",whiteSpace:"nowrap" as const} as const;
const removeButton={width:30,height:30,border:"1px solid #e4a2a2",borderRadius:7,background:"#fff2f2",color:"#9f2929",fontWeight:950,fontSize:14,cursor:"pointer",lineHeight:1} as const;
const requestBox={marginTop:10,border:"1px solid #e1b256",borderRadius:9,background:"#fff9ed",padding:9,display:"grid",gap:6} as const;
const requestRow={display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap" as const,fontSize:10,color:"#6b5a32"} as const;
const checklistCard={marginTop:12,border:"1px solid #d8e0e6",borderRadius:12,background:"#fbfcfd",padding:13} as const;
const checklistHeader={display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap" as const} as const;
const checklistSummary={fontSize:11,fontWeight:900,color:"#52616d"} as const;
const details={marginTop:9} as const;
const summaryButton={cursor:"pointer",fontSize:11,fontWeight:950,color:"#173a5d"} as const;
const checklistList={marginTop:9,display:"grid",gap:6,maxHeight:360,overflowY:"auto" as const} as const;
const checkRow={display:"grid",gridTemplateColumns:"auto minmax(0,1fr)",gap:8,alignItems:"start",borderTop:"1px solid #edf0f2",paddingTop:7,fontSize:11,color:"#33414d"} as const;
