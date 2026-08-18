"use client";

import { useEffect, useMemo, useState } from "react";

type Equipment = {
  id:number; unit:string; equipmentType:string; geotabDeviceId:string|null; vin:string|null;
  currentMileage:number|null; mileageUpdatedAt:string|null; active:boolean; archivedAt:string|null;
  repairCount:number; completedRepairCount:number;
};
type IdentityItem = {
  geotabDeviceId:string; serialNumber:string|null; geotabName:string; vin:string|null; reason:string;
  candidateEquipmentIds:number[]; candidates:Equipment[]; firstSeenAt:string; lastSeenAt:string;
};
type MileageItem = {
  id:number; equipmentId:number; unit:string; geotabDeviceId:string; serialNumber:string|null;
  previousMileage:number|null; incomingMileage:number; rawMileage:number|null; adjustedMileage:number|null;
  previousUpdatedAt:string|null; reason:string; createdAt:string; mileageOffset:number;
};
type Fork = { geotabDeviceId:string; rows:Equipment[] };
type Data = {
  identityQueue:IdentityItem[]; mileageQueue:MileageItem[]; historicalForks:Fork[]; equipmentSearch:Equipment[];
  summary:{identityOpen:number;mileageOpen:number;historicalForkGroups:number}; error?:string;
};

const reasonLabel:Record<string,string>={
  duplicate_device_id:"Duplicate device ID",
  duplicate_vin:"Duplicate VIN",
  duplicate_normalized_unit:"Duplicate unit label",
  unmatched_device:"No safe equipment match",
  assignment_missing_equipment:"Assignment points to missing equipment",
  assigned_device_vin_conflict:"Assigned device VIN conflicts with truck",
  device_id_vin_conflict:"Device ID and VIN point to different trucks",
  unit_match_vin_conflict:"Unit label and VIN conflict",
  vin_match_is_archived:"VIN matches archived equipment",
  vin_match_has_other_active_device:"VIN already has another active device",
  vin_match_prior_device_not_visible:"Prior device is not visible in this Geotab response",
  unit_match_is_archived:"Unit label matches archived equipment",
  unit_match_has_other_device:"Unit label already has another device",
  equipment_already_claimed:"Equipment already has a current device",
};

