"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type AttentionRow = {
  equipmentId:number;
  unit:string;
  equipmentType:string;
  geotabDeviceId:string;
  status:string;
  gpsObservedAt:string|null;
  gpsSource:string;
  communicating:boolean|null;
  yard:string;
  yardZoneName:string;
  legacyYard:string;
  diffCategory:string;
  structured:boolean;
};
type Health = {
  status:string;
  mode:string;
  summary:{
    expected:number; structured:number; live:number; recent:number; stale:number; noData:number; offline:number;
    identityErrors:number; equivalent:number; improvement:number; regression:number; changed:number;
  };
  lastRun:Record<string,unknown>|null;
  zones:Record<string,unknown>[];
  attention:AttentionRow[];
  updatedAt:string;
};
type Filter = "all"|"stale"|"noData"|"offline"|"identity"|"regression";

function when(value:unknown){
  const raw=String(value??"");
  if(!raw)return "—";
  const parsed=new Date(raw);
  return Number.isNaN(parsed.getTime())?raw:parsed.toLocaleString();
}
function yard(value:string){return value?value.toUpperCase():"Outside / unknown";}

const filterLabels:Record<Filter,string>={
  all:"All units needing attention",
  stale:"Stale GPS",
  noData:"No GPS data",
  offline:"Offline devices",
  identity:"Identity / assignment issues",
  regression:"Possible yard regressions",
};

