"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

type JobType={key:string;name:string;scope:string;comparable:boolean;totalHours:number;jobs:number;technicians:number;eligibleJobs:number;eligibleHours:number;averageEligibleHours:number|null};
type Comparison={categoryKey:string;jobType:string;scope:string;technicianId:number;technician:string;jobCount:number;totalHours:number;averageHours:number;peerJobs:number;peerTechnicians:number;peerAverageHours:number|null;timeVsPeersPercent:number|null;sample:string};
type Share={technicianId:number;technician:string;hours:number;sharePercent:number|null;untimedHours:number};
type Shared={repairId:number;title:string;unit:string;status:string;category:string;categoryKey:string;totalHours:number;members:Share[]};
type Job={technicianId:number;technician:string;repairId:number;title:string;unit:string;status:string;source:string;openedAt:string;completedAt:string;firstDate:string;lastDate:string;laborEntries:number;hours:number;untimedHours:number;category:{key:string;name:string;scope:string;comparable:boolean};comparable:boolean;excludedReason:string};
type Data={range:{startDate:string;endDate:string;days:number};summary:{technicianJobRows:number;uniqueWorkOrders:number;recordedDirectHours:number;comparableJobs:number;comparableHours:number;sharedWorkOrders:number;comparisonRows:number;unclassifiedOrUnversionedRows:number;openWorkOrderRows:number;untimedExcludedRows:number};jobTypes:JobType[];comparisons:Comparison[];sharedRepairs:Shared[];workOrders:Job[];updatedAt:string;error?:string};
type Range={start:string;end:string};
type View="peers"|"shared"|"jobs";
type SortKey="jobType"|"technician"|"averageHours"|"peerAverageHours"|"jobCount"|"totalHours"|"timeVsPeersPercent";
const card:CSSProperties={border:"1px solid #dae2ea",borderRadius:12,background:"#fff",overflow:"hidden"};
const button:CSSProperties={border:0,borderRadius:8,padding:"10px 13px",background:"#102b46",color:"#fff",fontWeight:800,cursor:"pointer",fontSize:13};
const light:CSSProperties={...button,background:"#e9eff5",color:"#263a4d"};
const input:CSSProperties={padding:"9px 10px",border:"1px solid #cbd5e1",borderRadius:8,background:"#fff",fontSize:13,color:"#172d42"};
const th:CSSProperties={textAlign:"left",padding:"10px",background:"#f1f5f9",borderBottom:"1px solid #d7e0e9",position:"sticky",top:0,zIndex:1,fontSize:12,whiteSpace:"nowrap"};
const td:CSSProperties={padding:10,borderBottom:"1px solid #edf0f4",fontSize:13,verticalAlign:"top"};
const sectionHeading:CSSProperties={fontWeight:850,fontSize:18,margin:"0 0 5px"};
const fmtHours=(value:number)=>Number(value||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtPercent=(value:number|null)=>value===null?"—":(value>0?"+":"")+value.toFixed(1)+"%";
function ymd(value:Date){return [value.getFullYear(),String(value.getMonth()+1).padStart(2,"0"),String(value.getDate()).padStart(2,"0")].join("-");}
function ago(days:number){const n=new Date();return ymd(new Date(n.getFullYear(),n.getMonth(),n.getDate()-days));}
function rangeFor(name:string):Range{
  const n=new Date(),end=ymd(n);
  if(name==="today")return{start:end,end};
  if(name==="week")return{start:ago(6),end};
  if(name==="month")return{start:ymd(new Date(n.getFullYear(),n.getMonth(),1)),end};
  if(name==="ninety")return{start:ago(89),end};
  if(name==="ytd")return{start:ymd(new Date(n.getFullYear(),0,1)),end};
  return{start:ago(29),end};
}
const initial=rangeFor("thirty");
function csvCell(value:unknown){
  const raw=String(value??"");
  const safe=/^\s*[=+@-]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
function downloadCsv(filename:string,values:Array<Record<string,unknown>>){
  if(!values.length)return;
  const cols=Object.keys(values[0]);
  const lines=[cols.map(csvCell).join(","),...values.map(v=>cols.map(key=>csvCell(v[key])).join(","))];
  const url=URL.createObjectURL(new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Info({children}:{children:React.ReactNode}){return <p style={{fontSize:12,color:"#5c7185",lineHeight:1.5,margin:"7px 0 0"}}>{children}</p>;}
function Counter({label,value,description}:{label:string;value:string;description:string}){
  return <div style={{...card,padding:14}}>
    <span style={{fontSize:11,color:"#64748b",fontWeight:850}}>{label}</span>
    <div style={{fontSize:24,fontWeight:900,color:"#0f2945",margin:"6px 0 4px",fontVariantNumeric:"tabular-nums"}}>{value}</div>
    <small style={{color:"#64748b"}}>{description}</small>
  </div>;
}
function TableBox({children,label}:{children:React.ReactNode;label:string}){
  return <div role="region" aria-label={label} tabIndex={0} className="tech-peer-scroll" style={{maxHeight:575,overflow:"auto",overscrollBehavior:"contain"}}>{children}</div>;
}

export default function TechnicianPeerComparisons(){
  const[draft,setDraft]=useState<Range>(initial),[applied,setApplied]=useState<Range>(initial);
  const[preset,setPreset]=useState("thirty");
  const[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const[view,setView]=useState<View>("peers"),[category,setCategory]=useState("");
  const[techA,setTechA]=useState(""),[techB,setTechB]=useState("");
  const[query,setQuery]=useState(""),[sort,setSort]=useState<{key:SortKey;desc:boolean}>({key:"jobType",desc:false});
  const[sharedSort,setSharedSort]=useState("highest"),[jobSort,setJobSort]=useState("recent"),[eligibleFilter,setEligibleFilter]=useState("all");
  const[showJobs,setShowJobs]=useState(75);

  async function load(period:Range){
    setLoading(true);setError("");
    try{
      const params=new URLSearchParams({start:period.start,end:period.end});
      const response=await fetch("/api/reports/technician-productivity/comparisons?"+params,{cache:"no-store"});
      const body=await response.json() as Data;
      if(!response.ok)throw new Error(body.error||"Job comparisons could not be loaded.");
      setData(body);setApplied(period);
    }catch(reason){setError(reason instanceof Error?reason.message:"Unable to load this report.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load(initial);},[]);
  function setPeriod(name:string){setPreset(name);const next=rangeFor(name);setDraft(next);void load(next);}
  function submit(event:FormEvent){event.preventDefault();void load(draft);}
  const choices=useMemo(()=>{
    const found=new Map<number,string>();
    for(const job of data?.workOrders??[])found.set(job.technicianId,job.technician);
    return [...found.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[data]);
  const techIds=[techA,techB].filter(Boolean).map(Number);
  const techAllowed=(id:number)=>!techIds.length||techIds.includes(id);
  const catAllowed=(key:string)=>!category||category===key;
  const needle=query.trim().toLowerCase();
  const textMatches=(...values:string[])=>!needle||values.join(" ").toLowerCase().includes(needle);

  const comparisons=useMemo(()=>{
    const rows=(data?.comparisons??[]).filter(c=>techAllowed(c.technicianId)&&catAllowed(c.categoryKey)&&textMatches(c.jobType,c.technician,c.scope));
    return [...rows].sort((a,b)=>{
      const x=a[sort.key],y=b[sort.key];
      if(x==null&&y==null)return a.jobType.localeCompare(b.jobType);
      if(x==null)return 1;if(y==null)return -1;
      const cmp=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),undefined,{numeric:true});
      return (sort.desc?-cmp:cmp)||a.jobType.localeCompare(b.jobType)||a.technician.localeCompare(b.technician);
    });
  },[data,techA,techB,category,query,sort]);
  const shared=useMemo(()=>{
    const rows=(data?.sharedRepairs??[]).filter(s=>catAllowed(s.categoryKey)&&s.members.some(member=>techAllowed(member.technicianId))&&textMatches(s.unit,s.title,s.category,...s.members.map(m=>m.technician)));
    return [...rows].sort((a,b)=>sharedSort==="newest"?b.repairId-a.repairId:
      sharedSort==="unit"?a.unit.localeCompare(b.unit,undefined,{numeric:true}):
      b.totalHours-a.totalHours||b.repairId-a.repairId);
  },[data,techA,techB,category,query,sharedSort]);
  const jobs=useMemo(()=>{
    const rows=(data?.workOrders??[]).filter(j=>techAllowed(j.technicianId)&&catAllowed(j.category.key)&&textMatches(j.technician,j.title,j.unit,j.status,j.category.name,String(j.repairId))&&
      (eligibleFilter==="all"||(eligibleFilter==="eligible"?j.comparable:!j.comparable)));
    return [...rows].sort((a,b)=>jobSort==="hours"?b.hours-a.hours:
      jobSort==="technician"?a.technician.localeCompare(b.technician):
      jobSort==="unit"?a.unit.localeCompare(b.unit,undefined,{numeric:true}):
      b.lastDate.localeCompare(a.lastDate)||b.repairId-a.repairId);
  },[data,techA,techB,category,query,eligibleFilter,jobSort]);

  function exportCurrent(){
    const ending=applied.start+"-to-"+applied.end;
    if(view==="peers")downloadCsv("technician-same-job-comparisons-"+ending+".csv",comparisons.map(row=>({
      "Work type":row.jobType,"Work category":row.scope,Technician:row.technician,
      "Completed single-tech jobs":row.jobCount,"Technician average hours per WO":row.averageHours,
      "Technician total hours":row.totalHours,"Other techs compared":row.peerTechnicians,
      "Other technicians' jobs":row.peerJobs,"Other technicians' average hours per WO":row.peerAverageHours,
      "Time vs peers (%)":row.timeVsPeersPercent??"N/A","Evidence":row.sample,
    })));
    if(view==="shared")downloadCsv("technician-shared-work-orders-"+ending+".csv",shared.flatMap(row=>row.members.map(member=>({
      "Work order":row.repairId,Unit:row.unit,Description:row.title,"Work type":row.category,
      Status:row.status,"All technicians total hours":row.totalHours,
      Technician:member.technician,"Technician hours":member.hours,"Share of logged work (%)":member.sharePercent,
      "Hours without timer timestamps":member.untimedHours,
    }))));
    if(view==="jobs")downloadCsv("technician-work-order-labor-"+ending+".csv",jobs.map(row=>({
      "Work order":row.repairId,Technician:row.technician,Unit:row.unit,Description:row.title,
      "Work type":row.category.name,Status:row.status,"Hours logged":row.hours,
      "Hours missing timer timestamps":row.untimedHours,"Labor entries":row.laborEntries,
      "First logged date":row.firstDate,"Last logged date":row.lastDate,
      "Opened at":row.openedAt,"Completed at":row.completedAt,"Eligible for peer comparison":row.comparable?"Yes":"No",
      "Reason not comparable":row.excludedReason,
    })));
  }
  const summary=data?.summary;
  const categories=(data?.jobTypes??[]).filter(item=>item.jobs>0);
  function changeTab(next:View){setView(next);setShowJobs(75);}
  const sortColumns:Array<{key:SortKey;label:string}>=[
    {key:"jobType",label:"Same job type"},{key:"technician",label:"Technician"},
    {key:"jobCount",label:"Jobs"},{key:"averageHours",label:"Avg hrs / job"},
    {key:"peerAverageHours",label:"Other techs avg hrs"},{key:"timeVsPeersPercent",label:"Time vs peers"},
    {key:"totalHours",label:"Logged hours"},
  ];
  return <main id="technician-peer-report" style={{minHeight:"100vh",background:"#f3f5f7",color:"#182b3f",padding:"clamp(14px,2.2vw,30px)"}}>
    <style>{"@media print {.tech-peer-no-print,.app-sidebar,.sidebar-shell,.app-shell-sidebar{display:none!important} #technician-peer-report{padding:0!important;background:#fff!important} .tech-peer-scroll{max-height:none!important;overflow:visible!important} #technician-peer-report tr{break-inside:avoid}}"}
    </style>
    <header style={{display:"flex",gap:15,justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",marginBottom:16}}>
      <div><p style={{fontSize:11,fontWeight:900,letterSpacing:".13em",color:"#ea6a16",margin:0}}>NORTHERN LOGISTICS · REPORTS</p>
        <h1 style={{fontSize:"clamp(23px,2.4vw,32px)",margin:"5px 0 5px"}}>Technician Job Comparisons</h1>
        <p style={{fontSize:13,color:"#64748b",margin:0,maxWidth:850}}>Compare mechanics doing the same classified work and see how labor is shared on the same exact work order.</p>
      </div>
      <div className="tech-peer-no-print" style={{display:"flex",flexWrap:"wrap",gap:8}}>
        <a href="/reports/technician-productivity" style={{...light,textDecoration:"none"}}>← Productivity Overview</a>
        <button type="button" style={light} disabled={!data} onClick={()=>window.print()}>Print</button>
        <button type="button" style={button} disabled={!data} onClick={exportCurrent}>Export This View</button>
      </div>
    </header>
    <section className="tech-peer-no-print" style={{...card,padding:15,marginBottom:14}}>
      <form onSubmit={submit} style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}>
        <label style={{display:"grid",gap:5,fontWeight:750,fontSize:12}}>Date range
          <select style={input} value={preset} onChange={event=>setPeriod(event.target.value)}>
            <option value="today">Today</option><option value="week">Last 7 days</option>
            <option value="thirty">Last 30 days</option><option value="month">This month</option>
            <option value="ninety">Last 90 days</option><option value="ytd">Year to date</option><option value="custom">Custom</option>
          </select></label>
        <label style={{display:"grid",gap:5,fontSize:12,fontWeight:750}}>From
          <input style={input} type="date" required value={draft.start} onChange={event=>{setDraft({...draft,start:event.target.value});setPreset("custom");}}/>
        </label>
        <label style={{display:"grid",gap:5,fontSize:12,fontWeight:750}}>Through
          <input style={input} type="date" required value={draft.end} onChange={event=>{setDraft({...draft,end:event.target.value});setPreset("custom");}}/>
        </label>
        <button disabled={loading} type="submit" style={button}>{loading?"Loading…":"Run Report"}</button>
        <button disabled={loading} type="button" style={light} onClick={()=>void load(applied)}>Refresh</button>
      </form>
      <div style={{marginTop:12,display:"flex",gap:9,flexWrap:"wrap",alignItems:"end"}}>
        <label style={{display:"grid",gap:5,fontSize:12,fontWeight:750}}>First technician
          <select value={techA} style={{...input,minWidth:185}} onChange={e=>{setTechA(e.target.value);setShowJobs(75);}}>
            <option value="">All technicians</option>{choices.map(([id,name])=><option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label style={{display:"grid",gap:5,fontSize:12,fontWeight:750}}>Compare with
          <select value={techB} style={{...input,minWidth:185}} onChange={e=>{setTechB(e.target.value);setShowJobs(75);}}>
            <option value="">All technicians</option>{choices.filter(([id])=>String(id)!==techA).map(([id,name])=><option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label style={{display:"grid",gap:5,fontSize:12,fontWeight:750}}>Work type
          <select value={category} style={{...input,minWidth:195,maxWidth:300}} onChange={e=>{setCategory(e.target.value);setShowJobs(75);}}>
            <option value="">All work types</option>
            {categories.map(type=><option key={type.key} value={type.key}>{type.name} ({type.jobs})</option>)}
          </select>
        </label>
        <label style={{display:"grid",gap:5,fontSize:12,fontWeight:750,flex:"1 1 205px"}}>Search unit, work order, technician
          <input style={{...input,width:"100%",boxSizing:"border-box"}} type="search" placeholder="Unit, repair, tech name…" value={query} onChange={e=>{setQuery(e.target.value);setShowJobs(75);}}/>
        </label>
        <button type="button" style={light} onClick={()=>{setTechA("");setTechB("");setCategory("");setQuery("");setShowJobs(75);}}>Clear filters</button>
      </div>
      <Info>Filtering technicians does not change the underlying peer benchmarks: each mechanic is compared to the other technicians who did the same type of work. Date ranges use saved labor dates and are limited to 366 days.</Info>
    </section>
    {error&&<p role="alert" style={{...card,padding:15,color:"#b91c1c",borderColor:"#fecaca"}}>{error}</p>}
    {!data&&!error&&<p role="status" style={{padding:20,color:"#64748b"}}>Loading completed job comparisons…</p>}
    {data&&<>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",fontSize:12,margin:"0 0 12px",color:"#475569"}}>
        <strong>{applied.start} through {applied.end}</strong><span>Updated {new Date(data.updatedAt).toLocaleString()}</span>
      </div>
      <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(164px,1fr))",gap:10,marginBottom:13}}>
        <Counter label="Direct hours logged" value={fmtHours(summary?.recordedDirectHours??0)} description="Across all job types"/>
        <Counter label="Work orders touched" value={String(summary?.uniqueWorkOrders??0)} description="All direct jobs with saved time"/>
        <Counter label="Comparable full jobs" value={String(summary?.comparableJobs??0)} description="Completed, single tech, timer-confirmed"/>
        <Counter label="Same-type comparisons" value={String(summary?.comparisonRows??0)} description="Technicians with an eligible peer"/>
        <Counter label="Shared work orders" value={String(summary?.sharedWorkOrders??0)} description="Multiple mechanics worked one WO"/>
      </section>
      <section style={{...card,padding:15,marginBottom:15}}>
        <strong>How to read these comparisons</strong>
        <Info><strong>Time vs peers (%)</strong> = (technician's average logged hours per completed job ÷ other technicians' average for the same type − 1) × 100.
          A negative number means fewer recorded hours; a positive number means more. This is <strong>not</strong> a quality score, book-time efficiency, or a definitive ranking.
          Job complexity, equipment condition, parts delays, and differences in checklist scope can all change the hours.
        </Info>
        <Info>For like-for-like averages, only completed, single-tech jobs opened and completed within this date range, with verified timer timestamps and a recorded repair type or PM/Annual checklist version, are included. Work in progress, manual/legacy time, unclassified jobs, and shared jobs remain visible in the Work Order History tab instead of skewing the comparison.</Info>
      </section>
      <nav className="tech-peer-no-print" aria-label="Technician productivity reporting views" style={{display:"flex",gap:8,marginBottom:13,flexWrap:"wrap"}}>
        {([
          ["peers","Same Job Types"],
          ["shared","Same Exact Work Order"],
          ["jobs","All Work Order Labor"],
        ] as Array<[View,string]>).map(([name,label])=><button key={name} type="button" style={view===name?button:light} onClick={()=>changeTab(name)} aria-pressed={view===name}>{label}</button>)}
      </nav>
      {view==="peers"&&<div style={{display:"grid",gap:13}}>
        <section style={card}>
          <div style={{padding:15,borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div><h2 style={sectionHeading}>Compare Technician Hours on the Same Job Type</h2>
              <Info>Each peer baseline excludes the technician's own jobs. “Small comparison sample” flags job counts too small to confidently compare.</Info></div>
            <span style={{fontSize:12,color:"#64748b"}}>{comparisons.length} rows</span>
          </div>
          <TableBox label="Sortable same type technician comparisons">
            <table style={{minWidth:1080,width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{sortColumns.map(col=><th key={col.key} style={th} aria-sort={sort.key===col.key?(sort.desc?"descending":"ascending"):"none"}>
                <button type="button" style={{border:0,background:"none",fontWeight:850,cursor:"pointer",fontSize:12,color:"#334155",padding:0}} onClick={()=>setSort(old=>({key:col.key,desc:old.key===col.key?!old.desc:col.key!=="jobType"}))}>
                  {col.label} <span aria-hidden="true">{sort.key===col.key?(sort.desc?"↓":"↑"):"↕"}</span>
                </button></th>)}<th style={th}>Comparison sample</th></tr></thead>
              <tbody>{comparisons.map(row=><tr key={row.categoryKey+"-"+row.technicianId}>
                <td style={td}><strong>{row.jobType}</strong><small style={{display:"block",color:"#64748b"}}>{row.scope}</small></td>
                <td style={td}>{row.technician}</td><td style={td}>{row.jobCount}</td>
                <td style={{...td,fontWeight:850}}>{fmtHours(row.averageHours)}</td>
                <td style={td}>{row.peerAverageHours===null?"—":fmtHours(row.peerAverageHours)}</td>
                <td style={{...td,color:row.timeVsPeersPercent===null?"#64748b":row.timeVsPeersPercent>0?"#9a3412":"#0369a1",fontWeight:850}}>
                  {fmtPercent(row.timeVsPeersPercent)}
                </td>
                <td style={td}>{fmtHours(row.totalHours)}</td>
                <td style={td}>
                  <strong>{row.peerTechnicians} peer{row.peerTechnicians===1?"":"s"} / {row.peerJobs} job{row.peerJobs===1?"":"s"}</strong>
                  <small style={{display:"block",color:row.sample==="Small comparison sample"?"#a16207":"#64748b"}}>{row.sample}</small>
                </td>
              </tr>)}
              {!comparisons.length&&<tr><td colSpan={8} style={{padding:22,color:"#64748b"}}>No two technicians have comparable completed jobs of the same type for these filters. Try Last 90 days or view All Work Order Labor to see why jobs were excluded.</td></tr>}
              </tbody>
            </table>
          </TableBox>
        </section>
        <section style={card}>
          <div style={{padding:15,borderBottom:"1px solid #e2e8f0"}}>
            <h2 style={sectionHeading}>Recorded Job Types & Coverage</h2>
            <Info>These counts include all direct labor in the selected period, even jobs that cannot be used for a fair peer comparison.</Info>
          </div>
          <TableBox label="Job type report and sample coverage">
            <table style={{minWidth:780,width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Type","Category","Technicians","Work orders","All labor hrs","Eligible solo jobs","Avg eligible hrs / job"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{categories.filter(c=>catAllowed(c.key)&&textMatches(c.name,c.scope)).map(c=><tr key={c.key}>
                <td style={td}><strong>{c.name}</strong></td><td style={td}>{c.scope}</td>
                <td style={td}>{c.technicians}</td><td style={td}>{c.jobs}</td>
                <td style={td}>{fmtHours(c.totalHours)}</td><td style={td}>{c.eligibleJobs}</td>
                <td style={td}>{c.averageEligibleHours===null?"—":fmtHours(c.averageEligibleHours)}</td>
              </tr>)}
              {!categories.length&&<tr><td colSpan={7} style={{padding:20}}>No repair-type entries for these dates.</td></tr>}</tbody>
            </table>
          </TableBox>
        </section>
      </div>}
      {view==="shared"&&<section style={card}>
        <div style={{padding:15,display:"flex",justifyContent:"space-between",gap:11,alignItems:"center",flexWrap:"wrap",borderBottom:"1px solid #e2e8f0"}}>
          <div><h2 style={sectionHeading}>Same Exact Work Order · Shared Labor</h2>
            <Info>If more than one mechanic worked a single WO, see every person's logged time and percent of that WO's recorded labor. These are contributions, not competing completion times.</Info></div>
          <label style={{fontSize:12,fontWeight:750}}>Sort{" "}
            <select value={sharedSort} onChange={e=>setSharedSort(e.target.value)} style={input}>
              <option value="highest">Highest total hours</option><option value="newest">Newest WO number</option><option value="unit">Unit number</option>
            </select>
          </label>
        </div>
        <div className="tech-peer-scroll" style={{maxHeight:680,overflow:"auto",padding:14}}>
          {shared.length===0&&<p style={{color:"#64748b",fontSize:13}}>No shared work orders match these filters. The same technician may have handled jobs alone, or other mechanics may not have logged time to the same work order.</p>}
          {shared.map(row=><article key={row.repairId} style={{border:"1px solid #dce3eb",borderRadius:10,padding:13,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:9}}>
              <div><strong>WO #{row.repairId} · Unit {row.unit}</strong>
                <p style={{fontSize:13,margin:"3px 0 0"}}>{row.title}</p>
                <small style={{color:"#64748b"}}>{row.category} · {row.status}</small>
              </div>
              <div><strong style={{fontSize:17}}>{fmtHours(row.totalHours)} hrs</strong><small style={{display:"block",color:"#64748b"}}>Combined logged time</small></div>
            </div>
            {row.members.map(member=><div key={member.technicianId} style={{display:"grid",gridTemplateColumns:"minmax(120px,1fr) minmax(140px,3fr) 78px 58px",alignItems:"center",gap:9,marginTop:7,fontSize:12}}>
              <span style={{fontWeight:700}}>{member.technician}</span>
              <div aria-hidden="true" style={{background:"#e2e8f0",height:11,borderRadius:9,overflow:"hidden"}}>
                <div style={{height:"100%",background:"#2271bd",width:String(member.sharePercent??0)+"%"}}/>
              </div>
              <span style={{textAlign:"right"}}>{fmtHours(member.hours)} h</span><strong style={{textAlign:"right"}}>{member.sharePercent===null?"—":member.sharePercent.toFixed(1)+"%"}</strong>
            </div>)}
          </article>)}
        </div>
      </section>}
      {view==="jobs"&&<section style={card}>
        <div style={{padding:15,display:"flex",gap:10,justifyContent:"space-between",alignItems:"end",flexWrap:"wrap",borderBottom:"1px solid #e2e8f0"}}>
          <div><h2 style={sectionHeading}>All Direct Work Order Labor · Audit</h2>
            <Info>Actual labor records for each technician and work order. Reasons show why an item is or isn't included in like-for-like averages.</Info></div>
          <div style={{display:"flex",gap:9,flexWrap:"wrap"}}>
            <label style={{display:"grid",gap:4,fontSize:12}}>Comparison status
              <select style={input} value={eligibleFilter} onChange={e=>{setEligibleFilter(e.target.value);setShowJobs(75);}}>
                <option value="all">All jobs</option><option value="eligible">Eligible only</option><option value="excluded">Excluded only</option>
              </select></label>
            <label style={{display:"grid",gap:4,fontSize:12}}>Sort
              <select style={input} value={jobSort} onChange={e=>setJobSort(e.target.value)}>
                <option value="recent">Most recently logged</option><option value="hours">Highest labor hours</option>
                <option value="technician">Technician name</option><option value="unit">Unit number</option>
              </select>
            </label>
          </div>
        </div>
        <p style={{fontSize:12,color:"#64748b",padding:"0 14px"}}>{jobs.length} technician/WO entries match. Showing {Math.min(showJobs,jobs.length)}; CSV includes all matches.</p>
        <TableBox label="Detailed technician work order labor and benchmark eligibility">
          <table style={{borderCollapse:"collapse",width:"100%",minWidth:1170}}>
            <thead><tr>{["Last worked","Technician","Unit","WO #","Work type","Repair / description","Status","Logged hours","Benchmark eligibility"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{jobs.slice(0,showJobs).map(row=><tr key={row.technicianId+"-"+row.repairId}>
              <td style={td}>{row.lastDate}</td><td style={td}><strong>{row.technician}</strong></td>
              <td style={td}>{row.unit}</td><td style={td}>#{row.repairId}</td>
              <td style={td}>{row.category.name}</td>
              <td style={{...td,maxWidth:300,whiteSpace:"normal"}}>{row.title}</td><td style={td}>{row.status}</td>
              <td style={{...td,fontWeight:800}}>{fmtHours(row.hours)}</td>
              <td style={{...td,maxWidth:290,whiteSpace:"normal",color:row.comparable?"#166534":"#92400e"}}>{row.comparable?"Eligible completed solo job":row.excludedReason}</td>
            </tr>)}
            {!jobs.length&&<tr><td colSpan={9} style={{padding:24,color:"#64748b"}}>No direct labor entries match these filters.</td></tr>}</tbody>
          </table>
        </TableBox>
        {showJobs<jobs.length&&<div className="tech-peer-no-print" style={{display:"flex",justifyContent:"center",padding:13}}>
          <button type="button" style={light} onClick={()=>setShowJobs(v=>v+75)}>Show 75 more</button>
        </div>}
      </section>}
      <p style={{fontSize:12,color:"#64748b",lineHeight:1.55,marginTop:14}}>
        <strong>Data coverage:</strong> {summary?.technicianJobRows??0} technician/WO records; {summary?.unclassifiedOrUnversionedRows??0} without comparable type/checklist;
        {" "}{summary?.untimedExcludedRows??0} excluded due to manual or legacy hours; {summary?.openWorkOrderRows??0} still incomplete.
        Results cannot measure work never logged, job quality, repeat repairs, paid hours, or manufacturer book-time efficiency. A comparison is descriptive, not a performance score.
      </p>
    </>}
  </main>;
}
