"use client";

import {useEffect,useMemo,useState} from "react";
import ModuleTabs from "../../module-tabs";

type PartOption={id:number;partNumber:string;description:string};
type UnitOption={id:number;unit:string};
type PartSummary={partId:number;partNumber:string;description:string;quantity:number;repairCount:number;unitCount:number;cost:number};
type Detail={
  usageId:number;partId:number;partNumber:string;description:string;quantity:number;unitCost:number;lineCost:number;usedAt:string;
  repairId:number;repair:string;repairStatus:string;repairSource:string;equipmentId:number|null;unit:string;technician:string;
};
type Data={
  range:{startDate:string;endDate:string};
  filters:{partId:number|null;equipmentId:number|null;query:string};
  summary:{lineCount:number;totalQuantity:number;totalCost:number;repairCount:number;unitCount:number};
  parts:PartSummary[];
  details:Detail[];
  truncated:boolean;
  options:{parts:PartOption[];units:UnitOption[]};
  updatedAt:string;
};

function money(value:number){return Number(value||0).toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:2});}
function num(value:number,digits=2){return Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});}
function shortDate(value:string){if(!value)return"—";const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleDateString();}
function csvCell(value:string|number|null|undefined){const text=value==null?"":String(value);return `"${text.replace(/"/g,'""')}"`;}
function downloadCsv(filename:string,rows:Array<Record<string,string|number|null|undefined>>){
  if(!rows.length)return;
  const headers=Object.keys(rows[0]);
  const csv=[headers.map(csvCell).join(","),...rows.map(row=>headers.map(header=>csvCell(row[header])).join(","))].join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);
}

