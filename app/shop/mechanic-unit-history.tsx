"use client";

import {useEffect,useMemo,useState} from "react";

type HistoryNote={id:string;detail:string;createdAt:string};
type HistoryPart={partNumber:string;description:string;quantity:number};
type HistoryPhoto={id:string;fileName:string;contentType:string;note:string;createdAt:string;url:string};
type HistoryEntry={
  id:string;
  kind:"repair"|"historical";
  date:string;
  repairType:string;
  source:string;
  issue:string;
  details:string;
  status:string;
  mileage:number|null;
  notes:HistoryNote[];
  parts:HistoryPart[];
  photos:HistoryPhoto[];
  similar:boolean;
};
type Payload={
  ok?:boolean;
  error?:string;
  unit?:string;
  current?:{repairId:string;issue:string;repairType:string};
  relatedCount?:number;
  repeatRepair?:boolean;
  entries?:HistoryEntry[];
  privacy?:{technicianIdentityIncluded:boolean};
};
type Props={repairId:string;unit:string;currentIssue:string};
type Tab="related"|"all"|"maintenance";

function dateText(value:string){
  if(!value)return "Date not recorded";
  const normalized=value.includes("T")?value:value+"T12:00:00";
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleDateString();
}
function qty(value:number){return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function isMaintenance(entry:HistoryEntry){return entry.repairType==="PM"||entry.repairType==="ANNUAL"||entry.source==="scheduled-pm"||entry.source==="scheduled-annual"}
function entrySearch(entry:HistoryEntry){
  return [
    entry.repairType,entry.issue,entry.details,
    ...entry.notes.map(note=>note.detail),
    ...entry.parts.flatMap(part=>[part.partNumber,part.description]),
  ].join(" ").toLowerCase();
}

export default function MechanicUnitHistory({repairId,unit,currentIssue}:Props){
  const[data,setData]=useState<Payload|null>(null);
  const[open,setOpen]=useState(false);
  const[tab,setTab]=useState<Tab>("related");
  const[search,setSearch]=useState("");
  const[message,setMessage]=useState("");

  async function load(){
    setMessage("");
    const response=await fetch("/api/shop/unit-history?repairId="+encodeURIComponent(repairId),{cache:"no-store"});
    const result=await response.json() as Payload;
    if(!response.ok||!result.ok)throw new Error(result.error||"Unit work history could not be loaded.");
    setData(result);
  }

  useEffect(()=>{
    setOpen(false);
    setTab("related");
    setSearch("");
    setData(null);
    void load().catch(error=>setMessage(error instanceof Error?error.message:"Unit work history could not be loaded."));
  },[repairId]);

  const entries=useMemo(()=>{
    const term=search.trim().toLowerCase();
    return (data?.entries??[]).filter(entry=>{
      if(tab==="related"&&!entry.similar)return false;
      if(tab==="maintenance"&&!isMaintenance(entry))return false;
      if(term&&!entrySearch(entry).includes(term))return false;
      return true;
    }).slice(0,60);
  },[data,tab,search]);

  const relatedCount=Number(data?.relatedCount??0);
  const totalCount=data?.entries?.length??0;
  const maintenanceCount=(data?.entries??[]).filter(isMaintenance).length;

  return <section id="unit-work-history" style={card}>
    <div style={head}>
      <div style={{minWidth:0}}>
        <strong style={title}>◷ UNIT WORK HISTORY</strong>
        <div style={help}>Previous work on Unit {unit}. Technician names are hidden.</div>
      </div>
      <button type="button" onClick={()=>setOpen(value=>!value)} style={openButton}>{open?"HIDE HISTORY":"VIEW UNIT HISTORY"}</button>
    </div>

    {data?.repeatRepair&&<div style={repeatNotice}>
      <strong>⚠ POSSIBLE REPEAT REPAIR</strong>
      <span>{relatedCount} previous repairs look related to “{currentIssue}”.</span>
    </div>}

    {!open&&relatedCount>0&&<div style={preview}>
      <strong>{relatedCount} related repair{relatedCount===1?"":"s"} found</strong>
      <span>Open history to see what was found, repaired, which parts were used, and any saved photos.</span>
    </div>}

    {message&&<div style={errorBox}>{message}</div>}

    {open&&data&&<>
      <div style={tabs}>
        <button type="button" onClick={()=>setTab("related")} style={tab==="related"?activeTab:tabButton}>RELATED ({relatedCount})</button>
        <button type="button" onClick={()=>setTab("all")} style={tab==="all"?activeTab:tabButton}>ALL HISTORY ({totalCount})</button>
        <button type="button" onClick={()=>setTab("maintenance")} style={tab==="maintenance"?activeTab:tabButton}>PM / ANNUAL ({maintenanceCount})</button>
      </div>

      <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search history — oil leak, brakes, compressor, part number…" style={searchBox}/>

      <div style={privacyBox}>Mechanic view shows repair facts only. Technician, uploader, and employee identity fields are not included.</div>

      <div style={list}>
        {entries.map(entry=><article key={entry.id} style={entryCard}>
          <div style={entryHead}>
            <div>
              <div style={entryDate}>{dateText(entry.date)}{entry.mileage!=null?" · "+Math.round(entry.mileage).toLocaleString()+" MI":""}</div>
              <strong style={entryType}>{entry.repairType}</strong>
            </div>
            {entry.similar&&<span style={relatedBadge}>RELATED</span>}
          </div>

          <div style={issue}>{entry.issue}</div>
          {entry.details&&<div style={details}>{entry.details}</div>}

          {entry.notes.length>0&&<div style={section}>
            <strong style={sectionTitle}>Repair notes</strong>
            {entry.notes.map(note=><div key={note.id} style={noteRow}>{note.detail}</div>)}
          </div>}

          {entry.parts.length>0&&<div style={section}>
            <strong style={sectionTitle}>Parts used</strong>
            <div style={chips}>{entry.parts.map(part=><span key={part.partNumber+"-"+part.description} style={chip}><b>{part.partNumber}</b> × {qty(part.quantity)}{part.description?" · "+part.description:""}</span>)}</div>
          </div>}

          {entry.photos.length>0&&<div style={section}>
            <strong style={sectionTitle}>Photos</strong>
            <div style={photoGrid}>{entry.photos.map(photo=><a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" style={photoLink}><img src={photo.url} alt={photo.note||photo.fileName} style={photo}/><span style={photoCaption}>{photo.note||photo.fileName}</span></a>)}</div>
          </div>}
        </article>)}
        {!entries.length&&<div style={empty}>{tab==="related"?"No close history matches were found. Try ALL HISTORY or search by a word or part number.":"No work history matched this view."}</div>}
      </div>
    </>}
  </section>;
}

const card={border:"2px solid #9fb8cf",borderRadius:14,background:"#f8fbfe",padding:14,display:"grid",gap:11} as const;
const head={display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap" as const} as const;
const title={display:"block",fontSize:16,color:"#173a5d"} as const;
const help={marginTop:3,fontSize:11,color:"#687783"} as const;
const openButton={border:0,borderRadius:9,padding:"10px 13px",background:"#173a5d",color:"white",fontWeight:950,cursor:"pointer"} as const;
const repeatNotice={display:"grid",gap:3,padding:"10px 12px",border:"2px solid #e8a044",borderRadius:10,background:"#fff7e9",color:"#6e4314",fontSize:12} as const;
const preview={display:"grid",gap:2,padding:"10px 12px",border:"1px solid #cfdae3",borderRadius:9,background:"white",fontSize:12,color:"#52616d"} as const;
const errorBox={padding:"9px 11px",border:"1px solid #e7b7b2",borderRadius:9,background:"#fff1f0",fontSize:12,fontWeight:800,color:"#7a2f29"} as const;
const tabs={display:"flex",gap:7,flexWrap:"wrap" as const} as const;
const tabButton={border:"1px solid #c2ced8",borderRadius:999,padding:"8px 11px",background:"white",color:"#425565",fontSize:11,fontWeight:950,cursor:"pointer"} as const;
const activeTab={...tabButton,background:"#173a5d",borderColor:"#173a5d",color:"white"} as const;
const searchBox={width:"100%",boxSizing:"border-box" as const,padding:"11px 12px",border:"1px solid #aebdca",borderRadius:9,background:"white",color:"#182331",fontSize:14} as const;
const privacyBox={padding:"8px 10px",borderRadius:8,background:"#edf4f9",color:"#5c6b77",fontSize:10,fontWeight:800} as const;
const list={display:"grid",gap:10} as const;
const entryCard={padding:13,border:"1px solid #d4dde5",borderRadius:11,background:"white",display:"grid",gap:8} as const;
const entryHead={display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"} as const;
const entryDate={fontSize:10,fontWeight:900,color:"#71808b",textTransform:"uppercase" as const} as const;
const entryType={display:"block",marginTop:3,fontSize:13,color:"#173a5d"} as const;
const relatedBadge={padding:"5px 7px",borderRadius:999,background:"#fff0da",color:"#9b5814",fontSize:9,fontWeight:950} as const;
const issue={fontSize:15,fontWeight:950,color:"#1d2e3c"} as const;
const details={padding:"8px 9px",borderRadius:8,background:"#f6f8fa",fontSize:12,lineHeight:1.4,color:"#4d5d69",whiteSpace:"pre-wrap" as const} as const;
const section={display:"grid",gap:6,paddingTop:3} as const;
const sectionTitle={fontSize:11,color:"#52616d",textTransform:"uppercase" as const,letterSpacing:".04em"} as const;
const noteRow={padding:"8px 9px",borderLeft:"3px solid #9fb8cf",background:"#f8fafc",fontSize:12,lineHeight:1.4,color:"#304657",whiteSpace:"pre-wrap" as const} as const;
const chips={display:"flex",flexWrap:"wrap" as const,gap:6} as const;
const chip={padding:"6px 8px",borderRadius:999,background:"#eef2f5",fontSize:10,fontWeight:800,color:"#40515e"} as const;
const photoGrid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:7} as const;
const photoLink={border:"1px solid #d3dde5",borderRadius:9,overflow:"hidden",background:"white",textDecoration:"none",color:"#22384b",display:"grid"} as const;
const photo={width:"100%",height:95,objectFit:"cover" as const,display:"block",background:"#edf2f6"} as const;
const photoCaption={padding:6,fontSize:9,fontWeight:800} as const;
const empty={padding:18,border:"1px dashed #c8d3dc",borderRadius:9,background:"white",textAlign:"center" as const,fontSize:12,color:"#687783"} as const;
