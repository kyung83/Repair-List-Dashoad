'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

type Repair={
  id:string;
  unit:string;
  issue:string;
  parts?:string;
  status:string;
  source:string;
  equipmentType?:string;
  equipmentId:number|null;
  technicianId:number|null;
  activeTimer?:unknown;
  dvirDefectId?:string;
  maintenanceId?:string;
};
type Vendor={id:number;name:string;phone:string};
type BoardPayload={canManage?:boolean;repairs?:Repair[];error?:string};
type OutsidePayload={vendors?:Vendor[];ok?:boolean;error?:string;message?:string};
type RepairBoardResult={ok?:boolean;repairId?:string;error?:string};

type PlanningSelection={unit:string;panel:string};

const OUTSIDE_VALUE='__outside_vendor__';
const PLANNING_PANELS=[
  'Truck Repairs / DVIR',
  'Trailer Repairs / DVIR',
  'Other Equipment Repairs / DVIR',
  'PMs',
  'Truck Annuals',
  'Trailer Annuals',
  'Trailer Services',
  'Glass',
] as const;

function normalize(value:string){return value.replace(/\s+/g,' ').trim().toLowerCase();}
function pm(source:string){return source==='pm'||source==='pm-repair';}
function annual(source:string){return source==='annual'||source==='annual-repair';}
function kind(value:string){return /trailer/i.test(value)?'trailer':/truck|tractor|vehicle/i.test(value)?'truck':'other';}
function glass(row:Repair){return !pm(row.source)&&!annual(row.source)&&/\b(glass|windshield|windscreen|window|backlite|side glass)\b/i.test(`${row.issue||''} ${row.parts||''}`);}

function planningSelection(label:string):PlanningSelection|null{
  if(!label.startsWith('Select Unit '))return null;
  const value=label.slice('Select Unit '.length);
  for(const panel of PLANNING_PANELS){
    const suffix=` ${panel}`;
    if(value.endsWith(suffix))return{unit:value.slice(0,-suffix.length).trim(),panel};
  }
  return null;
}

function rowMatchesPlanningPanel(row:Repair,panel:string){
  const type=kind(row.equipmentType||'');
  const isPm=pm(row.source),isAnnual=annual(row.source),isGlass=glass(row);
  if(panel==='Truck Repairs / DVIR')return !isPm&&!isAnnual&&!isGlass&&type==='truck';
  if(panel==='Trailer Repairs / DVIR')return !isPm&&!isAnnual&&!isGlass&&type==='trailer';
  if(panel==='Other Equipment Repairs / DVIR')return !isPm&&!isAnnual&&!isGlass&&type==='other';
  if(panel==='PMs')return isPm&&type!=='trailer';
  if(panel==='Truck Annuals')return isAnnual&&type!=='trailer';
  if(panel==='Trailer Annuals')return isAnnual&&type==='trailer';
  if(panel==='Trailer Services')return isPm&&type==='trailer';
  if(panel==='Glass')return isGlass;
  return false;
}