export default function PartsUsageReportPage(){
  const today=new Date().toISOString().slice(0,10);
  const[start,setStart]=useState(`${today.slice(0,4)}-01-01`);
  const[end,setEnd]=useState(today);
  const[partId,setPartId]=useState("");
  const[unitId,setUnitId]=useState("");
  const[query,setQuery]=useState("");
  const[data,setData]=useState<Data|null>(null);
  const[loading,setLoading]=useState(true);
  const[message,setMessage]=useState("");

  async function load(overrides?:Partial<{start:string;end:string;partId:string;unitId:string;query:string}>){
    const next={start:overrides?.start??start,end:overrides?.end??end,partId:overrides?.partId??partId,unitId:overrides?.unitId??unitId,query:overrides?.query??query};
    setLoading(true);setMessage("");
    try{
      const params=new URLSearchParams({start:next.start,end:next.end});
      if(next.partId)params.set("part",next.partId);
      if(next.unitId)params.set("unit",next.unitId);
      if(next.query.trim())params.set("q",next.query.trim());
      const response=await fetch(`/api/reports/parts-usage?${params.toString()}`,{cache:"no-store"});
      const payload=await response.json() as Data&{error?:string};
      if(!response.ok)throw new Error(payload.error||"Parts usage report could not be loaded.");
      setData(payload);
      setStart(payload.range.startDate);setEnd(payload.range.endDate);
    }catch(error){setMessage(error instanceof Error?error.message:"Parts usage report could not be loaded.");}
    finally{setLoading(false)}
  }

  useEffect(()=>{void load();},[]);

  const selectedPart=useMemo(()=>data?.options.parts.find(part=>String(part.id)===partId)??null,[data,partId]);
  const filenamePart=selectedPart?.partNumber.replace(/[^a-z0-9_-]+/gi,"-")||"all-parts";

  function choosePart(id:number){
    const value=String(id);setPartId(value);void load({partId:value});
  }

  function clearFilters(){
    const nextStart=`${today.slice(0,4)}-01-01`;
    setStart(nextStart);setEnd(today);setPartId("");setUnitId("");setQuery("");
    void load({start:nextStart,end:today,partId:"",unitId:"",query:""});
  }

  const summary=data?.summary??{lineCount:0,totalQuantity:0,totalCost:0,repairCount:0,unitCount:0};

  return <main style={page}>
    <ModuleTabs module="reports"/>
    <header style={header}>
      <div>
        <p style={eyebrow}>REPORTS</p>
        <h1 style={title}>Parts Usage</h1>
        <p style={subtitle}>Find exactly where a part went: unit, repair, mechanic, quantity, date and recorded cost.</p>
      </div>
      <div style={headerActions}><a href="/reports" style={secondaryButton}>Fleet Summary</a><button type="button" onClick={()=>void load()} disabled={loading} style={darkButton}>{loading?"Refreshing…":"Refresh"}</button></div>
    </header>

    {message&&<div style={notice}>{message}</div>}

    <section style={filterPanel}>
      <label style={label}>FROM<input type="date" value={start} onChange={event=>setStart(event.target.value)} style={input}/></label>
      <label style={label}>THROUGH<input type="date" value={end} onChange={event=>setEnd(event.target.value)} style={input}/></label>
      <label style={label}>PART<select value={partId} onChange={event=>setPartId(event.target.value)} style={input}><option value="">All parts</option>{(data?.options.parts??[]).map(part=><option key={part.id} value={part.id}>{part.partNumber} — {part.description}</option>)}</select></label>
      <label style={label}>UNIT<select value={unitId} onChange={event=>setUnitId(event.target.value)} style={input}><option value="">All units</option>{(data?.options.units??[]).map(unit=><option key={unit.id} value={unit.id}>Unit {unit.unit}</option>)}</select></label>
      <label style={{...label,gridColumn:"span 2"}}>SEARCH<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Part #, description, unit, repair, mechanic…" style={input}/></label>
      <div style={filterActions}><button type="button" onClick={()=>void load()} disabled={loading} style={darkButton}>RUN REPORT</button><button type="button" onClick={clearFilters} disabled={loading} style={secondaryButton}>Clear</button></div>
    </section>

    <section style={summaryGrid}>
      <Metric label="PART LINES" value={summary.lineCount.toLocaleString()} help="Individual part usage records"/>
      <Metric label="QUANTITY USED" value={num(summary.totalQuantity)} help="Total quantity in this report"/>
      <Metric label="REPAIRS" value={summary.repairCount.toLocaleString()} help="Different repairs using these parts"/>
      <Metric label="UNITS" value={summary.unitCount.toLocaleString()} help="Different trucks / trailers"/>
      <Metric label="RECORDED COST" value={money(summary.totalCost)} help="Snapshot cost when available"/>
    </section>

    {selectedPart&&<section style={selectedBanner}>
      <div><span style={selectedLabel}>SELECTED PART</span><strong style={selectedTitle}>{selectedPart.partNumber}</strong><span style={selectedDescription}>{selectedPart.description}</span></div>
      <button type="button" style={secondaryButton} onClick={()=>{setPartId("");void load({partId:""})}}>Show all parts</button>
    </section>}

    <section style={card}>
      <div style={sectionHeader}>
        <div><p style={sectionEyebrow}>SUMMARY</p><h2 style={sectionTitle}>Parts in This Report</h2><p style={sectionHelp}>Sorted by total recorded cost. Click View Usage to drill into one part.</p></div>
        <button type="button" style={darkButton} onClick={()=>downloadCsv(`parts-summary-${start}-to-${end}.csv`,(data?.parts??[]).map(part=>({PartNumber:part.partNumber,Description:part.description,Quantity:part.quantity,Repairs:part.repairCount,Units:part.unitCount,Cost:part.cost})))}>Export Summary CSV</button>
      </div>
      <div style={tableWrap}><table style={{...table,minWidth:850}}><thead><tr>{["Part","Description","Qty","Repairs","Units","Cost",""].map(head=><th key={head} style={th}>{head}</th>)}</tr></thead><tbody>
        {(data?.parts??[]).map(part=><tr key={part.partId}><td style={{...td,fontWeight:900}}>{part.partNumber}</td><td style={td}>{part.description}</td><td style={td}>{num(part.quantity)}</td><td style={td}>{part.repairCount}</td><td style={td}>{part.unitCount}</td><td style={{...td,fontWeight:850}}>{money(part.cost)}</td><td style={td}><button type="button" style={smallButton} onClick={()=>choosePart(part.partId)}>View Usage</button></td></tr>)}
        {!data?.parts.length&&<tr><td colSpan={7} style={emptyCell}>No part usage matches these filters.</td></tr>}
      </tbody></table></div>
    </section>

    <section style={card}>
      <div style={sectionHeader}>
        <div><p style={sectionEyebrow}>DETAIL</p><h2 style={sectionTitle}>{selectedPart?`${selectedPart.partNumber} Usage History`:"Individual Part Usage"}</h2><p style={sectionHelp}>Each line shows where the part was used and who was assigned to that repair.</p></div>
        <button type="button" style={darkButton} onClick={()=>downloadCsv(`parts-usage-${filenamePart}-${start}-to-${end}.csv`,(data?.details??[]).map(row=>({Date:row.usedAt.slice(0,10),PartNumber:row.partNumber,Description:row.description,Unit:row.unit,RepairId:row.repairId,Repair:row.repair,Mechanic:row.technician,Quantity:row.quantity,UnitCost:row.unitCost,LineCost:row.lineCost,Status:row.repairStatus,Source:row.repairSource})))}>Export Detail CSV</button>
      </div>
      {data?.truncated&&<div style={warning}>This report has more than 5,000 detail lines. The totals above are complete, but the detail table/CSV is limited to the newest 5,000 lines. Narrow the date, part or unit filter for the full detail.</div>}
      <div style={tableWrap}><table style={{...table,minWidth:1350}}><thead><tr>{["Date","Part","Description","Unit","Repair","Mechanic","Qty","Unit Cost","Line Cost","Status","Source"].map(head=><th key={head} style={th}>{head}</th>)}</tr></thead><tbody>
        {(data?.details??[]).map(row=><tr key={row.usageId}><td style={td}>{shortDate(row.usedAt)}</td><td style={{...td,fontWeight:900}}>{row.partNumber}</td><td style={td}>{row.description}</td><td style={{...td,fontWeight:850}}>{row.unit||"—"}</td><td style={td}><strong>#{row.repairId}</strong><span style={repairTitle}>{row.repair}</span></td><td style={td}>{row.technician}</td><td style={td}>{num(row.quantity)}</td><td style={td}>{money(row.unitCost)}</td><td style={{...td,fontWeight:850}}>{money(row.lineCost)}</td><td style={td}>{row.repairStatus||"—"}</td><td style={td}>{row.repairSource||"—"}</td></tr>)}
        {!data?.details.length&&<tr><td colSpan={11} style={emptyCell}>No individual part usage lines match these filters.</td></tr>}
      </tbody></table></div>
    </section>
  </main>;
}

function Metric({label,value,help}:{label:string;value:string;help:string}){return <article style={metric}><span style={metricLabel}>{label}</span><strong style={metricValue}>{value}</strong><span style={metricHelp}>{help}</span></article>}

const page={minHeight:"100vh",background:"#f3f5f7",padding:"30px clamp(12px,3vw,34px) 90px",color:"#182331"} as const;
const header={maxWidth:1300,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:18,flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#6d28d9",fontSize:11,fontWeight:950,letterSpacing:".15em"} as const;
const title={margin:"6px 0 0",fontSize:"clamp(30px,5vw,40px)",color:"#0d1b2b"} as const;
const subtitle={margin:"7px 0 0",maxWidth:760,color:"#64748b",fontSize:14,lineHeight:1.45} as const;
const headerActions={display:"flex",gap:8,flexWrap:"wrap" as const} as const;
const darkButton={border:0,borderRadius:9,padding:"10px 14px",background:"#0d1b2b",color:"white",fontWeight:900,cursor:"pointer",textDecoration:"none"} as const;
const secondaryButton={border:"1px solid #cbd5df",borderRadius:9,padding:"9px 13px",background:"white",color:"#233548",fontWeight:850,cursor:"pointer",textDecoration:"none"} as const;
const smallButton={border:"1px solid #b8c8d8",borderRadius:7,padding:"7px 9px",background:"#f7fafc",color:"#173a5d",fontWeight:850,cursor:"pointer",whiteSpace:"nowrap" as const} as const;
const notice={maxWidth:1300,margin:"15px auto 0",padding:"11px 13px",border:"1px solid #f2c66d",borderRadius:9,background:"#fff8e6",fontSize:13,fontWeight:800} as const;
const filterPanel={maxWidth:1300,margin:"18px auto 0",padding:15,border:"1px solid #d9e1e7",borderRadius:13,background:"white",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:10,alignItems:"end"} as const;
const label={display:"grid",gap:5,fontSize:10,fontWeight:950,letterSpacing:".06em",color:"#5f6f7d"} as const;
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c8d3dc",borderRadius:8,padding:"10px 11px",fontSize:13,background:"white",color:"#182331"} as const;
const filterActions={display:"flex",gap:7,alignItems:"center",flexWrap:"wrap" as const} as const;
const summaryGrid={maxWidth:1300,margin:"14px auto 0",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10} as const;
const metric={border:"1px solid #d9e1e7",borderRadius:12,background:"white",padding:14,display:"grid",gap:4} as const;
const metricLabel={fontSize:10,fontWeight:950,letterSpacing:".1em",color:"#6b7883"} as const;
const metricValue={fontSize:25,color:"#13283d"} as const;
const metricHelp={fontSize:10,color:"#7c8994"} as const;
const selectedBanner={maxWidth:1300,margin:"14px auto 0",padding:"13px 15px",border:"1px solid #b9cde0",borderRadius:12,background:"#eef5fb",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap" as const} as const;
const selectedLabel={display:"block",fontSize:9,fontWeight:950,letterSpacing:".12em",color:"#58718a"} as const;
const selectedTitle={display:"block",marginTop:3,fontSize:18,color:"#173a5d"} as const;
const selectedDescription={display:"block",marginTop:2,fontSize:12,color:"#5d6f7e"} as const;
const card={maxWidth:1300,margin:"18px auto 0",border:"1px solid #d9e1e7",borderRadius:13,background:"white",padding:"clamp(13px,2vw,18px)",boxShadow:"0 4px 18px #13283d08"} as const;
const sectionHeader={display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap" as const} as const;
const sectionEyebrow={margin:0,fontSize:9,fontWeight:950,letterSpacing:".13em",color:"#6d28d9"} as const;
const sectionTitle={margin:"3px 0 2px",fontSize:21,color:"#13283d"} as const;
const sectionHelp={margin:0,fontSize:11,color:"#71808b"} as const;
const tableWrap={marginTop:12,overflowX:"auto" as const} as const;
const table={width:"100%",borderCollapse:"collapse" as const} as const;
const th={textAlign:"left" as const,padding:"9px 8px",borderBottom:"1px solid #dce3e8",fontSize:10,color:"#627280",letterSpacing:".03em",whiteSpace:"nowrap" as const} as const;
const td={padding:"9px 8px",borderBottom:"1px solid #edf1f4",fontSize:12,verticalAlign:"top" as const} as const;
const repairTitle={display:"block",marginTop:2,color:"#637381",fontSize:11,maxWidth:280} as const;
const emptyCell={padding:22,textAlign:"center" as const,color:"#71808b",fontSize:12} as const;
const warning={marginTop:12,padding:"10px 12px",border:"1px solid #e2b75d",borderRadius:8,background:"#fff8e6",fontSize:12,fontWeight:750,color:"#775513"} as const;
