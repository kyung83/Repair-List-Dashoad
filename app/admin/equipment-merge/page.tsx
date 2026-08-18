"use client";

import { useEffect, useMemo, useState } from "react";

type Equipment = {
  id:number; unit:string; equipmentType:string; geotabDeviceId:string|null; vin:string|null;
  currentMileage:number|null; mileageUpdatedAt:string|null; active:boolean; archivedAt:string|null;
  repairCount:number; completedRepairCount:number;
};
type Fork = { geotabDeviceId:string; rows:Equipment[] };
type ReconciliationData = { historicalForks:Fork[]; error?:string };
type MergePreview = {
  ok:boolean;
  source:{id:number;unit:string;equipment_type:string;active:number;archived_at:string|null;geotab_device_id:string|null;vin:string|null;current_mileage:number|null};
  target:{id:number;unit:string;equipment_type:string;active:number;archived_at:string|null;geotab_device_id:string|null;vin:string|null;current_mileage:number|null};
  sourceCounts:Record<string,number>;
  targetCounts:Record<string,number>;
  referencesToMove:number;
  blockers:string[];
  warnings:string[];
  currentDeviceAssignment:{equipment_id:number;geotab_device_id:string}|null;
  error?:string;
};

const referenceLabels:Record<string,string>={
  pmSettings:"PM settings", repairs:"Repairs / work orders", pmStatus:"Current PM status",
  annualSettings:"Annual settings", expenses:"Unit expenses", maintenanceEvents:"PM / annual history",
  invoices:"Invoices", historicalRepairs:"Historical ROs", historicalRepairLines:"Historical RO lines",
  partCompatibility:"Part compatibility", statusEvents:"Out-of-service history", maintenanceActions:"Maintenance action queue",
  checklistRuns:"PM / annual checklists", deviceAssignments:"Geotab assignment history",
  resolvedIdentityReviews:"Resolved identity reviews", mileageAnomalies:"Mileage review history",
  mergedChildren:"Previously merged aliases", priorMergeEvents:"Prior merges into this row",
};

function preferredCanonical(rows:Equipment[]){
  return [...rows].sort((a,b)=>Number(b.active&&!b.archivedAt)-Number(a.active&&!a.archivedAt)||b.repairCount-a.repairCount||a.id-b.id)[0]?.id??0;
}
function miles(value:number|null){return value==null?'—':`${value.toLocaleString()} mi`;}
function state(row:Equipment){return row.archivedAt?'Archived':row.active?'Active':'Inactive';}

