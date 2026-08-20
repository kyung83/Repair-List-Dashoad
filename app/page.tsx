"use client";

import { useEffect, useMemo, useState } from "react";

type User = { displayName:string; role:"viewer"|"mechanic"|"manager"|"admin"; technicianId:number|null };
type Work = { id:string; source:string; unit:string; issue:string; status:string; assignedTo:string; technicianId:number|null; equipmentId:number|null; outOfService:boolean; activeTimer:{startedAt:string;technician:string}|null };
type Equipment = { id:number; unit:string; equipmentType:string; driver:string; location:string };
type Oos = { equipmentId:number; unit:string; reason:string; since:string|null; openWork:{id:string;issue:string;status:string}[] };
type Board = { user:User; repairs:Work[]; equipment:Equipment[]; oosUnits:Oos[]; summary:{total:number;oos:number;dvirOpen:number;maintenanceDue:number;unassigned:number;activeLabor:number}; updatedAt:string };

function maintenance(source:string){return ['pm','annual','pm-repair','annual-repair'].includes(source);}
function workIsRepair(source:string){return ['repair','dvir','dvir-repair'].includes(source);}

export default function TodayPage(){
  const [data,setData]=useState<Board|null>(null);
  const [message,setMessage]=useState("");
  const [unit,setUnit]=useState("");

  async function load(){
    const response=await fetch('/api/repair-board',{cache:'no-store'});
    const payload=await response.json() as Board&{error?:string};
    if(!response.ok)throw new Error(payload.error||'Today could not be loaded.');
    setData(payload);
  }
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Today could not be loaded.'));},[]);

  const counts=useMemo(()=>{
    const rows=data?.repairs??[];
    return {
      repairs:rows.filter(row=>workIsRepair(row.source)).length,
      maintenance:rows.filter(row=>maintenance(row.source)).length,
      overdue:rows.filter(row=>maintenance(row.source)&&row.status.toLowerCase().includes('overdue')).length,
      stale:rows.filter(row=>maintenance(row.source)&&row.status.toLowerCase().includes('stale')).length,
      unassigned:rows.filter(row=>row.technicianId===null).length,
      active:rows.filter(row=>row.activeTimer!==null).length,
    };
  },[data]);

  const attention=useMemo(()=>{
    if(!data)return [] as {key:string;unit:string;title:string;detail:string;tone:'red'|'orange'}[];
    const rows:{key:string;unit:string;title:string;detail:string;tone:'red'|'orange'}[]=[];
    for(const item of data.oosUnits)rows.push({key:`oos-${item.equipmentId}`,unit:item.unit,title:'OUT OF SERVICE',detail:item.reason||'Unit is marked out of service.',tone:'red'});
    for(const item of data.repairs.filter(row=>maintenance(row.source)&&row.status.toLowerCase().includes('overdue')))rows.push({key:`due-${item.id}`,unit:item.unit,title:'MAINTENANCE OVERDUE',detail:item.issue,tone:'red'});
    for(const item of data.repairs.filter(row=>maintenance(row.source)&&row.status.toLowerCase().includes('stale')))rows.push({key:`stale-${item.id}`,unit:item.unit,title:'MILEAGE STALE',detail:item.issue,tone:'orange'});
    for(const item of data.repairs.filter(row=>row.technicianId===null&&!maintenance(row.source)).slice(0,8))rows.push({key:`un-${item.id}`,unit:item.unit,title:'NEEDS ASSIGNMENT',detail:item.issue,tone:'orange'});
    return rows.slice(0,12);
  },[data]);

  function findUnit(){
    const value=unit.trim();
    if(!value)return setMessage('Enter a unit number first.');
    window.location.assign(`/unit?unit=${encodeURIComponent(value)}`);
  }

  if(data?.user.role==='mechanic'){
    return <main className="easy-page"><div className="easy-page-narrow">
      <p className="easy-eyebrow">YOUR WORKDAY</p><h1 className="easy-title">What do you need to do?</h1>
      <p className="easy-subtitle">Use the big choices below. You do not need the office or setup screens to work on a truck.</p>
      <div className="easy-grid">
        <a className="easy-card easy-metric" href="/shop"><span>Work assigned to me</span><strong>My Jobs</strong><small>Open a repair, PM, or Annual.</small></a>
        <a className="easy-card easy-metric" href="/unit"><span>Truck or trailer</span><strong>Find Unit</strong><small>See work, maintenance, and forms.</small></a>
        <a className="easy-card easy-metric" href="/annual-inspections"><span>Paperwork</span><strong>Forms</strong><small>Print or reprint completed Annuals.</small></a>
      </div>
    </div></main>;
  }

  return <main className="easy-page"><div className="easy-page-narrow">
    <p className="easy-eyebrow">TODAY</p>
    <h1 className="easy-title">{data?`Good day, ${data.user.displayName}.`:'Fleet operations'}</h1>
    <p className="easy-subtitle">This screen answers one question: what needs attention right now?</p>
    {message&&<div className="easy-notice">{message}</div>}

    <section className="easy-grid" aria-label="Today's fleet summary">
      <a className="easy-card easy-metric" href="/repair-board"><span>Repairs waiting</span><strong>{counts.repairs}</strong><small>Open repair and DVIR work</small></a>
      <a className="easy-card easy-metric" href="/repair-board"><span>PM / Annual attention</span><strong>{counts.maintenance}</strong><small>{counts.overdue?`${counts.overdue} overdue`:counts.stale?`${counts.stale} mileage stale`:'No overdue maintenance'}</small></a>
      <a className="easy-card easy-metric" href="/repair-board"><span>Out of service</span><strong>{data?.oosUnits.length??0}</strong><small>Units that should not be dispatched</small></a>
      <a className="easy-card easy-metric" href="/repair-board"><span>Being worked now</span><strong>{counts.active}</strong><small>{counts.unassigned} open items still unassigned</small></a>
    </section>

    <section className="easy-finder">
      <label>Find a truck or trailer
        <input list="today-units" value={unit} onChange={event=>setUnit(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')findUnit();}} placeholder="Type unit number, for example 483" />
      </label>
      <datalist id="today-units">{(data?.equipment??[]).map(item=><option key={item.id} value={item.unit}>{item.location}</option>)}</datalist>
      <button className="easy-button orange" type="button" onClick={findUnit}>Open Unit</button>
    </section>

    <section className="easy-attention">
      <div className="easy-card easy-card-body">
        <h2 className="easy-section-title">Needs attention</h2>
        <p className="easy-section-copy">Out-of-service, overdue, stale mileage, and unassigned work is brought here automatically.</p>
        <div className="easy-list">
          {attention.map(item=><a key={item.key} className="easy-row" href={`/unit?unit=${encodeURIComponent(item.unit)}`} style={{textDecoration:'none'}}>
            <div className="easy-row-main"><strong>Unit {item.unit} — {item.detail}</strong><span>Open the unit to see everything tied to it.</span></div>
            <span className={`easy-badge ${item.tone}`}>{item.title}</span>
          </a>)}
          {!attention.length&&<div className="easy-empty">Nothing urgent is waiting right now.</div>}
        </div>
      </div>
      <div className="easy-card easy-card-body">
        <h2 className="easy-section-title">Common jobs</h2>
        <p className="easy-section-copy">The less-used setup screens are under More in the top menu.</p>
        <div className="easy-actions" style={{display:'grid'}}>
          <a className="easy-button primary" href="/repair-board">Open Shop Board</a>
          <a className="easy-button orange" href="/next-pm-repairs">Add Future Repair</a>
          <a className="easy-button" href="/unit">Find a Unit</a>
          <a className="easy-button" href="/annual-inspections">Print Annual Form</a>
          <a className="easy-button" href="/inventory">Parts Inventory</a>
        </div>
      </div>
    </section>
  </div></main>;
}
