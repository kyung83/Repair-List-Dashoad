"use client";

import { useEffect, useMemo, useState, type FormEvent, type CSSProperties } from "react";

type Metric = { directHours:number; indirectHours:number; totalHours:number; productivityPercent:number|null; indirectPercent:number|null };
type Tech = Metric & {id:number;name:string;active:boolean;noTimerHours:number;timeEntries:number;loggedDays:number;repairCount:number;indirectActivities:number;runningTimers:number};
type Day = Metric & {date:string;repairCount:number;indirectActivities:number;noTimerHours:number};
type Report = {range:{startDate:string;endDate:string;days:number};summary:Metric & {techniciansWithHours:number;techniciansListed:number;timeEntries:number;noTimerHours:number;runningTimers:number};technicians:Tech[];selectedTechnicianId:number|null;daily:Day[];updatedAt:string;error?:string};
type Period = {start:string;end:string};
type Sort = "name"|"productivityPercent"|"directHours"|"indirectHours"|"totalHours"|"repairCount"|"loggedDays"|"noTimerHours";

const panel:CSSProperties={background:"#fff",border:"1px solid #dce2e7",borderRadius:13,overflow:"hidden"};
const input:CSSProperties={border:"1px solid #cbd5e1",borderRadius:8,padding:"10px 11px",background:"#fff",color:"#162638",font:"inherit"};
const action:CSSProperties={border:0,borderRadius:8,padding:"10px 14px",background:"#102b46",color:"#fff",fontWeight:850,cursor:"pointer"};
const light:CSSProperties={...action,background:"#e9eff5",color:"#263a4d"};
const td:CSSProperties={padding:"10px 11px",borderBottom:"1px solid #ebeff3",fontSize:13,whiteSpace:"nowrap",verticalAlign:"middle"};
const th:CSSProperties={...td,position:"sticky",top:0,zIndex:2,background:"#f1f5f9",textAlign:"left",color:"#334155",fontSize:12};
function ymd(date:Date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");}
function daysBack(days:number){const now=new Date();return ymd(new Date(now.getFullYear(),now.getMonth(),now.getDate()-days));}
function presetRange(preset:string):Period{
  const now=new Date(),end=ymd(now);
  if(preset==="today")return{start:end,end};
  if(preset==="week")return{start:daysBack(6),end};
  if(preset==="month")return{start:ymd(new Date(now.getFullYear(),now.getMonth(),1)),end};
  if(preset==="ninety")return{start:daysBack(89),end};
  if(preset==="year")return{start:ymd(new Date(now.getFullYear(),0,1)),end};
  return{start:daysBack(29),end};
}
const initialPeriod=presetRange("thirty");
const hours=(n:number)=>Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const percent=(n:number|null|undefined)=>n==null?"—":n.toFixed(1)+"%";
function csvValue(value:unknown){
  const raw=String(value??"");
  const safe=/^\s*[=+@-]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
function saveCsv(file:string,records:Array<Record<string,unknown>>){
  if(!records.length)return;
  const names=Object.keys(records[0]);
  const content=[names.map(csvValue).join(","),...records.map(row=>names.map(key=>csvValue(row[key])).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob(["\uFEFF"+content],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=file;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function orderTechnicians(rows:Tech[],key:Sort,desc:boolean){
  return [...rows].sort((a,b)=>{
    const x=a[key],y=b[key];
    if(x==null&&y==null)return a.name.localeCompare(b.name);
    if(x==null)return 1;
    if(y==null)return -1;
    const cmp=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),undefined,{numeric:true,sensitivity:"base"});
    return (desc?-cmp:cmp)||a.name.localeCompare(b.name);
  });
}

export default function TechnicianProductivityPage(){
  const[draft,setDraft]=useState<Period>(initialPeriod),[applied,setApplied]=useState<Period>(initialPeriod);
  const[preset,setPreset]=useState("thirty");
  const[report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const[search,setSearch]=useState("");
  const[sort,setSort]=useState<{key:Sort;desc:boolean}>({key:"name",desc:false});

  async function fetchReport(period:Period,techId?:number){
    setLoading(true);setError("");
    try{
      const params=new URLSearchParams({start:period.start,end:period.end});
      if(techId!==undefined)params.set("technician",String(techId));
      const response=await fetch("/api/reports/technician-productivity?"+params,{cache:"no-store"});
      const body=await response.json() as Report;
      if(!response.ok)throw new Error(body.error||"The report could not be loaded.");
      setReport(body);setApplied(period);
    }catch(e){setError(e instanceof Error?e.message:"The report could not be loaded.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void fetchReport(initialPeriod);},[]);
  const visible=useMemo(()=>orderTechnicians((report?.technicians??[]).filter(t=>t.name.toLowerCase().includes(search.trim().toLowerCase())),sort.key,sort.desc),[report,search,sort]);
  const selected=report?.technicians.find(t=>t.id===report.selectedTechnicianId)??null;
  function changePreset(value:string){setPreset(value);const next=presetRange(value);setDraft(next);void fetchReport(next);}
  function applyDates(event:FormEvent){event.preventDefault();void fetchReport(draft);}
  function toggleSort(key:Sort){setSort(old=>({key,desc:old.key===key?!old.desc:key!=="name"}));}
  function exportTechs(){
    if(!report)return;
    saveCsv("technician-productivity-"+applied.start+"-"+applied.end+".csv",visible.map(t=>({
      From:applied.start,Through:applied.end,Technician:t.name,Active:t.active?"Yes":"No",
      "Direct repair hours":t.directHours,"Indirect hours":t.indirectHours,"Total tracked hours":t.totalHours,
      "Tracked productivity %":t.productivityPercent??"No time recorded","Indirect %":t.indirectPercent??"No time recorded",
      "Repair jobs worked":t.repairCount,"Indirect activities":t.indirectActivities,
      "Days with logged labor":t.loggedDays,"Labor entries":t.timeEntries,
      "Hours without timer timestamps":t.noTimerHours,"Timers still running (excluded)":t.runningTimers,
    })));
  }
  function exportDays(){
    if(!selected||!report)return;
    saveCsv("technician-"+selected.id+"-daily-"+applied.start+"-"+applied.end+".csv",report.daily.map(d=>({
      Date:d.date,Technician:selected.name,"Direct hours":d.directHours,"Indirect hours":d.indirectHours,
      "Total tracked hours":d.totalHours,"Tracked productivity %":d.productivityPercent??"No time recorded",
      "Repair jobs worked":d.repairCount,"Indirect activities":d.indirectActivities,"Hours without timer timestamps":d.noTimerHours,
    })));
  }
  const columns:Array<{key:Sort;label:string}>=[
    {key:"name",label:"Technician"},{key:"productivityPercent",label:"Productivity"},
    {key:"directHours",label:"Direct hrs"},{key:"indirectHours",label:"Indirect hrs"},
    {key:"totalHours",label:"Total logged"},{key:"repairCount",label:"Repairs worked"},
    {key:"loggedDays",label:"Logged days"},{key:"noTimerHours",label:"Untimed / legacy hrs"},
  ];
  return <main id="technician-productivity-page" style={{minHeight:"100vh",background:"#f3f5f7",color:"#172536",padding:"clamp(14px,2.2vw,30px)"}}>
    <style>{"@media print { .tech-prod-no-print,.app-sidebar,.app-shell-sidebar,.sidebar-shell,.app-nav {display:none!important} #technician-productivity-page {padding:0!important;background:#fff!important} .tech-prod-scroll {max-height:none!important;overflow:visible!important} #technician-productivity-page tr {break-inside:avoid} }"}</style>
    <header style={{display:"flex",gap:14,justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",marginBottom:15}}>
      <div>
        <p style={{fontSize:11,letterSpacing:".13em",fontWeight:900,color:"#e96a16",margin:0}}>NORTHERN LOGISTICS · REPORTS</p>
        <h1 style={{fontSize:"clamp(24px,2.4vw,32px)",margin:"5px 0 7px"}}>Technician Productivity</h1>
        <p style={{fontSize:13,color:"#617587",margin:0}}>Percent of logged labor time spent on direct repairs versus indirect shop work.</p>
      </div>
      <div className="tech-prod-no-print" style={{display:"flex",flexWrap:"wrap",gap:8}}>
        <a style={{...light,textDecoration:"none"}} href="/reports">← Fleet Reports</a>
        <button type="button" onClick={()=>window.print()} style={light} disabled={!report}>Print</button>
        <button type="button" onClick={exportTechs} style={action} disabled={!visible.length}>Export CSV</button>
      </div>
    </header>
    <section className="tech-prod-no-print" style={{...panel,padding:14,marginBottom:14}}>
      <form onSubmit={applyDates} style={{display:"flex",gap:9,flexWrap:"wrap",alignItems:"end"}}>
        <label style={{display:"grid",gap:4,fontSize:12,fontWeight:800}}>Date range
          <select style={input} value={preset} onChange={e=>changePreset(e.target.value)}>
            <option value="today">Today</option><option value="week">Last 7 days</option>
            <option value="thirty">Last 30 days</option><option value="month">This month</option>
            <option value="ninety">Last 90 days</option><option value="year">Year to date</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label style={{display:"grid",gap:4,fontSize:12,fontWeight:800}}>From
          <input type="date" value={draft.start} onChange={e=>{setDraft({...draft,start:e.target.value});setPreset("custom");}} style={input} required/>
        </label>
        <label style={{display:"grid",gap:4,fontSize:12,fontWeight:800}}>Through
          <input type="date" value={draft.end} onChange={e=>{setDraft({...draft,end:e.target.value});setPreset("custom");}} style={input} required/>
        </label>
        <button type="submit" disabled={loading} style={action}>{loading?"Loading…":"Run Report"}</button>
        <button type="button" disabled={loading} style={light} onClick={()=>void fetchReport(applied)}>Refresh</button>
        <label style={{display:"grid",gap:4,fontSize:12,fontWeight:800,flex:"1 1 220px"}}>Find technician
          <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name…" style={input}/>
        </label>
      </form>
      <p style={{margin:"9px 0 0",fontSize:12,color:"#64748b"}}>Report dates may span up to 366 days. Select a preset or choose custom dates and Run Report.</p>
    </section>
    {error&&<p role="alert" style={{...panel,padding:13,color:"#be123c",borderColor:"#fecaca"}}>{error}</p>}
    {!report&&!error&&<p role="status" style={{padding:20,color:"#64748b"}}>Loading logged labor hours…</p>}
    {report&&<>
      <p style={{display:"flex",gap:12,justifyContent:"space-between",flexWrap:"wrap",margin:"0 0 11px",fontSize:12,color:"#475569"}}>
        <strong>Report: {applied.start} through {applied.end}</strong>
        <span>Updated {new Date(report.updatedAt).toLocaleString()}</span>
      </p>
      <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(166px,1fr))",gap:10,marginBottom:14}}>
        {[
          ["Tracked productivity",percent(report.summary.productivityPercent),"Direct ÷ direct and indirect time"],
          ["Direct labor",hours(report.summary.directHours)+" h","Repair, PM and annual labor"],
          ["Indirect labor",hours(report.summary.indirectHours)+" h","INDIRECT LABOR-OTHER"],
          ["Total logged time",hours(report.summary.totalHours)+" h","Direct + indirect"],
          ["Techs with hours",String(report.summary.techniciansWithHours),"Of "+report.summary.techniciansListed+" technicians"],
          ["Hours lacking timestamps",hours(report.summary.noTimerHours)+" h","Manual or older labor records"],
        ].map(([label,value,note])=><div key={label} style={{...panel,padding:15}}>
          <div style={{fontSize:11,color:"#65758b",fontWeight:850}}>{label}</div>
          <div style={{fontSize:23,fontWeight:900,margin:"7px 0 4px",fontVariantNumeric:"tabular-nums"}}>{value}</div>
          <div style={{fontSize:11,color:"#8190a0"}}>{note}</div>
        </div>)}
      </section>
      <section style={{...panel,padding:14,marginBottom:14}}>
        <strong style={{fontSize:13}}>How the percentage is calculated</strong>
        <p style={{fontSize:13,lineHeight:1.55,margin:"6px 0 6px",color:"#475569"}}>
          <strong>Tracked Productivity % = Direct Repair Hours ÷ (Direct + Indirect Logged Hours) × 100.</strong>
          {" "}This is the share of recorded time spent on maintenance, not the percent of paid shift hours worked or flat-rate efficiency.
        </p>
        <p style={{fontSize:12,lineHeight:1.5,margin:0,color:"#64748b"}}>
          Technicians with no saved labor show <strong>—</strong>, not 0%. Dates follow the saved UTC labor date when the timer stops.
          Manual and older entries without start/end timestamps count but are flagged. Running timers ({report.summary.runningTimers}) are excluded until stopped.
          Time not recorded in the software cannot be counted as either productive or unproductive.
        </p>
      </section>
      <section style={{...panel,marginBottom:14}}>
        <div style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div><h2 style={{fontSize:19,margin:0}}>Technician Breakdown</h2>
            <p style={{fontSize:12,color:"#64748b",margin:"5px 0 0"}}>Select a column heading to sort or view a technician's daily details. Summary totals above include all techs, not just search matches.</p></div>
          <span style={{fontSize:12,color:"#64748b"}}>{visible.length} shown</span>
        </div>
        <div className="tech-prod-scroll" role="region" aria-label="Technician productivity by employee" tabIndex={0} style={{maxHeight:610,overflow:"auto"}}>
          <table style={{borderCollapse:"collapse",width:"100%",minWidth:1080}}>
            <thead><tr>{columns.map(col=><th scope="col" key={col.key} aria-sort={sort.key===col.key?(sort.desc?"descending":"ascending"):"none"} style={th}>
              <button type="button" onClick={()=>toggleSort(col.key)} style={{border:0,background:"transparent",padding:0,cursor:"pointer",fontSize:12,fontWeight:850,color:"#334155"}}>
                {col.label} <span aria-hidden="true">{sort.key===col.key?(sort.desc?"↓":"↑"):"↕"}</span>
              </button></th>)}<th style={th}>Daily</th></tr></thead>
            <tbody>{visible.length===0&&<tr><td colSpan={9} style={{padding:25,color:"#64748b",textAlign:"center"}}>No technicians match the selected filters.</td></tr>}
              {visible.map(t=><tr key={t.id} style={{background:selected?.id===t.id?"#eef6ff":t.totalHours>0?"#fff":"#fafbfd"}}>
                <td style={td}><strong>{t.name}</strong>
                  {!t.active&&<small style={{display:"block",color:"#64748b"}}>Inactive</small>}
                  {t.runningTimers>0&&<small style={{display:"block",color:"#b45309"}}>Timer running (excluded)</small>}
                </td>
                <td style={td}><strong>{percent(t.productivityPercent)}</strong>
                  {t.productivityPercent!==null&&<div aria-hidden="true" style={{width:120,height:7,background:"#e9eef2",borderRadius:10,marginTop:5,overflow:"hidden"}}>
                    <div style={{height:"100%",width:t.productivityPercent+"%",background:"#2874c9"}}/>
                  </div>}
                  {t.productivityPercent===null&&<small style={{display:"block",color:"#94a3b8"}}>No logged time</small>}
                </td>
                <td style={td}>{hours(t.directHours)}</td><td style={td}>{hours(t.indirectHours)}</td>
                <td style={{...td,fontWeight:800}}>{hours(t.totalHours)}</td>
                <td style={td}>{t.repairCount}</td><td style={td}>{t.loggedDays}</td><td style={td}>{hours(t.noTimerHours)}</td>
                <td style={td}><button type="button" className="tech-prod-no-print" style={{...light,padding:"7px 11px"}}
                  disabled={loading} onClick={()=>void fetchReport(applied,selected?.id===t.id?undefined:t.id)}>
                  {selected?.id===t.id?"Close":"View days"}</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
      {selected&&<section style={{...panel,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:9,alignItems:"center",flexWrap:"wrap",padding:"14px 16px"}}>
          <div><h2 style={{fontSize:19,margin:0}}>{selected.name} · Daily Labor</h2>
            <p style={{fontSize:12,color:"#64748b",margin:"4px 0 0"}}>{hours(selected.directHours)} direct + {hours(selected.indirectHours)} indirect = {percent(selected.productivityPercent)} tracked productivity</p>
          </div>
          <div className="tech-prod-no-print" style={{display:"flex",gap:8}}>
            <button type="button" style={light} disabled={!report.daily.length} onClick={exportDays}>Export daily CSV</button>
            <button type="button" style={light} onClick={()=>void fetchReport(applied)}>Close</button>
          </div>
        </div>
        <div className="tech-prod-scroll" role="region" aria-label="Daily recorded technician time" tabIndex={0} style={{maxHeight:390,overflow:"auto"}}>
          <table style={{borderCollapse:"collapse",width:"100%",minWidth:770}}>
            <thead><tr>{["Date","Direct hrs","Indirect hrs","Total hrs","Productivity","Repairs","Indirect activities","Untimed / legacy hrs"].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
            <tbody>{report.daily.map(d=><tr key={d.date}><td style={td}>{d.date}</td><td style={td}>{hours(d.directHours)}</td><td style={td}>{hours(d.indirectHours)}</td>
              <td style={td}>{hours(d.totalHours)}</td><td style={td}>{percent(d.productivityPercent)}</td><td style={td}>{d.repairCount}</td>
              <td style={td}>{d.indirectActivities}</td><td style={td}>{hours(d.noTimerHours)}</td></tr>)}
            {!report.daily.length&&<tr><td style={{...td,padding:20}} colSpan={8}>No saved labor entries for these dates.</td></tr>}</tbody>
          </table>
        </div>
      </section>}
    </>}
  </main>;
}