export default function RepairCardOutsideVendor(){
  const[repairs,setRepairs]=useState<Repair[]>([]);
  const[vendors,setVendors]=useState<Vendor[]>([]);
  const[canManage,setCanManage]=useState(false);
  const[selectedUnit,setSelectedUnit]=useState('');
  const[selectedItemIds,setSelectedItemIds]=useState<string[]>([]);
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
    if(boardResponse.status===401)return[] as Repair[];
    if(!boardResponse.ok)throw new Error(board.error||'Repair Board could not be loaded.');
    const rows=board.repairs||[];
    setCanManage(Boolean(board.canManage));
    setRepairs(rows);
    if(outsideResponse.ok){const outside=await outsideResponse.json() as OutsidePayload;setVendors(outside.vendors||[]);}
    return rows;
  }

  useEffect(()=>{void load().catch(()=>{});},[]);

  const unitRepairs=useMemo(()=>repairs.filter(row=>normalize(row.unit)===normalize(selectedUnit)),[repairs,selectedUnit]);
  const selectedRepair=unitRepairs.find(row=>row.id===repairId)||unitRepairs[0]||null;
  const selectedRepairs=useMemo(()=>{
    const ids=new Set(selectedItemIds);
    return repairs.filter(row=>ids.has(row.id));
  },[repairs,selectedItemIds]);

  function closeDialog(){
    if(busy)return;
    setSelectedUnit('');setSelectedItemIds([]);setRepairId('');setVendorId('');setNotes('');setMessage('');
  }

  async function openPlanningBulk(){
    try{
      const freshRows=await load();
      const checkboxes=Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label^="Select Unit "]:checked'));
      const selections=checkboxes.map(box=>planningSelection(box.getAttribute('aria-label')||'')).filter((value):value is PlanningSelection=>Boolean(value));
      const ids=new Set<string>();
      for(const selection of selections){
        freshRows
          .filter(row=>normalize(row.unit)===normalize(selection.unit)&&rowMatchesPlanningPanel(row,selection.panel))
          .forEach(row=>ids.add(row.id));
      }
      if(!ids.size){
        window.alert('The checked Planning Center work could not be matched to an open repair. Refresh the board and try again.');
        return;
      }
      setSelectedUnit('');setSelectedItemIds([...ids]);setRepairId('');setVendorId('');setNotes('');setMessage('');
    }catch(error){
      window.alert(error instanceof Error?error.message:'Outside Vendor could not be opened.');
    }
  }

  useEffect(()=>{
    if(!canManage||!repairs.length)return;
    const attach=()=>{
      const selects=Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
      for(const select of selects){
        if(select.querySelector(`option[value="${OUTSIDE_VALUE}"]`))continue;
        const optionText=Array.from(select.options).map(option=>option.textContent||'').join(' | ');
        const aria=select.getAttribute('aria-label')||'';
        const planningBulk=Boolean(select.closest<HTMLElement>('[class*="bulk"]')&&/Choose technician/i.test(optionText));
        const planningDetail=/^Technician for\s+/.test(aria);
        const classicAssign=/Assign unassigned|Assign \d+|Unassigned/i.test(optionText);
        if(!planningBulk&&!planningDetail&&!classicAssign)continue;

        const outsideOption=document.createElement('option');
        outsideOption.value=OUTSIDE_VALUE;
        outsideOption.textContent='Outside Vendor…';
        select.appendChild(outsideOption);
        select.dataset.outsideVendorAssignment='1';
        if(planningBulk)select.dataset.outsideVendorMode='planning-bulk';
        else if(planningDetail)select.dataset.outsideVendorMode='planning-detail';
        else select.dataset.outsideVendorMode='classic';

        if(planningDetail){
          select.dataset.outsideVendorRepair=aria.replace(/^Technician for\s+/,'').trim();
        }else if(classicAssign){
          const unitSection=select.closest<HTMLElement>('[class*="unitDetail"]');
          const compactRow=select.closest<HTMLElement>('[class*="compactRow"]');
          let unit=(unitSection?.querySelector('h3')?.textContent||'').replace(/^Unit\s+/i,'').trim();
          if(!unit&&aria)unit=aria.replace(/^Assign Unit\s+/i,'').replace(/\s+to technician$/i,'').trim();
          if(!unit&&compactRow)unit=compactRow.querySelector('strong')?.textContent?.trim()||'';
          if(unit)select.dataset.outsideVendorUnit=unit;
        }

        const listener=()=>{
          if(select.value!==OUTSIDE_VALUE)return;
          const mode=select.dataset.outsideVendorMode||'';
          select.value='';
          if(mode==='planning-bulk'){
            select.dispatchEvent(new Event('change',{bubbles:true}));
            void openPlanningBulk();
            return;
          }
          if(mode==='planning-detail'){
            const id=select.dataset.outsideVendorRepair||'';
            const row=repairs.find(item=>item.id===id);
            if(!row)return;
            setSelectedItemIds([]);setSelectedUnit(row.unit);setRepairId(row.id);setVendorId('');setNotes('');setMessage('');
            return;
          }
          const targetUnit=select.dataset.outsideVendorUnit||'';
          if(!targetUnit)return;
          const matches=repairs.filter(row=>normalize(row.unit)===normalize(targetUnit));
          setSelectedItemIds([]);setSelectedUnit(targetUnit);setRepairId(matches.length===1?matches[0].id:'');setVendorId('');setNotes('');setMessage('');
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
        delete select.dataset.outsideVendorMode;
        delete select.dataset.outsideVendorUnit;
        delete select.dataset.outsideVendorRepair;
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
    const targets=selectedItemIds.length?selectedRepairs:(selectedRepair?[selectedRepair]:[]);
    if(!targets.length){setMessage('Choose the repair going outside.');return;}
    if(!vendorId){setMessage('Choose the outside vendor.');return;}
    const running=targets.find(row=>Boolean(row.activeTimer));
    if(running){setMessage(`Stop active labor on Unit ${running.unit} before sending it to an outside vendor.`);return;}
    setBusy(true);setMessage('');
    let moved=0;
    try{
      for(const row of targets){
        const actualRepairId=await ensureRepair(row);
        const response=await fetch('/api/outside-repairs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',repairId:actualRepairId,vendorId:Number(vendorId),notes})});
        const result=await response.json() as OutsidePayload;
        if(!response.ok||!result.ok)throw new Error(result.error||`Unit ${row.unit} could not be moved to Outside Repairs.`);
        moved+=1;
      }
      setSelectedUnit('');setSelectedItemIds([]);
      window.location.reload();
    }catch(error){
      const detail=error instanceof Error?error.message:'Repair could not be moved to Outside Repairs.';
      if(moved>0){window.alert(`${moved} selected item${moved===1?'':'s'} moved to Outside Repairs before another item stopped the batch: ${detail}`);window.location.reload();return;}
      setMessage(detail);
    }finally{setBusy(false);}
  }

  const bulkMode=selectedItemIds.length>0;
  const targets=bulkMode?selectedRepairs:(selectedRepair?[selectedRepair]:[]);
  if(!selectedUnit&&!bulkMode)return null;
  return <div style={backdrop} role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)closeDialog();}}>
    <section role="dialog" aria-modal="true" aria-label="Assign outside vendor" style={modal}>
      <div style={eyebrow}>ASSIGN OUTSIDE VENDOR</div>
      <h2 style={{margin:'3px 0 6px'}}>{bulkMode?`${targets.length} selected work item${targets.length===1?'':'s'}`:`Unit ${selectedUnit}`}</h2>
      {bulkMode&&<div style={selectedList}>
        {targets.slice(0,8).map(row=><div key={row.id} style={selectedLine}><strong>Unit {row.unit}</strong><span>{row.issue||row.status}</span></div>)}
        {targets.length>8&&<div style={{fontSize:12,fontWeight:850,color:'#52677a'}}>+ {targets.length-8} more selected item{targets.length-8===1?'':'s'}</div>}
      </div>}
      {!bulkMode&&unitRepairs.length>1&&<label style={label}>Repair
        <select autoFocus value={repairId} onChange={event=>setRepairId(event.target.value)} style={input}>
          <option value="">Choose repair</option>
          {unitRepairs.map(row=><option key={row.id} value={row.id}>{row.issue||row.status}</option>)}
        </select>
      </label>}
      {!bulkMode&&selectedRepair&&<div style={issue}>{selectedRepair.issue||selectedRepair.status}</div>}
      <label style={label}>Outside vendor
        <select autoFocus={bulkMode||unitRepairs.length<=1} value={vendorId} onChange={event=>setVendorId(event.target.value)} style={input}>
          <option value="">Choose vendor</option>
          {vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.phone?` — ${vendor.phone}`:''}</option>)}
        </select>
      </label>
      <label style={label}>Optional note
        <textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={1000} style={{...input,minHeight:82}} placeholder={bulkMode?'Example: Please text when these units are fixed.':`Example: Unit ${selectedUnit} — please text when fixed.`}/>
      </label>
      {message&&<div style={notice}>{message}</div>}
      <div style={actions}><button type="button" disabled={busy} onClick={closeDialog} style={secondary}>Cancel</button><button type="button" disabled={busy} onClick={()=>void move()} style={{...primary,opacity:busy?.6:1}}>{busy?'Moving…':bulkMode?'Send Selected to Outside Work':'Assign & Move to Outside Work'}</button></div>
    </section>
  </div>;
}