export default function GeotabHealthPanel(){
  const[data,setData]=useState<Health|null>(null);
  const[error,setError]=useState("");
  const[message,setMessage]=useState("");
  const[filter,setFilter]=useState<Filter>("all");
  const[busy,setBusy]=useState<number|null>(null);

  async function load(){
    try{
      const response=await fetch('/api/geotab-health',{cache:'no-store'});
      const result=await response.json() as Health&{error?:string};
      if(!response.ok)throw new Error(result.error||'Geotab health could not be loaded.');
      setData(result);setError("");
    }catch(e){setError(e instanceof Error?e.message:'Geotab health could not be loaded.');}
  }

  async function retryGps(row:AttentionRow){
    setBusy(row.equipmentId);setMessage("");
    try{
      const response=await fetch('/api/geotab-health',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({action:'retryGps',equipmentId:row.equipmentId}),
      });
      const result=await response.json() as{error?:string;message?:string;returned?:boolean;newerPosition?:boolean};
      if(!response.ok)throw new Error(result.error||'GPS retry failed.');
      setMessage(`${row.unit}: ${result.message||'Geotab retry completed.'}`);
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'GPS retry failed.');}finally{setBusy(null);}
  }

  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),120000);return()=>window.clearInterval(timer);},[]);

  const summary=data?.summary;
  const healthy=data?.status==='healthy';
  const visible=useMemo(()=>{
    const rows=data?.attention??[];
    if(filter==='stale')return rows.filter(row=>row.status==='STALE');
    if(filter==='noData')return rows.filter(row=>row.status==='NO_DATA');
    if(filter==='offline')return rows.filter(row=>row.communicating===false);
    if(filter==='identity')return rows.filter(row=>!row.structured);
    if(filter==='regression')return rows.filter(row=>row.diffCategory==='regression');
    return rows;
  },[data,filter]);

  return <section id="gps-yard-health" style={{background:'#f3f5f7',padding:'0 clamp(16px,4vw,46px) 0',color:'#182331'}}>
    <div style={{background:'#fff',border:`1px solid ${healthy?'#acd7bb':'#e8c475'}`,borderRadius:14,padding:16,boxShadow:'0 2px 10px rgba(15,32,48,.05)'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,fontWeight:900,letterSpacing:'.08em',color:'#6c7782'}}>DIAGNOSTICS · GPS / YARD HEALTH</div>
          <div style={{marginTop:5,fontSize:20,fontWeight:900,color:'#102238'}}>Geotab health {healthy?'healthy':'needs attention'} {healthy?'✓':'⚠'}</div>
          <div style={{marginTop:4,fontSize:13,color:'#657381'}}>Counts are now filters. Click a warning, inspect the exact units, retry that device, or open the unit record. The legacy yard writer still controls Shop routing while this shadow engine is being validated.</div>
        </div>
        <button type="button" onClick={()=>void load()} disabled={busy!==null}>Refresh health</button>
      </div>

      {(error||message)&&<div style={{marginTop:12,padding:10,borderRadius:8,background:'#fff4dd',border:'1px solid #e8c475'}}>{error||message}</div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:9,marginTop:14}}>
        <Metric label="Structured results" value={summary?`${summary.structured}/${summary.expected}`:'—'} active={filter==='all'} onClick={()=>setFilter('all')} />
        <Metric label="Live" value={summary?.live??'—'} />
        <Metric label="Recent" value={summary?.recent??'—'} />
        <Metric label="Stale" value={summary?.stale??'—'} warn={Boolean(summary?.stale)} active={filter==='stale'} onClick={()=>setFilter('stale')} />
        <Metric label="No GPS data" value={summary?.noData??'—'} warn={Boolean(summary?.noData)} active={filter==='noData'} onClick={()=>setFilter('noData')} />
        <Metric label="Offline" value={summary?.offline??'—'} warn={Boolean(summary?.offline)} active={filter==='offline'} onClick={()=>setFilter('offline')} />
        <Metric label="Identity issues" value={summary?.identityErrors??'—'} warn={Boolean(summary?.identityErrors)} active={filter==='identity'} onClick={()=>setFilter('identity')} />
        <Metric label="Old blank / new kept" value={summary?.improvement??'—'} />
        <Metric label="Possible regressions" value={summary?.regression??'—'} warn={Boolean(summary?.regression)} active={filter==='regression'} onClick={()=>setFilter('regression')} />
      </div>

      <section style={{marginTop:16,border:'1px solid #dfe5e9',borderRadius:11,overflow:'hidden'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',padding:'11px 12px',background:'#f7f9fa',borderBottom:'1px solid #dfe5e9'}}>
          <div><strong>{filterLabels[filter]}</strong><div style={{fontSize:11,color:'#71808c',marginTop:2}}>{visible.length} loaded diagnostic row{visible.length===1?'':'s'} · use Retry GPS to ask Geotab for this assigned device now</div></div>
          {filter!=='all'&&<button type="button" onClick={()=>setFilter('all')}>Show all attention</button>}
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:1080,fontSize:13}}>
            <thead><tr>{['Unit','GPS state','Shadow yard','Legacy yard','Device','Communicating','Last GPS','Comparison','Fix / inspect'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
            <tbody>{visible.length?visible.map(row=><tr key={row.equipmentId} style={{borderTop:'1px solid #edf0f2'}}>
              <td style={td}><strong>{row.unit}</strong><div style={{fontSize:10,color:'#7a8791'}}>{row.equipmentType||'equipment'} · #{row.equipmentId}</div></td>
              <td style={td}>{row.status}</td>
              <td style={td}>{yard(row.yard)}</td>
              <td style={td}>{yard(row.legacyYard)}</td>
              <td style={{...td,fontFamily:'monospace'}}>{row.geotabDeviceId}</td>
              <td style={td}>{row.communicating===null?'Unknown':row.communicating?'Yes':'No'}</td>
              <td style={td}>{when(row.gpsObservedAt)}</td>
              <td style={td}>{row.diffCategory}</td>
              <td style={td}><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button type="button" disabled={busy!==null} onClick={()=>void retryGps(row)}>{busy===row.equipmentId?'Retrying…':'Retry GPS'}</button>
                <a href={`/unit?unit=${encodeURIComponent(row.unit)}`} style={actionLink}>Open unit</a>
                {(!row.structured||row.diffCategory==='regression')&&<a href="#geotab-review-detail" style={actionLink}>Review mapping</a>}
              </div></td>
            </tr>):<tr><td style={td} colSpan={9}>No units in this filter currently need attention.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <details style={{marginTop:12}}>
        <summary style={{cursor:'pointer',fontWeight:850}}>Last shadow run and pinned yard zones</summary>
        <div style={{marginTop:9,fontSize:13,color:'#5f6f7e',lineHeight:1.6}}>
          <div><strong>Last run:</strong> {data?.lastRun?`${String(data.lastRun.result_status??'unknown')} · ${when(data.lastRun.finished_at||data.lastRun.started_at)} · ${String(data.lastRun.message??'')}`:'No shadow run has completed yet.'}</div>
          <div style={{marginTop:6}}><strong>Zone pins:</strong> {data?.zones?.map(zone=>`${String(zone.yard_key??'')}=${String(zone.geotab_zone_id??'unresolved')} (${String(zone.status??'')})`).join(' · ')||'—'}</div>
        </div>
      </details>
    </div>
  </section>;
}

function Metric({label,value,warn=false,active=false,onClick}:{label:string;value:string|number;warn?:boolean;active?:boolean;onClick?:()=>void}){
  const style:CSSProperties={padding:'10px 11px',borderRadius:9,background:active?'#eef3f7':warn?'#fff6e8':'#f7f9fa',border:`1px solid ${active?'#8fa7b9':warn?'#eccb8e':'#e3e8ec'}`,textAlign:'left',width:'100%',minHeight:70,color:'inherit'};
  const body=<><div style={{fontSize:11,fontWeight:800,color:'#72808e',textTransform:'uppercase',letterSpacing:'.04em'}}>{label}</div><div style={{fontSize:20,fontWeight:900,marginTop:3,color:warn?'#8a5a05':'#19324a'}}>{value}</div>{onClick&&<div style={{fontSize:9,color:'#7a8791',marginTop:3}}>Click to inspect</div>}</>;
  return onClick?<button type="button" style={{...style,cursor:'pointer'}} onClick={onClick}>{body}</button>:<div style={style}>{body}</div>;
}
const th:CSSProperties={textAlign:'left',padding:'8px 9px',fontSize:11,textTransform:'uppercase',letterSpacing:'.04em',color:'#6c7a87',background:'#f7f9fa'};
const td:CSSProperties={padding:'9px',verticalAlign:'top'};
const actionLink:CSSProperties={display:'inline-flex',alignItems:'center',padding:'5px 7px',border:'1px solid #ccd5dd',borderRadius:7,color:'#17324a',textDecoration:'none',fontWeight:800,fontSize:11,whiteSpace:'nowrap'};
