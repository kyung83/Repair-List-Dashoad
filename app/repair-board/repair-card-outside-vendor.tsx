'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

type Repair={id:string;unit:string;issue:string;status:string;source:string;equipmentId:number|null;technicianId:number|null;dvirDefectId?:string;maintenanceId?:string};
type Vendor={id:number;name:string;phone:string};
type BoardPayload={canManage?:boolean;repairs?:Repair[];error?:string};
type OutsidePayload={vendors?:Vendor[];ok?:boolean;error?:string;message?:string};
type RepairBoardResult={ok?:boolean;repairId?:string;error?:string};

const OUTSIDE_VALUE='__outside_vendor__';
function normalize(value:string){return value.replace(/\s+/g,' ').trim().toLowerCase();}

export default function RepairCardOutsideVendor(){
  const[repairs,setRepairs]=useState<Repair[]>([]);
  const[vendors,setVendors]=useState<Vendor[]>([]);
  const[canManage,setCanManage]=useState(false);
  const[selectedUnit,setSelectedUnit]=useState('');
  const[repairId,setRepairId]=useState('');
  const[vendorId,setVendorId]=useState('');
  const[notes,setNotes]=useState('');
  const[message,setMessage]=useState('');
  const[busy,setBusy]=useState(false);
  const observerRef=useRef<MutationObserver|null>(null);

  async function load(){
    const[boardResponse,outsideResponse]=await Promise.all([
      fetch('/api/repair-board',{cache:'no-store'}),
      fetch('/api/outside-repairs',{cache:'no-store'}),
    ]);
    const board=await boardResponse.json() as BoardPayload;
    if(boardResponse.status===401)return;
    if(!boardResponse.ok)throw new Error(board.error||'Repair Board could not be loaded.');
    setCanManage(Boolean(board.canManage));
    setRepairs(board.repairs||[]);
    if(outsideResponse.ok){const outside=await outsideResponse.json() as OutsidePayload;setVendors(outside.vendors||[]);}
  }

  useEffect(()=>{void load().catch(()=>{});},[]);

  const unitRepairs=useMemo(()=>repairs.filter(row=>normalize(row.unit)===normalize(selectedUnit)),[repairs,selectedUnit]);
  const selectedRepair=unitRepairs.find(row=>row.id===repairId)||unitRepairs[0]||null;

  useEffect(()=>{
    if(!canManage||!repairs.length)return;
    const attach=()=>{
      const selects=Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
      for(const select of selects){
        if(select.querySelector(`option[value="${OUTSIDE_VALUE}"]`))continue;
        const optionText=Array.from(select.options).map(option=>option.textContent||'').join(' | ');
        if(!/Assign unassigned|Assign \d+|Unassigned/i.test(optionText))continue;
        const unitSection=select.closest<HTMLElement>('[class*="unitDetail"]');
        const compactRow=select.closest<HTMLElement>('[class*="compactRow"]');
        let unit=(unitSection?.querySelector('h3')?.textContent||'').replace(/^Unit\s+/i,'').trim();
        if(!unit&&select.getAttribute('aria-label'))unit=(select.getAttribute('aria-label')||'').replace(/^Assign Unit\s+/i,'').replace(/\s+to technician$/i,'').trim();
        if(!unit&&compactRow)unit=compactRow.querySelector('strong')?.textContent?.trim()||'';
        if(!unit)continue;
        const outsideOption=document.createElement('option');
        outsideOption.value=OUTSIDE_VALUE;
        outsideOption.textContent='Outside Vendor…';
        select.appendChild(outsideOption);
        select.dataset.outsideVendorAssignment='1';
        select.dataset.outsideVendorUnit=unit;
        const listener=()=>{
          if(select.value!==OUTSIDE_VALUE)return;
          const targetUnit=select.dataset.outsideVendorUnit||'';
          select.value='';
          const matches=repairs.filter(row=>normalize(row.unit)===normalize(targetUnit));
          setSelectedUnit(targetUnit);
          setRepairId(matches.length===1?matches[0].id:'');
          setVendorId('');setNotes('');setMessage('');
        };
        select.addEventListener('change',listener);
        (select as HTMLSelectElement & {_outsideVendorListener?:()=>void})._outsideVendorListener=listener;
      }
    };
    attach();
    observerRef.current?.disconnect();
    const observer=new MutationObserver(attach);
    observer.observe(document.body,{childList:true,subtree:true});
    observerRef.current=observer;
    return()=>{
      observer.disconnect();observerRef.current=null;
      document.querySelectorAll<HTMLSelectElement>('select[data-outside-vendor-assignment="1"]').forEach(select=>{
        const listener=(select as HTMLSelectElement & {_outsideVendorListener?:()=>void})._outsideVendorListener;
        if(listener)select.removeEventListener('change',listener);
        select.querySelector(`option[value="${OUTSIDE_VALUE}"]`)?.remove();
        delete select.dataset.outsideVendorAssignment;
        delete select.dataset.outsideVendorUnit;
      });
    };
  },[canManage,repairs]);

  async function ensureRepair(row:Repair){
    if(row.id.startsWith('repair-'))return row.id;
    let body:Record<string,unknown>;
    if(row.source==='dvir')body={repairId:row.id,action:'createDvirRepair',defectId:row.dvirDefectId||row.id.replace(/^dvir-/,'')};
    else if(row.source==='pm'||row.source==='annual')body={repairId:row.id,action:'createMaintenanceRepair',maintenanceId:row.maintenanceId||row.id};
    else throw new Error('Create a repair job before sending this item outside.');
    const response=await fetch('/api/repair-board',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json() as RepairBoardResult;
    if(!response.ok||!result.ok||!result.repairId)throw new Error(result.error||'The repair job could not be created.');
    return result.repairId;
  }

  async function move(){
    if(!selectedRepair){setMessage('Choose the repair going outside.');return;}
    if(!vendorId){setMessage('Choose the outside vendor.');return;}
    setBusy(true);setMessage('');
    try{
      const actualRepairId=await ensureRepair(selectedRepair);
      const response=await fetch('/api/outside-repairs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',repairId:actualRepairId,vendorId:Number(vendorId),notes})});
      const result=await response.json() as OutsidePayload;
      if(!response.ok||!result.ok)throw new Error(result.error||'Repair could not be moved to Outside Repairs.');
      setSelectedUnit('');
      window.location.reload();
    }catch(error){setMessage(error instanceof Error?error.message:'Repair could not be moved to Outside Repairs.');}
    finally{setBusy(false);}
  }

  if(!selectedUnit)return null;
  return <div style={backdrop} role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setSelectedUnit('');}}>
    <section role="dialog" aria-modal="true" aria-label="Assign outside vendor" style={modal}>
      <div style={eyebrow}>ASSIGN OUTSIDE VENDOR</div>
      <h2 style={{margin:'3px 0 6px'}}>Unit {selectedUnit}</h2>
      {unitRepairs.length>1&&<label style={label}>Repair
        <select autoFocus value={repairId} onChange={event=>setRepairId(event.target.value)} style={input}>
          <option value="">Choose repair</option>
          {unitRepairs.map(row=><option key={row.id} value={row.id}>{row.issue||row.status}</option>)}
        </select>
      </label>}
      {selectedRepair&&<div style={issue}>{selectedRepair.issue||selectedRepair.status}</div>}
      <label style={label}>Outside vendor
        <select autoFocus={unitRepairs.length<=1} value={vendorId} onChange={event=>setVendorId(event.target.value)} style={input}>
          <option value="">Choose vendor</option>
          {vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.phone?` — ${vendor.phone}`:''}</option>)}
        </select>
      </label>
      <label style={label}>Optional note
        <textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={1000} style={{...input,minHeight:82}} placeholder={`Example: Unit ${selectedUnit} — please text when fixed.`}/>
      </label>
      {message&&<div style={notice}>{message}</div>}
      <div style={actions}><button type="button" disabled={busy} onClick={()=>setSelectedUnit('')} style={secondary}>Cancel</button><button type="button" disabled={busy} onClick={()=>void move()} style={{...primary,opacity:busy?.6:1}}>{busy?'Moving…':'Assign & Move to Outside Work'}</button></div>
    </section>
  </div>;
}

