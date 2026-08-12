"use client";

import { useEffect, useMemo, useState } from "react";

type History = { repairs:number; maintenanceEvents:number; historicalRos:number; expenses:number; lastRepairDate:string };
type Equipment = { id:number; unit:string; category:string; equipmentType:string; active:boolean; archived:boolean; source:"Geotab"|"Manual"; currentMileage:number|null; mileageUpdatedAt:string; serviceDate:string; annualDate:string; notes:string; driver:string; location:string; vin:string; licensePlate:string; licenseState:string; modelYear:number|null; make:string; model:string; history:History };
type EquipmentData = { equipment:Equipment[] };
type Work = { id:string; source:string; unit:string; issue:string; status:string; assignedTo:string; technicianId:number|null; equipmentId:number|null; outOfService:boolean; oosReason:string };
type Board = { user:{role:string}; repairs:Work[] };
type AnnualForm = { reportNumber:string; repairId:string; inspectionDate:string; unit:string; inspector:string; printUrl:string };
type AnnualData = { forms:AnnualForm[] };
type Followup = { id:number; equipmentId:number; unit:string; description:string; status:string; targetTitle:string; taggedAt:string };
type FollowupData = { followups:Followup[] };

function sameUnit(a:string,b:string){return a.trim().toLowerCase()===b.trim().toLowerCase();}
function dateText(value:string){if(!value)return 'Not recorded';const date=new Date(value.includes('T')?value:`${value}T12:00:00`);return Number.isNaN(date.getTime())?value:date.toLocaleDateString();}

