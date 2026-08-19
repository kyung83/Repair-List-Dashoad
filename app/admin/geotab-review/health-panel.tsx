"use client";

import { useEffect, useState, type CSSProperties } from "react";

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

function when(value:unknown){
  const raw=String(value??"");
  if(!raw)return "—";
  const parsed=new Date(raw);
  return Number.isNaN(parsed.getTime())?raw:parsed.toLocaleString();
}
function yard(value:string){return value?value.toUpperCase():"Outside / unknown";}

export default function GeotabHealthPanel(){
  const[data,setData]=useState<Health|null>(null);
  const[error,setError]=useState("");

  async function load(){
    try{
      const response=await fetch('/api/geotab-health',{cache:'no-store'});
      const result=await response.json() as Health&{error?:string};
      if(!response.ok)throw new Error(result.error||'Geotab health could not be loaded.');
      setData(result);setError("");
    }catch(e){setError(e instanceof Error?e.message:'Geotab health could not be loaded.');}
  }
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),120000);return()=>window.clearInterval(timer);},[]);

  const summary=data?.summary;
  const healthy=data?.status==='healthy';
  return <section style={{background:'#f3f5f7',padding:'20px clamp(16px,4vw,46px) 0',color:'#182331'}}>
    <div style={{background:'#fff',border:`1px solid ${healthy?'#acd7bb':'#e8c475'}`,borderRadius:14,padding:16,boxShadow:'0 2px 10px rgba(15,32,48,.05)'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:12,fontWeight:900,letterSpacing:'.08em',color:'#6c7782'}}>GPS / YARD RELIABILITY PILOT · SHADOW MODE</div>
          <div style={{marginTop:5,fontSize:20,fontWeight:900,color:'#102238'}}>Geotab health {healthy?'healthy':'needs attention'} {healthy?'✓':'⚠'}</div>
          <div style={{marginTop:4,fontSize:13,color:'#657381'}}>The legacy yard writer still controls Shop routing. This panel compares the new last-known-good engine without changing technician screens.</div>
        </div>
        <button type="button" onClick={()=>void load()}>Refresh health</button>
      </div>

      {error&&<div style={{marginTop:12,padding:10,borderRadius:8,background:'#fff4dd',border:'1px solid #e8c475'}}>{error}</div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:9,marginTop:14}}>
        <Metric label="Structured results" value={summary?`${summary.structured}/${summary.expected}`:'—'} />
        <Metric label="Live" value={summary?.live??'—'} />
        <Metric label="Recent" value={summary?.recent??'—'} />
        <Metric label="Stale" value={summary?.stale??'—'} warn={Boolean(summary?.stale)} />
        <Metric label="No GPS data" value={summary?.noData??'—'} warn={Boolean(summary?.noData)} />
        <Metric label="Offline" value={summary?.offline??'—'} warn={Boolean(summary?.offline)} />
        <Metric label="Identity issues" value={summary?.identityErrors??'—'} warn={Boolean(summary?.identityErrors)} />
        <Metric label="Old blank / new kept" value={summary?.improvement??'—'} />
        <Metric label="Possible regressions" value={summary?.regression??'—'} warn={Boolean(summary?.regression)} />
      </div>

      <details style={{marginTop:14}}>
        <summary style={{cursor:'pointer',fontWeight:850}}>Units needing attention ({data?.attention.length??0})</summary>
        <div style={{overflowX:'auto',marginTop:10}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:820,fontSize:13}}>
            <thead><tr>{['Unit','GPS state','Shadow yard','Legacy yard','Device','Communicating','Last GPS','Comparison'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead>
            <tbody>{data?.attention.length?data.attention.map(row=><tr key={row.equipmentId} style={{borderTop:'1px solid #edf0f2'}}>
              <td style={td}><strong>{row.unit}</strong></td><td style={td}>{row.status}</td><td style={td}>{yard(row.yard)}</td><td style={td}>{yard(row.legacyYard)}</td><td style={{...td,fontFamily:'monospace'}}>{row.geotabDeviceId}</td><td style={td}>{row.communicating===null?'Unknown':row.communicating?'Yes':'No'}</td><td style={td}>{when(row.gpsObservedAt)}</td><td style={td}>{row.diffCategory}</td>
            </tr>):<tr><td style={td} colSpan={8}>No GPS/yard exceptions are currently waiting.</td></tr>}</tbody>
          </table>
        </div>
      </details>

      <details style={{marginTop:10}}>
        <summary style={{cursor:'pointer',fontWeight:850}}>Last shadow run and pinned yard zones</summary>
        <div style={{marginTop:9,fontSize:13,color:'#5f6f7e',lineHeight:1.6}}>
          <div><strong>Last run:</strong> {data?.lastRun?`${String(data.lastRun.result_status??'unknown')} · ${when(data.lastRun.finished_at||data.lastRun.started_at)} · ${String(data.lastRun.message??'')}`:'No shadow run has completed yet.'}</div>
          <div style={{marginTop:6}}><strong>Zone pins:</strong> {data?.zones?.map(zone=>`${String(zone.yard_key??'')}=${String(zone.geotab_zone_id??'unresolved')} (${String(zone.status??'')})`).join(' · ')||'—'}</div>
        </div>
      </details>
    </div>
  </section>;
}

function Metric({label,value,warn=false}:{label:string;value:string|number;warn?:boolean}){
  return <div style={{padding:'10px 11px',borderRadius:9,background:warn?'#fff6e8':'#f7f9fa',border:`1px solid ${warn?'#eccb8e':'#e3e8ec'}`}}><div style={{fontSize:11,fontWeight:800,color:'#72808e',textTransform:'uppercase',letterSpacing:'.04em'}}>{label}</div><div style={{fontSize:20,fontWeight:900,marginTop:3,color:warn?'#8a5a05':'#19324a'}}>{value}</div></div>;
}
const th:CSSProperties={textAlign:'left',padding:'8px 9px',fontSize:11,textTransform:'uppercase',letterSpacing:'.04em',color:'#6c7a87',background:'#f7f9fa'};
const td:CSSProperties={padding:'9px',verticalAlign:'top'};