export default function EquipmentMergePage(){
  const[data,setData]=useState<ReconciliationData|null>(null);
  const[targetByDevice,setTargetByDevice]=useState<Record<string,number>>({});
  const[preview,setPreview]=useState<MergePreview|null>(null);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState("");

  async function load(){
    const response=await fetch('/api/admin/geotab-reconciliation',{cache:'no-store'});
    if(response.status===401){window.location.assign('/login?returnTo=/admin/equipment-merge');return;}
    const result=await response.json() as ReconciliationData;
    if(!response.ok)throw new Error(result.error||'Historical forks could not be loaded.');
    setData(result);
    setTargetByDevice(current=>{
      const next={...current};
      for(const group of result.historicalForks||[]){
        if(!next[group.geotabDeviceId]||!group.rows.some(row=>row.id===next[group.geotabDeviceId]))next[group.geotabDeviceId]=preferredCanonical(group.rows);
      }
      return next;
    });
  }
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Historical forks could not be loaded.'));},[]);

  async function previewMerge(sourceId:number,targetId:number){
    setBusy(`preview-${sourceId}`);setMessage("");setPreview(null);
    try{
      const response=await fetch('/api/admin/equipment-merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'preview',sourceEquipmentId:sourceId,targetEquipmentId:targetId})});
      const result=await response.json() as MergePreview;
      if(!response.ok)throw new Error(result.error||'Merge preview failed.');
      setPreview(result);
      window.setTimeout(()=>document.getElementById('merge-preview')?.scrollIntoView({behavior:'smooth',block:'start'}),0);
    }catch(error){setMessage(error instanceof Error?error.message:'Merge preview failed.');}finally{setBusy("");}
  }

  async function commitMerge(){
    if(!preview||preview.blockers.length)return;
    const typed=window.prompt(`Type the duplicate unit exactly to confirm this merge:\n\n${preview.source.unit}`,'');
    if(typed!==preview.source.unit)return setMessage('Merge cancelled: confirmation did not match the duplicate unit.');
    const note=window.prompt('Optional audit note for this equipment merge:','')||'';
    if(!window.confirm(`Final confirmation\n\nMove ${preview.referencesToMove.toLocaleString()} linked records from ${preview.source.unit} (#${preview.source.id}) into ${preview.target.unit} (#${preview.target.id})?\n\nThe duplicate will become a permanent merged tombstone. It will not be deleted, and the operation is transactional.`))return;
    setBusy(`merge-${preview.source.id}`);setMessage("");
    try{
      const response=await fetch('/api/admin/equipment-merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'merge',sourceEquipmentId:preview.source.id,targetEquipmentId:preview.target.id,note})});
      const result=await response.json() as{ok?:boolean;error?:string;sourceUnit?:string;targetUnit?:string;referencesMoved?:number};
      if(!response.ok)throw new Error(result.error||'Equipment merge failed.');
      setPreview(null);
      setMessage(`${result.sourceUnit||'Duplicate'} merged into ${result.targetUnit||'canonical equipment'}; ${Number(result.referencesMoved||0).toLocaleString()} linked records were consolidated.`);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Equipment merge failed.');}finally{setBusy("");}
  }

  const groups=useMemo(()=>data?.historicalForks??[],[data]);
  return <main style={{minHeight:'100vh',background:'#f3f5f7',padding:'36px clamp(16px,4vw,46px)',color:'#182331'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:20,flexWrap:'wrap'}}>
      <div><p style={eyebrow}>ADMIN · DATA INTEGRITY</p><h1 style={{margin:'7px 0 0',fontSize:34,color:'#0d1b2b'}}>Equipment fork merge</h1><p style={sub}>Consolidate old equipment rows that share the same Geotab device. Preview is read-only. Merge moves every known linked record transactionally, records an audit snapshot, and retires—not deletes—the duplicate.</p></div>
      <div style={{display:'flex',gap:10}}><a href="/admin/geotab-review" style={link}>Geotab Review</a><button disabled={Boolean(busy)} onClick={()=>void load()}>Refresh</button></div>
    </header>
    {message&&<div style={notice}>{message}</div>}

    <section style={section}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',flexWrap:'wrap'}}><div><h2 style={h2}>Historical device forks</h2><p style={sub}>Choose the row that should remain the permanent Norlow equipment record, then preview each duplicate before merging.</p></div><strong>{groups.length} groups</strong></div>
      {!data?<p style={sub}>Loading…</p>:groups.length===0?<div style={empty}>No historical Geotab device forks remain.</div>:<div style={{display:'grid',gap:15,marginTop:16}}>{groups.map(group=>{
        const targetId=targetByDevice[group.geotabDeviceId]||preferredCanonical(group.rows);
        const target=group.rows.find(row=>row.id===targetId);
        return <article key={group.geotabDeviceId} style={card}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><strong style={{fontSize:18}}>Device {group.geotabDeviceId}</strong><div style={{fontSize:13,color:'#74818d',marginTop:4}}>{group.rows.length} equipment rows share this legacy identity</div></div>{target&&<span style={canonicalBadge}>Canonical: {target.unit} #{target.id}</span>}</div>
          <div style={{overflowX:'auto',marginTop:12}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:920}}><thead><tr>{['Keep','Unit','State','VIN','Mileage','Repairs','Completed','Equipment ID','Action'].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead><tbody>{group.rows.map(row=>{
            const isTarget=row.id===targetId;
            return <tr key={row.id} style={{borderTop:'1px solid #edf0f2',background:isTarget?'#f4fbf6':'white'}}>
              <td style={td}><input type="radio" name={`canonical-${group.geotabDeviceId}`} checked={isTarget} disabled={Boolean(busy)||Boolean(row.archivedAt)} onChange={()=>{setTargetByDevice({...targetByDevice,[group.geotabDeviceId]:row.id});setPreview(null);}} aria-label={`Keep ${row.unit} as canonical`}/></td>
              <td style={td}><strong>{row.unit}</strong></td><td style={td}>{state(row)}</td><td style={td}>{row.vin||'—'}</td><td style={td}>{miles(row.currentMileage)}</td><td style={td}>{row.repairCount}</td><td style={td}>{row.completedRepairCount}</td><td style={td}>#{row.id}</td>
              <td style={td}>{isTarget?<strong style={{color:'#25763c'}}>Keep</strong>:<button disabled={Boolean(busy)||!targetId} onClick={()=>void previewMerge(row.id,targetId)}>Preview merge</button>}</td>
            </tr>})}</tbody></table></div>
        </article>})}</div>}
    </section>

    {preview&&<section id="merge-preview" style={{...section,border:preview.blockers.length?'2px solid #d14343':'2px solid #e4a11b'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}><div><p style={eyebrow}>MERGE PREVIEW · NO DATA CHANGED</p><h2 style={h2}>{preview.source.unit} #{preview.source.id} → {preview.target.unit} #{preview.target.id}</h2><p style={sub}>{preview.referencesToMove.toLocaleString()} linked records are attached to the duplicate row.</p></div><button onClick={()=>setPreview(null)}>Close preview</button></div>
      {preview.blockers.length>0&&<div style={blocked}><strong>Merge blocked</strong><ul>{preview.blockers.map(item=><li key={item}>{item}</li>)}</ul></div>}
      {preview.warnings.length>0&&<div style={warning}><strong>Review warnings</strong><ul>{preview.warnings.map(item=><li key={item}>{item}</li>)}</ul></div>}
      <div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:9}}>{Object.entries(preview.sourceCounts).filter(([,value])=>value>0).map(([key,value])=><div key={key} style={metric}><span>{referenceLabels[key]||key}</span><strong>{value.toLocaleString()}</strong></div>)}</div>
      <div style={{marginTop:16,padding:14,borderRadius:9,background:'#f7f9fa',lineHeight:1.55}}><strong>What the merge does</strong><p style={{margin:'6px 0 0',color:'#61707d'}}>Moves known equipment-linked repairs, PM/annual history, imported ROs, expenses, invoices, checklists, maintenance actions, parts compatibility, Geotab assignment history and review history. Unique PM/status/event collisions are consolidated first. A full before-state audit is recorded. The duplicate is archived as a permanent merged tombstone and cannot be restored.</p></div>
      <button disabled={Boolean(busy)||preview.blockers.length>0} onClick={()=>void commitMerge()} style={{marginTop:16,border:0,borderRadius:8,padding:'11px 17px',background:preview.blockers.length?'#a8b0b7':'#c13f32',color:'white',fontWeight:900}}>Merge duplicate into canonical</button>
    </section>}
  </main>;
}

const section={marginTop:22,background:'white',border:'1px solid #dce2e7',borderRadius:12,padding:20};
const card={border:'1px solid #dce2e7',borderRadius:10,padding:16,background:'white'};
const h2={margin:'0 0 5px',fontSize:21,color:'#0d1b2b'};
const sub={margin:'6px 0 0',maxWidth:900,color:'#657482',lineHeight:1.5};
const eyebrow={margin:0,color:'#f47b20',fontSize:12,fontWeight:900,letterSpacing:'.16em'};
const th={padding:'10px 9px',textAlign:'left' as const,background:'#f7f9fa',color:'#657383',fontSize:11,whiteSpace:'nowrap' as const};
const td={padding:'11px 9px',fontSize:13,verticalAlign:'middle' as const};
const notice={marginTop:18,padding:12,borderRadius:9,background:'#fff8e6',border:'1px solid #f2c66d'};
const empty={marginTop:14,padding:18,border:'1px dashed #ccd5dd',borderRadius:9,color:'#687786'};
const canonicalBadge={padding:'6px 9px',borderRadius:999,background:'#eaf7ee',color:'#25763c',fontSize:12,fontWeight:800};
const blocked={marginTop:14,padding:14,borderRadius:9,background:'#fff0f0',border:'1px solid #e2a2a2',color:'#8d2828'};
const warning={marginTop:14,padding:14,borderRadius:9,background:'#fff8e6',border:'1px solid #f2c66d'};
const metric={display:'flex',justifyContent:'space-between',gap:10,padding:10,border:'1px solid #e4e9ed',borderRadius:8,color:'#586775'};
const link={display:'inline-flex',alignItems:'center',padding:'8px 10px',border:'1px solid #ccd5dd',borderRadius:8,color:'#0d1b2b',fontWeight:800,textDecoration:'none'};