export default function UnitPage(){
  const [equipment,setEquipment]=useState<Equipment[]>([]);
  const [board,setBoard]=useState<Board|null>(null);
  const [forms,setForms]=useState<AnnualForm[]>([]);
  const [followups,setFollowups]=useState<Followup[]>([]);
  const [query,setQuery]=useState("");
  const [selectedUnit,setSelectedUnit]=useState("");
  const [message,setMessage]=useState("");

  useEffect(()=>{
    const initial=new URLSearchParams(window.location.search).get('unit')||'';
    setQuery(initial);setSelectedUnit(initial);
    void Promise.all([
      fetch('/api/equipment',{cache:'no-store'}).then(async r=>{const p=await r.json() as EquipmentData&{error?:string};if(!r.ok)throw new Error(p.error||'Units could not be loaded.');return p;}),
      fetch('/api/repair-board',{cache:'no-store'}).then(async r=>{const p=await r.json() as Board&{error?:string};if(!r.ok)throw new Error(p.error||'Open work could not be loaded.');return p;}),
      fetch('/api/annual-inspections',{cache:'no-store'}).then(async r=>r.ok?await r.json() as AnnualData:{forms:[]}),
      fetch('/api/pm-followups',{cache:'no-store'}).then(async r=>r.ok?await r.json() as FollowupData:{followups:[]}).catch(()=>({followups:[]})),
    ]).then(([eq,b,annual,next])=>{setEquipment(eq.equipment);setBoard(b);setForms(annual.forms||[]);setFollowups(next.followups||[]);}).catch(error=>setMessage(error instanceof Error?error.message:'Unit information could not be loaded.'));
  },[]);

  const selected=useMemo(()=>equipment.find(item=>sameUnit(item.unit,selectedUnit))??null,[equipment,selectedUnit]);
  const openWork=useMemo(()=>selected?(board?.repairs??[]).filter(item=>item.equipmentId===selected.id||sameUnit(item.unit,selected.unit)):[],[board,selected]);
  const annuals=useMemo(()=>selected?forms.filter(item=>sameUnit(item.unit,selected.unit)):[],[forms,selected]);
  const future=useMemo(()=>selected?followups.filter(item=>item.equipmentId===selected.id):[],[followups,selected]);

  function openUnit(){
    const value=query.trim();if(!value)return setMessage('Enter a unit number.');
    const found=equipment.find(item=>sameUnit(item.unit,value));
    if(!found){setSelectedUnit('');return setMessage(`Unit ${value} was not found.`);}
    setMessage('');setSelectedUnit(found.unit);window.history.replaceState(null,'',`/unit?unit=${encodeURIComponent(found.unit)}`);
  }

  const latestAnnual=annuals[0];
  const currentMaintenance=openWork.filter(item=>['pm','annual','pm-repair','annual-repair'].includes(item.source));
  const currentRepairs=openWork.filter(item=>!['pm','annual','pm-repair','annual-repair'].includes(item.source));

  return <main className="easy-page"><div className="easy-page-narrow">
    <p className="easy-eyebrow">FIND A UNIT</p><h1 className="easy-title">Truck & trailer lookup</h1>
    <p className="easy-subtitle">If you know the unit number, you should be able to get to everything else from here.</p>
    {message&&<div className="easy-notice">{message}</div>}
    <section className="easy-finder">
      <label>Unit number
        <input list="unit-list" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')openUnit();}} placeholder="Type unit number" autoFocus />
      </label>
      <datalist id="unit-list">{equipment.filter(item=>!item.archived).map(item=><option key={item.id} value={item.unit}>{item.location}</option>)}</datalist>
      <button type="button" className="easy-button orange" onClick={openUnit}>Open Unit</button>
    </section>

    {!selected&&<div className="easy-card easy-empty" style={{marginTop:16}}>Search for a unit above. Its repairs, maintenance, future work, and Annual forms will all appear on one page.</div>}

    {selected&&<>
      <section className="easy-unit-layout">
        <div className="easy-unit-hero">
          <p className="easy-eyebrow" style={{color:'#ff9a4c'}}>UNIT</p><h2 className="easy-unit-number">{selected.unit}</h2>
          <div className="easy-unit-meta"><span>{[selected.modelYear,selected.make,selected.model].filter(Boolean).join(' ')||selected.equipmentType}</span><span>•</span><span>{selected.location||'No location'}</span>{selected.driver&&<><span>•</span><span>{selected.driver}</span></>}</div>
          <div className="easy-unit-stats">
            <div className="easy-unit-stat"><span>Status</span><strong>{openWork.some(item=>item.outOfService)?'OUT OF SERVICE':'In service'}</strong></div>
            <div className="easy-unit-stat"><span>Mileage</span><strong>{selected.currentMileage==null?'Not available':`${selected.currentMileage.toLocaleString()} mi`}</strong></div>
            <div className="easy-unit-stat"><span>Mileage source</span><strong>{selected.source}</strong></div>
          </div>
          <div className="easy-actions">
            <a className="easy-button orange" href="/shop">Work on this Unit</a>
            {board?.user.role!=='mechanic'&&<a className="easy-button" href="/repair-board">Open Shop Board</a>}
            {latestAnnual&&<a className="easy-button" href={latestAnnual.printUrl}>Print Latest Annual</a>}
          </div>
        </div>
        <div className="easy-card easy-card-body">
          <h3 className="easy-section-title">Unit information</h3>
          <div className="easy-list">
            <div className="easy-row"><div><strong>VIN</strong><span>{selected.vin||'Not entered'}</span></div></div>
            <div className="easy-row"><div><strong>Plate</strong><span>{[selected.licensePlate,selected.licenseState].filter(Boolean).join(' / ')||'Not entered'}</span></div></div>
            <div className="easy-row"><div><strong>Last PM</strong><span>{dateText(selected.serviceDate)}</span></div></div>
            <div className="easy-row"><div><strong>Last Annual</strong><span>{dateText(selected.annualDate)}</span></div></div>
          </div>
          {board?.user.role!=='mechanic'&&<div className="easy-actions"><a className="easy-button" href="/equipment">Edit Unit Details</a><a className="easy-button" href="/reports/history">View History</a></div>}
        </div>
      </section>

      <section className="easy-attention">
        <div className="easy-card easy-card-body">
          <h3 className="easy-section-title">Open work ({currentRepairs.length})</h3>
          <p className="easy-section-copy">Repairs and DVIR items that still need attention.</p>
          <div className="easy-list">{currentRepairs.map(item=><div key={item.id} className="easy-row"><div className="easy-row-main"><strong>{item.issue}</strong><span>{item.assignedTo?`Assigned to ${item.assignedTo}`:'Not assigned yet'} · {item.status}</span></div><span className={`easy-badge ${item.outOfService?'red':''}`}>{item.outOfService?'OOS':'OPEN'}</span></div>)}{!currentRepairs.length&&<div className="easy-empty">No open repair work.</div>}</div>
        </div>
        <div className="easy-card easy-card-body">
          <h3 className="easy-section-title">Maintenance now</h3>
          <p className="easy-section-copy">PM or Annual work that is currently due or open.</p>
          <div className="easy-list">{currentMaintenance.map(item=><div key={item.id} className="easy-row"><div className="easy-row-main"><strong>{item.issue}</strong><span>{item.status}{item.assignedTo?` · ${item.assignedTo}`:''}</span></div><span className={`easy-badge ${item.status.toLowerCase().includes('overdue')?'red':'orange'}`}>{item.source.includes('annual')?'ANNUAL':'PM'}</span></div>)}{!currentMaintenance.length&&<div className="easy-empty">No PM or Annual is currently due.</div>}</div>
        </div>
      </section>

      <section className="easy-attention">
        <div className="easy-card easy-card-body">
          <h3 className="easy-section-title">Next service work ({future.length})</h3>
          <p className="easy-section-copy">Items intentionally saved to be handled on a future PM.</p>
          <div className="easy-list">{future.map(item=><div key={item.id} className="easy-row"><div className="easy-row-main"><strong>{item.description}</strong><span>{item.status==='attached'?(item.targetTitle||'Attached to current PM'):'Waiting for next PM'}</span></div><span className="easy-badge orange">NEXT PM</span></div>)}{!future.length&&<div className="easy-empty">Nothing is waiting for the next PM.</div>}</div>
        </div>
        <div className="easy-card easy-card-body">
          <h3 className="easy-section-title">Annual forms</h3>
          <p className="easy-section-copy">Completed inspections stay here so a lost truck copy can be printed again.</p>
          <div className="easy-form-list">{annuals.slice(0,6).map(item=><div className="easy-form-row" key={item.reportNumber}><div><strong>{dateText(item.inspectionDate)} Annual</strong><span>{item.inspector||'Inspector not listed'} · {item.reportNumber}</span></div><a className="easy-button" style={{minHeight:38,padding:'0 11px'}} href={item.printUrl}>Print</a></div>)}{!annuals.length&&<div className="easy-empty">No completed Annual form is stored for this unit yet.</div>}</div>
        </div>
      </section>
    </>}
  </div></main>;
}
