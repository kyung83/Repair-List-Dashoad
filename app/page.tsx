"use client";

import { useEffect, useMemo, useState } from "react";

type User = { displayName:string; role:"viewer"|"mechanic"|"manager"|"admin"; technicianId:number|null };
type Work = { id:string; source:string; unit:string; issue:string; status:string; assignedTo:string; technicianId:number|null; equipmentId:number|null; outOfService:boolean; activeTimer:{startedAt:string;technician:string}|null };
type Equipment = { id:number; unit:string; equipmentType:string; driver:string; location:string };
type Oos = { equipmentId:number; unit:string; reason:string; since:string|null; openWork:{id:string;issue:string;status:string}[] };
type GeotabReviewItem = { id:number;repairId:string;unit:string;issue:string;technician:string;failureReason:string;createdAt:string;attemptCount:number };
type Board = { user:User; repairs:Work[]; equipment:Equipment[]; oosUnits:Oos[]; geotabReview?:GeotabReviewItem[]; summary:{total:number;oos:number;dvirOpen:number;maintenanceDue:number;unassigned:number;activeLabor:number;geotabReview?:number}; updatedAt:string };
type DutyAlert = { id:number; templateName:string; dueDate:string; status:string; assignedName:string };
type DutySetup = { overdueAssignments?:DutyAlert[]; dueTodayAssignments?:DutyAlert[] };

function maintenance(source:string){return ['pm','annual','pm-repair','annual-repair'].includes(source);}
function workIsRepair(source:string){return ['repair','dvir','dvir-repair'].includes(source);}

export default function TodayPage(){
  const [data,setData]=useState<Board|null>(null);
  const [message,setMessage]=useState("");
  const [unit,setUnit]=useState("");
  const [dutyAlerts,setDutyAlerts]=useState<DutySetup>({overdueAssignments:[],dueTodayAssignments:[]});

  async function load(){
    const response=await fetch('/api/repair-board',{cache:'no-store'});
    const payload=await response.json() as Board&{error?:string};
    if(!response.ok)throw new Error(payload.error||'Today could not be loaded.');
    setData(payload);
    if(payload.user.role==='manager'||payload.user.role==='admin'){
      try{
        const dutyResponse=await fetch('/api/shop-duties/setup',{cache:'no-store'});
        if(dutyResponse.ok){
          const dutyPayload=await dutyResponse.json() as DutySetup;
          setDutyAlerts({
            overdueAssignments:dutyPayload.overdueAssignments??[],
            dueTodayAssignments:dutyPayload.dueTodayAssignments??[],
          });
        }
      }catch{}
    }
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
      dutyOverdue:dutyAlerts.overdueAssignments?.length??0,
      dutyDueToday:dutyAlerts.dueTodayAssignments?.length??0,
      geotabReview:data?.geotabReview?.length??0,
    };
  },[data,dutyAlerts]);

  const attention=useMemo(()=>{
    if(!data)return [] as {key:string;unit:string;title:string;detail:string;tone:'red'|'orange';href:string}[];
    const rows:{key:string;unit:string;title:string;detail:string;tone:'red'|'orange';href:string}[]=[];
    for(const item of data.geotabReview??[])rows.push({key:`geotab-${item.id}`,unit:item.unit,title:'GEOTAB REVIEW',detail:`${item.issue} — ${item.failureReason||'Geotab writeback needs management review.'}`,tone:'orange',href:'/repair-board?attention=geotab'});
    for(const item of data.oosUnits)rows.push({key:`oos-${item.equipmentId}`,unit:item.unit,title:'OUT OF SERVICE',detail:item.reason||'Unit is marked out of service.',tone:'red',href:`/unit?unit=${encodeURIComponent(item.unit)}`});
    for(const item of data.repairs.filter(row=>maintenance(row.source)&&row.status.toLowerCase().includes('overdue')))rows.push({key:`due-${item.id}`,unit:item.unit,title:'MAINTENANCE OVERDUE',detail:item.issue,tone:'red',href:`/unit?unit=${encodeURIComponent(item.unit)}`});
    for(const item of data.repairs.filter(row=>maintenance(row.source)&&row.status.toLowerCase().includes('stale')))rows.push({key:`stale-${item.id}`,unit:item.unit,title:'MILEAGE STALE',detail:item.issue,tone:'orange',href:`/unit?unit=${encodeURIComponent(item.unit)}`});
    for(const item of data.repairs.filter(row=>row.technicianId===null&&!maintenance(row.source)).slice(0,8))rows.push({key:`un-${item.id}`,unit:item.unit,title:'NEEDS ASSIGNMENT',detail:item.issue,tone:'orange',href:`/unit?unit=${encodeURIComponent(item.unit)}`});
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
        <a className="easy-card easy-metric" href="/pm-inspections"><span>Paperwork</span><strong>PM Forms</strong><small>Print or save completed PM sheets.</small></a>
        <a className="easy-card easy-metric" href="/annual-inspections"><span>Paperwork</span><strong>Annual Forms</strong><small>Print or reprint completed Annuals.</small></a>
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
      <a className="easy-card easy-metric" href="/shop-duties"><span>Shop duties overdue</span><strong>{counts.dutyOverdue}</strong><small>{counts.dutyOverdue ? counts.dutyOverdue+" overdue" : counts.dutyDueToday ? counts.dutyDueToday+" due today" : "No missed shop duties"}</small></a>
      {counts.geotabReview>0&&<a className="easy-card easy-metric" href="/repair-board?attention=geotab"><span>Geotab review required</span><strong>{counts.geotabReview}</strong><small>Completed repairs waiting on DVIR reconciliation</small></a>}
    </section>

    {!!dutyAlerts.overdueAssignments?.length&&<section className="easy-card easy-card-body" style={{marginTop:16,border:"2px solid #d9665d",background:"#fff0ef"}}>
      <h2 className="easy-section-title" style={{color:"#982d25"}}>Shop duties overdue</h2>
      <p className="easy-section-copy">These stay here until the mechanic completes them.</p>
      <div className="easy-list">
        {dutyAlerts.overdueAssignments.map(item=><a key={item.id} className="easy-row" href="/shop-duties" style={{textDecoration:"none"}}>
          <div className="easy-row-main"><strong>{item.templateName} — {item.assignedName}</strong><span>Due {item.dueDate}. Open Shop Duties to review or manage it.</span></div>
          <span className="easy-badge red">OVERDUE</span>
        </a>)}
      </div>
    </section>}

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
          {attention.map(item=><a key={item.key} className="easy-row" href={item.href} style={{textDecoration:'none'}}>
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
          <a className="easy-button" href="/pm-inspections">Print PM Form</a>
          <a className="easy-button" href="/annual-inspections">Print Annual Form</a>
          <a className="easy-button" href="/inventory">Parts Inventory</a>
        </div>
      </div>
    </section>
  </div></main>;
}
