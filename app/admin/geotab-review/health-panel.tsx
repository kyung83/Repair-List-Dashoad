"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type AttentionRow={
  equipmentId:number;unit:string;equipmentType:string;geotabDeviceId:string;
  trackingState:string;trackingLabel:string;trackingDetail:string;ageLabel:string;
  stale:boolean;actuallyNotTracking:boolean;locationUsable:boolean;
  gpsObservedAt:string|null;gpsSource:string;communicating:boolean|null;
  yard:string;yardZoneName:string;structured:boolean;
};
type Health={
  status:string;mode:string;
  summary:{
    expected:number;structured:number;live:number;recent:number;parkedConfirmed:number;stale:number;
    noData:number;offline:number;identityErrors:number;locationKnown:number;actuallyNotTracking:number;
  };
  lastRun:Record<string,unknown>|null;zones:Record<string,unknown>[];attention:AttentionRow[];updatedAt:string;
};
type Filter="all"|"parked"|"stale"|"notTracking"|"noData"|"identity";

function when(value:unknown){const raw=String(value??"");if(!raw)return"—";const parsed=new Date(raw);return Number.isNaN(parsed.getTime())?raw:parsed.toLocaleString();}
function yard(value:string){return value?value.toUpperCase():"Outside / last known";}

const filterLabels:Record<Filter,string>={
  all:"All units needing attention",
  parked:"Parked · last confirmed",
  stale:"Stale · last known",
  notTracking:"Actually not tracking",
  noData:"No GPS data",
  identity:"No valid device mapping",
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
      const response=await fetch('/api/geotab-health',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'retryGps',equipmentId:row.equipmentId})});
      const result=await response.json() as{error?:string;message?:string};
      if(!response.ok)throw new Error(result.error||'GPS retry failed.');
      setMessage(`${row.unit}: ${result.message||'Geotab retry completed.'}`);await load();
    }catch(e){setMessage(e instanceof Error?e.message:'GPS retry failed.');}finally{setBusy(null);}
  }

  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),120000);return()=>window.clearInterval(timer);},[]);
  const summary=data?.summary;
  const healthy=data?.status==='healthy';
  const visible=useMemo(()=>{
    const rows=data?.attention??[];
    if(filter==='parked')return rows.filter(row=>row.trackingState==='PARKED_CONFIRMED');
    if(filter==='stale')return rows.filter(row=>row.trackingState==='STALE_LAST_KNOWN');
    if(filter==='notTracking')return rows.filter(row=>row.trackingState==='NOT_TRACKING');
    if(filter==='noData')return rows.filter(row=>row.trackingState==='NO_GPS_DATA');
    if(filter==='identity')return rows.filter(row=>row.trackingState==='UNMAPPED');
    return rows;
  },[data,filter]);

  return <section id="gps-yard-health" style={{background:'#f3f5f7',padding:'0 clamp(16px,4vw,46px) 0',color:'#182331'}}>
    <div style={{background:'#fff',border:`1px solid ${healthy?'#acd7bb':'#e8c475'}`,borderRadius:14,padding:16,boxShadow:'0 2px 10px rgba(15,32,48,.05)'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,fontWeight:900,letterSpacing:'.08em',color:'#6c7782'}}>DIAGNOSTICS · GPS / YARD HEALTH</div>
          <div style={{marginTop:5,fontSize:20,fontWeight:900,color:'#102238'}}>Geotab location {healthy?'healthy':'needs attention'} {healthy?'✓':'⚠'}</div>
          <div style={{marginTop:4,fontSize:13,color:'#657381'}}>The app now keeps the last good location. An old GPS point is not the same as a dead tracker.</div>
        </div>
        <button type="button" onClick={()=>void load()} disabled={busy!==null}>Refresh health</button>
      </div>

      <div style={legend}>
        <strong>How to read this:</strong> <b>STALE</b> means we still have a real last location, but it is old. <b>NOT TRACKING</b> only means Geotab explicitly reports the device is not communicating. <b>PARKED · LAST CONFIRMED</b> means the old GPS point was inside one of our yards, so the yard stays usable until movement proves otherwise.
      </div>
      {(error||message)&&<div style={{marginTop:12,padding:10,borderRadius:8,background:'#fff4dd',border:'1px solid #e8c475'}}>{error||message}</div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:9,marginTop:14}}>
        <Metric label="Mapped units" value={summary?`${summary.structured}/${summary.expected}`:'—'} />
        <Metric label="Live" value={summary?.live??'—'} />
        <Metric label="Recent" value={summary?.recent??'—'} />
        <Metric label="Parked / confirmed" value={summary?.parkedConfirmed??'—'} active={filter==='parked'} onClick={()=>setFilter('parked')} />
        <Metric label="Stale last-known" value={summary?.stale??'—'} warn={Boolean(summary?.stale)} active={filter==='stale'} onClick={()=>setFilter('stale')} />
        <Metric label="Not tracking" value={summary?.offline??'—'} danger={Boolean(summary?.offline)} active={filter==='notTracking'} onClick={()=>setFilter('notTracking')} />
        <Metric label="No GPS data" value={summary?.noData??'—'} warn={Boolean(summary?.noData)} active={filter==='noData'} onClick={()=>setFilter('noData')} />
        <Metric label="Mapping issues" value={summary?.identityErrors??'—'} warn={Boolean(summary?.identityErrors)} active={filter==='identity'} onClick={()=>setFilter('identity')} />
      </div>

      <section style={{marginTop:16,border:'1px solid #dfe5e9',borderRadius:11,overflow:'hidden'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',padding:'11px 12px',background:'#f7f9fa',borderBottom:'1px solid #dfe5e9'}}>
          <div><strong>{filterLabels[filter]}</strong><div style={{fontSize:11,color:'#71808c',marginTop:2}}>{visible.length} unit{visible.length===1?'':'s'} in this view</div></div>
          {filter!=='all'&&<button type="button" onClick={()=>setFilter('all')}>Show all attention</button>}
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:1100,fontSize:13}}>
            <thead><tr>{['Unit','Tracking state','Last confirmed location','Device','Communicating','Last GPS','What it means','Fix / inspect'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
            <tbody>{visible.length?visible.map(row=><tr key={`${row.equipmentId}-${row.trackingState}`} style={{borderTop:'1px solid #edf0f2'}}>
              <td style={td}><strong>{row.unit}</strong><div style={meta}>{row.equipmentType||'equipment'} · #{row.equipmentId}</div></td>
              <td style={td}><strong style={{color:row.actuallyNotTracking?'#a12b22':row.stale?'#8a5a05':'#19324a'}}>{row.trackingLabel}</strong></td>
              <td style={td}>{row.locationUsable?yard(row.yard):'Unknown'}{row.yardZoneName&&<div style={meta}>{row.yardZoneName}</div>}</td>
              <td style={{...td,fontFamily:'monospace'}}>{row.geotabDeviceId||'—'}</td>
              <td style={td}>{row.communicating===null?'Unknown':row.communicating?'Yes':'No'}</td>
              <td style={td}>{row.gpsObservedAt?when(row.gpsObservedAt):'Never'}<div style={meta}>{row.ageLabel}</div></td>
              <td style={{...td,maxWidth:300}}>{row.trackingDetail}</td>
              <td style={td}><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {row.structured&&<button type="button" disabled={busy!==null} onClick={()=>void retryGps(row)}>{busy===row.equipmentId?'Checking…':'Check device now'}</button>}
                <a href={`/unit?unit=${encodeURIComponent(row.unit)}`} style={actionLink}>Open unit</a>
                {!row.structured&&<a href="/admin/geotab-review" style={actionLink}>Fix mapping</a>}
              </div></td>
            </tr>):<tr><td style={td} colSpan={8}>No units in this filter currently need attention.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <details style={{marginTop:12}}><summary style={{cursor:'pointer',fontWeight:850}}>Feed and yard-zone details</summary>
        <div style={{marginTop:9,fontSize:13,color:'#5f6f7e',lineHeight:1.6}}>
          <div><strong>Location feed:</strong> {data?.lastRun?`${String(data.lastRun.result_status??'unknown')} · ${when(data.lastRun.finished_at)} · ${String(data.lastRun.message??'')}`:'Initializing the LogRecord feed.'}</div>
          <div style={{marginTop:6}}><strong>Yard zones:</strong> {data?.zones?.map(zone=>`${String(zone.yard_key??'')}=${String(zone.geotab_zone_name??zone.expected_name??'unresolved')} (${String(zone.status??'')})`).join(' · ')||'—'}</div>
        </div>
      </details>
    </div>
  </section>;
}

function Metric({label,value,warn=false,danger=false,active=false,onClick}:{label:string;value:string|number;warn?:boolean;danger?:boolean;active?:boolean;onClick?:()=>void}){
  const border=active?'#8fa7b9':danger?'#e0a49e':warn?'#eccb8e':'#e3e8ec';
  const background=active?'#eef3f7':danger?'#fff2f1':warn?'#fff6e8':'#f7f9fa';
  const style:CSSProperties={padding:'10px 11px',borderRadius:9,background,border:`1px solid ${border}`,textAlign:'left',width:'100%',minHeight:70,color:'inherit'};
  const body=<><div style={{fontSize:11,fontWeight:800,color:'#72808e',textTransform:'uppercase',letterSpacing:'.04em'}}>{label}</div><div style={{fontSize:20,fontWeight:900,marginTop:3,color:danger?'#a12b22':warn?'#8a5a05':'#19324a'}}>{value}</div>{onClick&&<div style={{fontSize:9,color:'#7a8791',marginTop:3}}>Click to inspect</div>}</>;
  return onClick?<button type="button" style={{...style,cursor:'pointer'}} onClick={onClick}>{body}</button>:<div style={style}>{body}</div>;
}
const legend:CSSProperties={marginTop:12,padding:'10px 12px',borderRadius:9,background:'#f5f8fa',border:'1px solid #dbe3e8',fontSize:12,color:'#536574',lineHeight:1.55};
const th:CSSProperties={textAlign:'left',padding:'8px 9px',fontSize:11,textTransform:'uppercase',letterSpacing:'.04em',color:'#6c7a87',background:'#f7f9fa'};
const td:CSSProperties={padding:'9px',verticalAlign:'top'};
const meta:CSSProperties={fontSize:10,color:'#7a8791',marginTop:2};
const actionLink:CSSProperties={display:'inline-flex',alignItems:'center',padding:'5px 7px',border:'1px solid #ccd5dd',borderRadius:7,color:'#17324a',textDecoration:'none',fontWeight:800,fontSize:11,whiteSpace:'nowrap'};