const backdrop:CSSProperties={position:'fixed',inset:0,zIndex:10000,background:'rgba(8,20,32,.55)',display:'grid',placeItems:'center',padding:18};
const modal:CSSProperties={width:'min(560px,100%)',background:'#fff',borderRadius:14,padding:20,boxShadow:'0 24px 70px rgba(0,0,0,.28)',color:'#172536'};
const eyebrow:CSSProperties={fontSize:11,fontWeight:950,letterSpacing:'.11em',color:'#50677a'};
const issue:CSSProperties={padding:'10px 12px',border:'1px solid #d8e1e8',borderRadius:8,background:'#f7fafc',margin:'10px 0 14px',fontWeight:750};
const label:CSSProperties={display:'grid',gap:6,fontSize:12,fontWeight:900,marginTop:11};
const input:CSSProperties={width:'100%',boxSizing:'border-box',minHeight:42,border:'1px solid #b9c7d2',borderRadius:8,padding:'8px 10px',background:'#fff',font:'inherit'};
const notice:CSSProperties={marginTop:12,padding:'9px 11px',border:'1px solid #d7c27b',borderRadius:8,background:'#fffdf2',fontSize:13};
const actions:CSSProperties={display:'flex',justifyContent:'flex-end',gap:9,marginTop:16,flexWrap:'wrap'};
const primary:CSSProperties={minHeight:42,border:0,borderRadius:8,padding:'9px 14px',background:'#10243a',color:'#fff',fontWeight:900,cursor:'pointer'};
const secondary:CSSProperties={minHeight:42,border:'1px solid #b7c5d1',borderRadius:8,padding:'9px 14px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'};