const backdrop:CSSProperties={position:'fixed',inset:0,zIndex:10000,background:'rgba(8,20,32,.55)',display:'grid',placeItems:'center',padding:18};
const modal:CSSProperties={width:'min(620px,100%)',maxHeight:'90vh',overflowY:'auto',background:'#fff',borderRadius:14,padding:20,boxShadow:'0 24px 70px rgba(0,0,0,.28)',color:'#172536'};
const eyebrow:CSSProperties={fontSize:11,fontWeight:950,letterSpacing:'.11em',color:'#50677a'};
const issue:CSSProperties={padding:'10px 12px',border:'1px solid #d8e1e8',borderRadius:8,background:'#f7fafc',margin:'10px 0 14px',fontWeight:750};
const selectedList:CSSProperties={display:'grid',gap:6,maxHeight:220,overflowY:'auto',padding:'10px 12px',border:'1px solid #d8e1e8',borderRadius:9,background:'#f7fafc',margin:'10px 0 14px'};
const selectedLine:CSSProperties={display:'grid',gridTemplateColumns:'minmax(90px,auto) 1fr',gap:10,alignItems:'start',fontSize:12};
const label:CSSProperties={display:'grid',gap:6,fontSize:12,fontWeight:900,marginTop:11};
const input:CSSProperties={width:'100%',boxSizing:'border-box',minHeight:42,border:'1px solid #b9c7d2',borderRadius:8,padding:'8px 10px',background:'#fff',font:'inherit'};
const notice:CSSProperties={marginTop:12,padding:'9px 11px',border:'1px solid #d7c27b',borderRadius:8,background:'#fffdf2',fontSize:13};
const actions:CSSProperties={display:'flex',justifyContent:'flex-end',gap:9,marginTop:16,flexWrap:'wrap'};
const primary:CSSProperties={minHeight:42,border:0,borderRadius:8,padding:'9px 14px',background:'#10243a',color:'#fff',fontWeight:900,cursor:'pointer'};
const secondary:CSSProperties={minHeight:42,border:'1px solid #b7c5d1',borderRadius:8,padding:'9px 14px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'};