export default function GeotabReviewPage(){
  const[data,setData]=useState<Data|null>(null);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState("");
  const[manualIds,setManualIds]=useState<Record<string,string>>({});
  const[searchDevice,setSearchDevice]=useState("");
  const[search,setSearch]=useState("");
  const[searchRows,setSearchRows]=useState<Equipment[]>([]);
  const[trustedMileage,setTrustedMileage]=useState<Record<number,string>>({});
  const[showForks,setShowForks]=useState(false);

  async function load(){
    const response=await fetch('/api/admin/geotab-reconciliation',{cache:'no-store'});
    if(response.status===401){window.location.assign('/login?returnTo=/admin/geotab-review');return;}
    const result=await response.json() as Data;
    if(!response.ok)throw new Error(result.error||'Geotab review could not be loaded.');
    setData(result);
    setTrustedMileage(current=>{const next={...current};for(const row of result.mileageQueue){if(next[row.id]===undefined&&row.previousMileage!==null)next[row.id]=String(row.previousMileage);}return next;});
  }
  useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:'Geotab review could not be loaded.'));},[]);

  async function post(body:Record<string,unknown>,key:string){
    setBusy(key);setMessage("");
    try{
      const response=await fetch('/api/admin/geotab-reconciliation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json() as{error?:string};
      if(!response.ok)throw new Error(result.error||'Action failed.');
      setMessage('Saved. Geotab identity/mileage review updated.');
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Action failed.');}finally{setBusy("");}
  }

  async function resolveIdentity(item:IdentityItem,equipmentId:number){
    const candidate=[...(item.candidates||[]),...searchRows].find(row=>row.id===equipmentId);
    const label=candidate?`${candidate.unit} (#${candidate.id})`:`equipment #${equipmentId}`;
    if(!window.confirm(`Link Geotab device ${item.geotabDeviceId} (${item.geotabName}) to ${label}?\n\nThis changes the current telematics assignment. It does not delete or merge repair history.`))return;
    const note=window.prompt('Optional resolution note:','')||'';
    await post({action:'resolveIdentity',geotabDeviceId:item.geotabDeviceId,equipmentId,note},`identity-${item.geotabDeviceId}`);
  }

  async function searchEquipment(item:IdentityItem){
    const q=search.trim();if(q.length<2)return setMessage('Type at least 2 characters to search equipment.');
    setBusy(`search-${item.geotabDeviceId}`);setMessage("");
    try{
      const response=await fetch(`/api/admin/geotab-reconciliation?q=${encodeURIComponent(q)}`,{cache:'no-store'});
      const result=await response.json() as Data;
      if(!response.ok)throw new Error(result.error||'Equipment search failed.');
      setSearchRows(result.equipmentSearch||[]);setSearchDevice(item.geotabDeviceId);
    }catch(e){setMessage(e instanceof Error?e.message:'Equipment search failed.');}finally{setBusy("");}
  }

  async function calibrate(row:MileageItem,value:string){
    const mileage=Number(value.replace(/,/g,''));
    if(!Number.isFinite(mileage)||mileage<0)return setMessage('Enter a valid trusted mileage.');
    const raw=row.rawMileage??row.incomingMileage;
    const offset=Math.round(mileage)-raw;
    if(!window.confirm(`Set ${row.unit} trusted mileage to ${Math.round(mileage).toLocaleString()} mi?\n\nDevice raw: ${raw.toLocaleString()} mi\nNew device offset: ${offset>=0?'+':''}${offset.toLocaleString()} mi`))return;
    const note=window.prompt('Optional mileage calibration note:','')||'';
    await post({action:'calibrateMileage',anomalyId:row.id,trustedMileage:Math.round(mileage),note},`mileage-${row.id}`);
  }

  async function dismissMileage(row:MileageItem){
    if(!window.confirm(`Dismiss this ${row.unit} mileage observation without changing trusted PM mileage?\n\nA future inconsistent reading may be flagged again until the device is calibrated.`))return;
    const note=window.prompt('Why are you dismissing this reading?','')||'';
    await post({action:'dismissMileage',anomalyId:row.id,note},`mileage-${row.id}`);
  }

  const repairRows=useMemo(()=>data?.historicalForks.reduce((sum,group)=>sum+group.rows.reduce((n,row)=>n+row.repairCount,0),0)??0,[data]);
  const summary=data?.summary;

  return <main style={{minHeight:'100vh',background:'#f3f5f7',padding:'36px clamp(16px,4vw,46px)',color:'#182331'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:20,flexWrap:'wrap'}}>
      <div><p style={eyebrow}>ADMIN · GEOTAB RELIABILITY</p><h1 style={{margin:'7px 0 0',fontSize:34,color:'#0d1b2b'}}>Identity & mileage review</h1><p style={{margin:'8px 0 0',maxWidth:850,color:'#627181',lineHeight:1.5}}>The sync now refuses ambiguous identity changes and questionable odometer jumps. Resolve those exceptions here without deleting equipment or guessing at repair history.</p></div>
      <button onClick={()=>void load()} disabled={Boolean(busy)}>Refresh</button>
    </header>

    {message&&<div style={{marginTop:18,padding:12,borderRadius:9,background:'#fff8e6',border:'1px solid #f2c66d'}}>{message}</div>}

    <section style={{marginTop:22,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
      <Stat label="Identity needs review" value={summary?.identityOpen??'—'} detail="No equipment changes were made" tone={(summary?.identityOpen??0)>0?'warn':'good'}/>
      <Stat label="Mileage needs review" value={summary?.mileageOpen??'—'} detail="Trusted PM mileage was preserved" tone={(summary?.mileageOpen??0)>0?'warn':'good'}/>
      <Stat label="Historical device forks" value={summary?.historicalForkGroups??'—'} detail={`${repairRows.toLocaleString()} repair links across forked rows`} tone={(summary?.historicalForkGroups??0)>0?'neutral':'good'}/>
    </section>

    <section style={section}>
      <div style={sectionHead}><div><h2 style={h2}>Identity review</h2><p style={sub}>These devices were quarantined because the sync could not prove which Norlow equipment row is correct.</p></div><strong>{data?.identityQueue.length??0} open</strong></div>
      {!data?<Loading/>:data.identityQueue.length===0?<Empty text="No ambiguous Geotab identities are waiting."/>:data.identityQueue.map(item=><article key={item.geotabDeviceId} style={card}>
        <div style={{display:'flex',justifyContent:'space-between',gap:18,flexWrap:'wrap'}}><div><strong style={{fontSize:18}}>{item.geotabName}</strong><div style={mono}>{item.geotabDeviceId}{item.serialNumber?` · serial ${item.serialNumber}`:''}</div><div style={{marginTop:6,color:'#687787'}}>VIN: {item.vin||'not supplied'}</div></div><div><span style={badge}>{reasonLabel[item.reason]||item.reason}</span><div style={{fontSize:12,color:'#87929c',marginTop:7}}>Last seen {formatTime(item.lastSeenAt)}</div></div></div>
        <div style={{marginTop:15}}><strong>Candidate equipment</strong>{item.candidates.length===0?<p style={sub}>No safe automatic candidate. Search for the correct unit or enter an equipment ID.</p>:<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(245px,1fr))',gap:10,marginTop:10}}>{item.candidates.map(row=><Candidate key={row.id} row={row} disabled={Boolean(busy)} onChoose={()=>void resolveIdentity(item,row.id)}/>)}</div>}</div>
        <div style={{marginTop:14,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><input placeholder="Search unit, VIN or device ID" value={searchDevice===item.geotabDeviceId?search:''} onFocus={()=>{if(searchDevice!==item.geotabDeviceId){setSearchDevice(item.geotabDeviceId);setSearch('');setSearchRows([]);}}} onChange={e=>{setSearchDevice(item.geotabDeviceId);setSearch(e.target.value);}} style={{...input,minWidth:240}}/><button disabled={Boolean(busy)} onClick={()=>void searchEquipment(item)}>Search</button><span style={{color:'#8a949e'}}>or</span><input inputMode="numeric" placeholder="Equipment ID" value={manualIds[item.geotabDeviceId]||''} onChange={e=>setManualIds({...manualIds,[item.geotabDeviceId]:e.target.value})} style={{...input,width:130}}/><button disabled={Boolean(busy)||!Number(manualIds[item.geotabDeviceId])} onClick={()=>void resolveIdentity(item,Number(manualIds[item.geotabDeviceId]))}>Link ID</button></div>
        {searchDevice===item.geotabDeviceId&&searchRows.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(245px,1fr))',gap:10,marginTop:10}}>{searchRows.map(row=><Candidate key={row.id} row={row} disabled={Boolean(busy)} onChoose={()=>void resolveIdentity(item,row.id)}/>)}</div>}
      </article>)}
    </section>

    <section style={section}>
      <div style={sectionHead}><div><h2 style={h2}>Mileage review</h2><p style={sub}>Geotab readings below the trusted odometer or beyond the physical-rate guard do not change PM mileage until reviewed.</p></div><strong>{data?.mileageQueue.length??0} pending</strong></div>
      {!data?<Loading/>:data.mileageQueue.length===0?<Empty text="No questionable Geotab mileage readings are waiting."/>:data.mileageQueue.map(row=>{const raw=row.rawMileage??row.incomingMileage;const adjusted=row.adjustedMileage??row.incomingMileage;return <article key={row.id} style={card}><div style={{display:'flex',justifyContent:'space-between',gap:15,flexWrap:'wrap'}}><div><strong style={{fontSize:19}}>{row.unit}</strong><div style={mono}>{row.geotabDeviceId}{row.serialNumber?` · serial ${row.serialNumber}`:''}</div></div><span style={badge}>{row.reason==='decrease'?'Mileage decreased':'Implausible increase'}</span></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:14}}><Metric label="Trusted before" value={miles(row.previousMileage)}/><Metric label="Raw Geotab" value={miles(raw)}/><Metric label="Adjusted candidate" value={miles(adjusted)}/><Metric label="Current offset" value={`${row.mileageOffset>=0?'+':''}${row.mileageOffset.toLocaleString()} mi`}/></div><p style={{...sub,marginTop:12}}>Observed {formatTime(row.createdAt)}{row.previousUpdatedAt?` · previous trusted update ${formatTime(row.previousUpdatedAt)}`:''}</p><div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:12}}><button disabled={Boolean(busy)||row.previousMileage===null} onClick={()=>row.previousMileage!==null&&void calibrate(row,String(row.previousMileage))}>Keep current as new device baseline</button><input inputMode="numeric" placeholder="Verified odometer" value={trustedMileage[row.id]??''} onChange={e=>setTrustedMileage({...trustedMileage,[row.id]:e.target.value})} style={{...input,width:170}}/><button disabled={Boolean(busy)} onClick={()=>void calibrate(row,trustedMileage[row.id]??'')}>Set trusted mileage</button><button disabled={Boolean(busy)} onClick={()=>void dismissMileage(row)}>Dismiss for now</button></div></article>})}
    </section>

    <section style={section}>
      <div style={sectionHead}><div><h2 style={h2}>Historical device forks</h2><p style={sub}>Existing duplicate equipment rows that share a Geotab device ID. This section is intentionally read-only until history-merge rules are validated for every referencing table.</p></div><button onClick={()=>setShowForks(v=>!v)}>{showForks?'Hide':'Show'} {data?.historicalForks.length??0} groups</button></div>
      {showForks&&(!data?<Loading/>:data.historicalForks.length===0?<Empty text="No historical Geotab device forks remain."/>:<div style={{display:'grid',gap:12}}>{data.historicalForks.map(group=><article key={group.geotabDeviceId} style={card}><div style={mono}>{group.geotabDeviceId}</div><div style={{overflowX:'auto',marginTop:10}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:760}}><thead><tr>{['Unit','State','VIN','Mileage','Repairs','Completed','Equipment ID'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{group.rows.map(row=><tr key={row.id} style={{borderTop:'1px solid #edf0f2'}}><td style={td}><strong>{row.unit}</strong></td><td style={td}>{row.archivedAt?'Archived':row.active?'Active':'Inactive'}</td><td style={td}>{row.vin||'—'}</td><td style={td}>{miles(row.currentMileage)}</td><td style={td}>{row.repairCount}</td><td style={td}>{row.completedRepairCount}</td><td style={td}>#{row.id}</td></tr>)}</tbody></table></div></article>)}</div>)}
    </section>
  </main>;
}

function Candidate({row,disabled,onChoose}:{row:Equipment;disabled:boolean;onChoose:()=>void}){return <div style={{border:'1px solid #dfe5e9',borderRadius:9,padding:12,background:'#fafbfc'}}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><strong>{row.unit}</strong><span style={{fontSize:12,color:row.archivedAt?'#a64040':row.active?'#2f7d52':'#7c8791'}}>{row.archivedAt?'ARCHIVED':row.active?'ACTIVE':'INACTIVE'}</span></div><div style={{fontSize:12,color:'#687787',marginTop:6}}>#{row.id} · {row.equipmentType||'equipment'} · {miles(row.currentMileage)}</div><div style={{fontSize:12,color:'#687787',marginTop:4}}>VIN {row.vin||'—'} · {row.repairCount} repairs</div><button disabled={disabled||Boolean(row.archivedAt)} onClick={onChoose} style={{marginTop:9}}>Link this unit</button></div>}
function Stat({label,value,detail,tone}:{label:string;value:number|string;detail:string;tone:'warn'|'good'|'neutral'}){const border=tone==='warn'?'#f1bd71':tone==='good'?'#9fd0b3':'#dce2e7';return <article style={{background:'white',border:`1px solid ${border}`,borderRadius:12,padding:16}}><div style={{fontSize:12,color:'#687787',fontWeight:800}}>{label}</div><div style={{fontSize:30,fontWeight:900,color:'#0d1b2b',marginTop:5}}>{value}</div><div style={{fontSize:12,color:'#7a8794',marginTop:5}}>{detail}</div></article>}
function Metric({label,value}:{label:string;value:string}){return <div style={{background:'#f7f9fa',borderRadius:8,padding:10}}><div style={{fontSize:11,color:'#758290',fontWeight:800}}>{label}</div><strong style={{display:'block',marginTop:4}}>{value}</strong></div>}
function Empty({text}:{text:string}){return <div style={{padding:'26px 6px',color:'#6e7b88'}}>{text}</div>}
function Loading(){return <div style={{padding:'26px 6px',color:'#6e7b88'}}>Loading…</div>}
function miles(value:number|null){return value===null?'—':`${Math.round(value).toLocaleString()} mi`}
function formatTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString()}
const eyebrow={margin:0,color:'#f47b20',fontSize:12,fontWeight:900,letterSpacing:'.15em'};
const section={marginTop:22,background:'white',border:'1px solid #dce2e7',borderRadius:12,padding:20};
const sectionHead={display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap' as const};
const h2={margin:0,color:'#0d1b2b',fontSize:22};
const sub={margin:'6px 0 0',color:'#6c7886',fontSize:13,lineHeight:1.45};
const card={marginTop:14,border:'1px solid #dce2e7',borderRadius:10,padding:15,background:'#fff'};
const badge={display:'inline-block',padding:'5px 8px',borderRadius:999,background:'#fff4df',border:'1px solid #f0c273',fontSize:11,fontWeight:900,color:'#7c4c05'};
const mono={fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontSize:12,color:'#5e6e7e',marginTop:5};
const input={padding:9,border:'1px solid #ccd5dd',borderRadius:7,boxSizing:'border-box' as const,background:'white',color:'#182331'};
const th={padding:'9px 8px',textAlign:'left' as const,background:'#f7f9fa',fontSize:11,color:'#687787'};
const td={padding:'9px 8px',fontSize:13};
