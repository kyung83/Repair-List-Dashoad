'use client';

import {useCallback,useEffect,useMemo,useState,type CSSProperties} from 'react';
import RepairBoardAddRepair from './add-repair-form';
import RepairPhotoPreview from './repair-photo-preview';
import {normalizeYard,YARD_KEYS,yardLabel,type YardKey,type YardSelection} from '@/lib/yards';
import s from './planning-center.module.css';

type Src='repair'|'dvir'|'dvir-repair'|'pm'|'annual'|'pm-repair'|'annual-repair';
type Shop='all'|YardKey;
type Attention='all'|'unassigned'|'critical'|'waiting'|'maintenance'|'working';
type Row={
 id:string;source:Src;priority:number;location:string;unit:string;driver:string;issue:string;parts:string;status:string;
 technicianId:number|null;assignedTo:string;laborHours:number;equipmentType:string;equipmentId:number|null;outOfService:boolean;
 oosReason:string;oosAt:string|null;activeTimer:{startedAt:string;technician:string}|null;dvirDefectId:string;dvirLogId:string;
 dvirComments:string;dvirPhotos:string;maintenanceId:string;
};
type Group={key:string;unit:string;equipmentId:number|null;equipmentType:string;location:string;driver:string;rows:Row[]};
type Tech={id:number;name:string};
type Equip={id:number;unit:string;equipmentType:string;driver:string;location:string};
type Oos={equipmentId:number;unit:string;equipmentType:string;driver:string;location:string;reason:string;since:string|null;openWork:{id:string;source:Src;issue:string;assignedTo:string;status:string}[]};
type Data={canManage:boolean;technicians:Tech[];equipment:Equip[];repairs:Row[];oosUnits:Oos[];updatedAt:string};
type YardInfo={currentYard:YardSelection;zoneName:string;positionAt:string;yardUpdatedAt:string};
type Sync={status:string;message:string;positions:number;clare:number;cadillac:number;gr:number;taylor:number;boyne:number;outside:number;updatedAt:string};
type Review={
 notes:{id:number;detail:string;technician:string;createdAt:string}[];
 parts:{partId:number;partNumber:string;description:string;quantity:number}[];
 labor:{id:number;technician:string;hours:number;notes:string;startedAt:string|null;endedAt:string|null}[];
 requests:{id:number;partNumber:string;description:string;requestedQuantity:number;reservedQuantity:number;usedQuantity:number;remainingQuantity:number;shortageQuantity:number;status:string}[];
};
type Vendor={id:number;name:string;phone:string};
type OutsideDialog={itemIds:string[];vendors:Vendor[];vendorId:string;notes:string}|null;

const BULK_UNASSIGN='__unassign__';
const BULK_OUTSIDE='__outside__';
const pm=(source:Src)=>source==='pm'||source==='pm-repair';
const annual=(source:Src)=>source==='annual'||source==='annual-repair';
const raw=(source:Src)=>source==='pm'||source==='annual';
const scheduled=(source:Src)=>source==='dvir'||raw(source);
const kind=(value:string)=>/trailer/i.test(value)?'trailer':/truck|tractor|vehicle/i.test(value)?'truck':'other';
const glass=(row:Row)=>!pm(row.source)&&!annual(row.source)&&/\b(glass|windshield|windscreen|window|backlite|side glass)\b/i.test(`${row.issue} ${row.parts}`);
const rowKey=(row:Row)=>row.equipmentId?`e-${row.equipmentId}`:`u-${row.unit.trim().toLowerCase()||row.id}`;
const sourceLabel=(source:Src)=>source==='dvir'?'DVIR':source==='dvir-repair'?'DVIR Job':source==='pm'?'PM Due':source==='annual'?'Annual Due':source==='pm-repair'?'PM Job':source==='annual-repair'?'Annual Job':'Repair';
const displayDriver=(value:string)=>value.includes('@')?'':value.trim();
const lower=(value:unknown)=>String(value??'').trim().toLowerCase();

function groups(rows:Row[]){
 const map=new Map<string,Group>();
 for(const row of rows){
  const key=rowKey(row),current=map.get(key);
  if(current){current.rows.push(row);current.location||=row.location;current.driver||=displayDriver(row.driver);}
  else map.set(key,{key,unit:row.unit,equipmentId:row.equipmentId,equipmentType:row.equipmentType,location:row.location,driver:displayDriver(row.driver),rows:[row]});
 }
 return [...map.values()].map(group=>({...group,rows:[...group.rows].sort((a,b)=>a.priority-b.priority||a.issue.localeCompare(b.issue))}));
}
function attentionRank(row:Row){
 const z=lower(row.status);
 if(row.outOfService||row.priority===1||z.includes('overdue'))return 0;
 if(z.includes('waiting'))return 1;
 if(row.activeTimer||z.includes('progress'))return 2;
 if(row.technicianId===null)return 3;
 return 4;
}
function lead(group:Group){return [...group.rows].sort((a,b)=>attentionRank(a)-attentionRank(b)||a.priority-b.priority)[0];}
function groupIssue(group:Group){const values=group.rows.map(row=>row.issue.trim()).filter(Boolean);return values.slice(0,2).join(' • ')+(values.length>2?` +${values.length-2} more`:'');}
function groupParts(group:Group){const values=[...new Set(group.rows.map(row=>row.parts.trim()).filter(Boolean))];return values.length?values.slice(0,2).join(' • '):'No parts listed';}
function groupAssignee(group:Group){const values=[...new Set(group.rows.map(row=>row.assignedTo.trim()).filter(Boolean))];return values.length?values.join(', '):'Unassigned';}
function nextStep(row:Row){
 const z=lower(row.status);
 if(row.outOfService)return'OUT OF SERVICE';
 if(row.activeTimer||z.includes('progress'))return'WORKING NOW';
 if(z.includes('waiting'))return'WAITING ON PARTS';
 if(row.source==='pm')return'PM NEEDS SCHEDULING';
 if(row.source==='annual')return'ANNUAL NEEDS SCHEDULING';
 if(row.source==='dvir')return'DVIR NEEDS ASSIGNMENT';
 if(row.technicianId===null)return'NEEDS ASSIGNMENT';
 return row.assignedTo?`ASSIGNED · ${row.assignedTo}`:'OPEN';
}
function statusClass(row:Row){
 const z=nextStep(row).toLowerCase();
 if(row.outOfService||row.priority===1||lower(row.status).includes('overdue'))return s.overdue;
 if(z.includes('waiting'))return s.waiting;
 if(z.includes('working'))return s.progress;
 if(z.includes('needs')||z.includes('scheduling'))return s.due;
 if(z.includes('assigned'))return s.assigned;
 return'';
}
function when(value?:string|null){if(!value)return'';const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;const date=new Date(normalized);return Number.isNaN(date.getTime())?value:date.toLocaleString();}

function RepairReviewSummary({repairId}:{repairId:string}){
 const[review,setReview]=useState<Review|null>(null);
 useEffect(()=>{
  let cancelled=false;
  void fetch(`/api/shop/repair-review?repairId=${encodeURIComponent(repairId)}`,{cache:'no-store'})
   .then(async response=>response.ok?await response.json() as Review:null)
   .then(payload=>{if(!cancelled)setReview(payload);})
   .catch(()=>undefined);
  return()=>{cancelled=true};
 },[repairId]);
 if(!review||(!review.notes.length&&!review.parts.length&&!review.labor.length&&!review.requests.length))return null;
 return <div className={s.review}>
  <h4>Work recorded on this job</h4>
  <div className={s.reviewGrid}>
   {review.parts.length>0&&<div className={s.reviewSection}><b>Parts used</b><ul>{review.parts.slice(0,5).map(part=><li key={part.partId}>{part.quantity} × {part.partNumber} {part.description}</li>)}</ul></div>}
   {review.requests.length>0&&<div className={s.reviewSection}><b>Parts requests</b><ul>{review.requests.slice(0,5).map(request=><li key={request.id}>{request.partNumber} · {request.remainingQuantity} remaining{request.shortageQuantity>0?` · ${request.shortageQuantity} short`:''}</li>)}</ul></div>}
   {review.labor.length>0&&<div className={s.reviewSection}><b>Labor</b><ul>{review.labor.slice(0,5).map(entry=><li key={entry.id}>{entry.technician} · {entry.hours.toFixed(2)} hr</li>)}</ul></div>}
   {review.notes.length>0&&<div className={s.reviewSection}><b>Notes</b><ul>{review.notes.slice(-5).map(note=><li key={note.id}>{note.detail} — {note.technician}</li>)}</ul></div>}
  </div>
 </div>;
}

export default function PlanningCenter(){
 const[data,setData]=useState<Data|null>(null);
 const[etas,setEtas]=useState<Record<string,string>>({});
 const[yards,setYards]=useState<Record<string,YardInfo>>({});
 const[sync,setSync]=useState<Sync|null>(null);
 const[shop,setShop]=useState<Shop>('all');
 const[attention,setAttention]=useState<Attention>('all');
 const[assignee,setAssignee]=useState('all');
 const[q,setQ]=useState('');
 const[selected,setSelected]=useState<Set<string>>(()=>new Set());
 const[bulkAction,setBulkAction]=useState('');
 const[detailKey,setDetailKey]=useState<string|null>(null);
 const[expandedPanels,setExpandedPanels]=useState<Set<string>>(()=>new Set());
 const[add,setAdd]=useState(false);
 const[unitAddId,setUnitAddId]=useState<number|null>(null);
 const[outside,setOutside]=useState<OutsideDialog>(null);
 const[busy,setBusy]=useState('');
 const[message,setMessage]=useState('');

 const load=useCallback(async()=>{
  const extras=Promise.all([
   fetch('/api/repair-board/eta',{cache:'no-store'}),
   fetch('/api/yard-status',{cache:'no-store'}),
  ]);
  const boardResponse=await fetch('/api/repair-board',{cache:'no-store'});
  const board=await boardResponse.json() as Data&{error?:string};
  if(!boardResponse.ok)throw new Error(board.error||'Planning Center could not be loaded.');
  setData(board);
  const[etaResponse,yardResponse]=await extras;
  const eta=await etaResponse.json().catch(()=>({})) as {etaByEquipment?:Record<string,string>};
  const yard=await yardResponse.json().catch(()=>({})) as {byEquipment?:Record<string,YardInfo>;sync?:Sync|null};
  setEtas(etaResponse.ok?eta.etaByEquipment||{}:{});
  setYards(yardResponse.ok?yard.byEquipment||{}:{});
  setSync(yardResponse.ok?yard.sync||null:null);
 },[]);
 useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Planning Center could not be loaded.'));},[load]);
 useEffect(()=>{setSelected(new Set());setBulkAction('');},[shop,attention,assignee]);

 const yardFor=useCallback((row:Row):YardKey|''=>{
  const live=row.equipmentId?yards[String(row.equipmentId)]?.currentYard:'';
  return live||normalizeYard(row.location);
 },[yards]);
 const allRows=data?.repairs||[];
 const yardRows=useMemo(()=>allRows.filter(row=>shop==='all'||yardFor(row)===shop),[allRows,shop,yardFor]);
 const counts=useMemo(()=>{
  const result:Record<Shop,number>={all:allRows.length,clare:0,cadillac:0,gr:0,taylor:0,boyne:0};
  for(const row of allRows){const yard=yardFor(row);if(yard)result[yard]+=1;}
  return result;
 },[allRows,yardFor]);
 const focusCounts=useMemo(()=>({
  all:yardRows.length,
  unassigned:yardRows.filter(row=>row.technicianId===null&&!row.activeTimer).length,
  critical:yardRows.filter(row=>row.outOfService||row.priority===1||lower(row.status).includes('overdue')).length,
  waiting:yardRows.filter(row=>lower(row.status).includes('waiting')).length,
  maintenance:yardRows.filter(row=>pm(row.source)||annual(row.source)).length,
  working:yardRows.filter(row=>Boolean(row.activeTimer)||lower(row.status).includes('progress')).length,
 }),[yardRows]);

 const filtered=useMemo(()=>{
  const needle=q.trim().toLowerCase();
  return yardRows.filter(row=>{
   const z=lower(row.status);
   if(attention==='unassigned'&&(row.technicianId!==null||Boolean(row.activeTimer)))return false;
   if(attention==='critical'&&!(row.outOfService||row.priority===1||z.includes('overdue')))return false;
   if(attention==='waiting'&&!z.includes('waiting'))return false;
   if(attention==='maintenance'&&!pm(row.source)&&!annual(row.source))return false;
   if(attention==='working'&&!(row.activeTimer||z.includes('progress')))return false;
   if(assignee==='unassigned'&&row.technicianId!==null)return false;
   if(/^\d+$/.test(assignee)&&Number(assignee)!==Number(row.technicianId||0))return false;
   if(needle&&![row.unit,row.issue,row.parts,row.location,displayDriver(row.driver),row.assignedTo,row.status,sourceLabel(row.source),etas[String(row.equipmentId||'')]].join(' ').toLowerCase().includes(needle))return false;
   return true;
  });
 },[yardRows,q,attention,assignee,etas]);

 const panels=useMemo(()=>{
  const glassRows=filtered.filter(glass);
  const active=filtered.filter(row=>!pm(row.source)&&!annual(row.source)&&!glass(row));
  const pmRows=filtered.filter(row=>pm(row.source));
  const annualRows=filtered.filter(row=>annual(row.source));
  return{
   truckRepairs:groups(active.filter(row=>kind(row.equipmentType)==='truck')),
   trailerRepairs:groups(active.filter(row=>kind(row.equipmentType)==='trailer')),
   otherRepairs:groups(active.filter(row=>kind(row.equipmentType)==='other')),
   pms:groups(pmRows.filter(row=>kind(row.equipmentType)!=='trailer')),
   truckAnnuals:groups(annualRows.filter(row=>kind(row.equipmentType)!=='trailer')),
   trailerAnnuals:groups(annualRows.filter(row=>kind(row.equipmentType)==='trailer')),
   trailerServices:groups(pmRows.filter(row=>kind(row.equipmentType)==='trailer')),
   glass:groups(glassRows),
  };
 },[filtered]);
 const allGroups=useMemo(()=>groups(allRows),[allRows]);
 const detail=detailKey?allGroups.find(group=>group.key===detailKey)||null:null;
 const selectedRows=useMemo(()=>allRows.filter(row=>selected.has(row.id)),[allRows,selected]);
 const hasFilters=attention!=='all'||assignee!=='all'||Boolean(q.trim());

 async function req(id:string,body:Record<string,unknown>){
  const response=await fetch('/api/repair-board',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repairId:id,...body})});
  const result=await response.json() as {ok?:boolean;repairId?:string;error?:string};
  if(!response.ok||!result.ok)throw new Error(result.error||'Repair Board change failed.');
  return result;
 }
 async function change(id:string,body:Record<string,unknown>){
  setBusy(id);setMessage('');
  try{await req(id,body);await load();}
  catch(error){setMessage(error instanceof Error?error.message:'Repair Board change failed.');}
  finally{setBusy('');}
 }
 async function assignSingle(row:Row,value:string){
  if(!value)return;
  if(value===BULK_OUTSIDE){await openOutside([row.id]);return;}
  if(value===BULK_UNASSIGN){
   if(!row.id.startsWith('repair-')||row.technicianId===null){setMessage('That work is already unassigned.');return;}
   await change(row.id,{action:'assignTechnician',technicianId:0});return;
  }
  const technicianId=Number(value);
  if(!technicianId)return;
  if(row.source==='dvir'){await change(row.id,{action:'createDvirRepair',defectId:row.dvirDefectId,technicianId});return;}
  if(raw(row.source)){await change(row.id,{action:'createMaintenanceRepair',maintenanceId:row.maintenanceId||row.id,technicianId});return;}
  await change(row.id,{action:'assignTechnician',technicianId});
 }
 async function bulkApply(){
  if(!bulkAction||!selectedRows.length)return;
  if(bulkAction===BULK_OUTSIDE){await openOutside(selectedRows.map(row=>row.id));return;}
  if(bulkAction===BULK_UNASSIGN){
   const targets=selectedRows.filter(row=>row.id.startsWith('repair-')&&row.technicianId!==null);
   if(!targets.length){setMessage('None of the checked work is currently assigned to a technician.');return;}
   const running=targets.find(row=>Boolean(row.activeTimer));
   if(running){setMessage(`Stop active labor on Unit ${running.unit} before unassigning it.`);return;}
   setBusy('bulk');setMessage('');
   try{
    for(const row of targets)await req(row.id,{action:'assignTechnician',technicianId:0});
    setMessage(`${targets.length} selected job${targets.length===1?'':'s'} moved back to Unassigned.`);
    setSelected(new Set());setBulkAction('');await load();
   }catch(error){setMessage(error instanceof Error?error.message:'Selected work could not be unassigned.');}
   finally{setBusy('');}
   return;
  }
  const technicianId=Number(bulkAction);
  if(!technicianId)return;
  setBusy('bulk');setMessage('');
  try{
   const response=await fetch('/api/repair-board/bulk-assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({itemIds:selectedRows.map(row=>row.id),technicianId})});
   const result=await response.json() as {ok?:boolean;error?:string;assignedCount?:number;technicianName?:string};
   if(!response.ok||!result.ok)throw new Error(result.error||'Selected work could not be assigned.');
   setMessage(`${result.assignedCount||selectedRows.length} selected item${selectedRows.length===1?'':'s'} assigned to ${result.technicianName||'the technician'}.`);
   setSelected(new Set());setBulkAction('');await load();
  }catch(error){setMessage(error instanceof Error?error.message:'Selected work could not be assigned.');}
  finally{setBusy('');}
 }
 async function ensureRepair(row:Row){
  if(row.id.startsWith('repair-'))return row.id;
  if(row.source==='dvir'){
   const result=await req(row.id,{action:'createDvirRepair',defectId:row.dvirDefectId});
   if(!result.repairId)throw new Error(`Unit ${row.unit} job could not be created.`);
   return result.repairId;
  }
  if(raw(row.source)){
   const result=await req(row.id,{action:'createMaintenanceRepair',maintenanceId:row.maintenanceId||row.id});
   if(!result.repairId)throw new Error(`Unit ${row.unit} work order could not be created.`);
   return result.repairId;
  }
  throw new Error(`Unit ${row.unit} must be a repair job before it can be sent outside.`);
 }
 async function openOutside(itemIds:string[]){
  const targets=allRows.filter(row=>itemIds.includes(row.id));
  if(!targets.length)return;
  const running=targets.find(row=>Boolean(row.activeTimer));
  if(running){setMessage(`Stop active labor on Unit ${running.unit} before sending it outside.`);return;}
  setBusy('outside-load');setMessage('');
  try{
   const response=await fetch('/api/outside-repairs',{cache:'no-store'});
   const result=await response.json() as {vendors?:Vendor[];error?:string};
   if(!response.ok)throw new Error(result.error||'Outside vendors could not be loaded.');
   setOutside({itemIds:targets.map(row=>row.id),vendors:result.vendors||[],vendorId:'',notes:''});
  }catch(error){setMessage(error instanceof Error?error.message:'Outside vendors could not be loaded.');}
  finally{setBusy('');}
 }
 async function sendOutside(){
  if(!outside)return;
  if(!outside.vendorId){setMessage('Choose the outside vendor first.');return;}
  const targets=allRows.filter(row=>outside.itemIds.includes(row.id));
  setBusy('outside-send');setMessage('');
  let moved=0;
  try{
   for(const row of targets){
    const repairId=await ensureRepair(row);
    const response=await fetch('/api/outside-repairs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',repairId,vendorId:Number(outside.vendorId),notes:outside.notes})});
    const result=await response.json() as {ok?:boolean;error?:string};
    if(!response.ok||!result.ok)throw new Error(result.error||`Unit ${row.unit} could not be sent outside.`);
    moved+=1;
   }
   setOutside(null);setSelected(new Set());setBulkAction('');setDetailKey(null);
   setMessage(`${moved} job${moved===1?'':'s'} sent to Outside Repairs.`);await load();
  }catch(error){
   const detail=error instanceof Error?error.message:'Outside assignment failed.';
   setMessage(moved?`${moved} job${moved===1?'':'s'} moved before another item stopped the batch: ${detail}`:detail);
   if(moved)await load();
  }finally{setBusy('');}
 }
 async function setEta(equipmentId:number,unit:string){
  const value=window.prompt(`ETA / depart plan for Unit ${unit}`,etas[String(equipmentId)]||'');
  if(value===null)return;
  setBusy(`eta-${equipmentId}`);setMessage('');
  try{
   const response=await fetch('/api/repair-board/eta',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({equipmentId,eta:value})});
   const result=await response.json() as {ok?:boolean;error?:string};
   if(!response.ok||!result.ok)throw new Error(result.error||'ETA could not be saved.');
   await load();
  }catch(error){setMessage(error instanceof Error?error.message:'ETA could not be saved.');}
  finally{setBusy('');}
 }
 async function checkGeotab(){
  setBusy('geotab');setMessage('');
  try{
   const response=await fetch('/api/yard-status',{method:'POST'});
   const result=await response.json() as Sync&{error?:string};
   if(!response.ok)throw new Error(result.error||'Geotab refresh failed.');
   setMessage(result.message||'Geotab locations refreshed.');await load();
  }catch(error){setMessage(error instanceof Error?error.message:'Geotab refresh failed.');}
  finally{setBusy('');}
 }
 function toggleGroup(group:Group){
  const ids=group.rows.map(row=>row.id);
  setSelected(current=>{
   const next=new Set(current),all=ids.every(id=>next.has(id));
   ids.forEach(id=>all?next.delete(id):next.add(id));
   return next;
  });
 }
 function togglePanel(name:string){setExpandedPanels(current=>{const next=new Set(current);next.has(name)?next.delete(name):next.add(name);return next;});}
 function showPanel(items:Group[]){return items.length>0||!hasFilters;}

 function Panel({name,title,items,wide=false}:{name:string;title:string;items:Group[];wide?:boolean}){
  const expanded=expandedPanels.has(name),shown=expanded?items:items.slice(0,6);
  if(!showPanel(items))return null;
  return <section className={`${s.panel} ${wide?s.wide:''}`}>
   <header className={s.panelHead}><strong>{title}</strong><span>{items.length}</span></header>
   <div className={s.rows}>
    {shown.map(group=>{
     const top=lead(group),ids=group.rows.map(row=>row.id),checked=ids.length>0&&ids.every(id=>selected.has(id));
     const yard=top.equipmentId?yards[String(top.equipmentId)]?.currentYard:'';
     const etaValue=top.equipmentId?etas[String(top.equipmentId)]||'':'';
     return <div key={`${name}-${group.key}`} className={`${s.row} ${checked?s.rowSelected:''}`} role="button" tabIndex={0} onClick={()=>setDetailKey(group.key)} onKeyDown={event=>{if(event.key==='Enter')setDetailKey(group.key)}}>
      <input aria-label={`Select Unit ${group.unit} ${title}`} className={s.rowCheck} type="checkbox" checked={checked} onClick={event=>event.stopPropagation()} onChange={()=>toggleGroup(group)}/>
      <div className={s.unit}><strong>{group.unit||'—'}</strong><small>{kind(group.equipmentType)}</small></div>
      <div className={s.issue}><strong>{groupIssue(group)||'Open work'}</strong><small>{groupParts(group)}</small></div>
      <div className={`${s.meta} ${s.hideMobile}`}><strong>{yard?`${yardLabel(yard)} Yard`:group.location||'No location'}</strong><small>{group.driver||'No driver'}</small></div>
      <div className={`${s.meta} ${s.hideTablet}`}><strong>{groupAssignee(group)}</strong><small>{etaValue?`ETA ${etaValue}`:'No ETA / depart'}</small></div>
      <div className={s.meta}><span className={`${s.status} ${statusClass(top)}`}>{nextStep(top)}</span><small>{group.rows.length>1?`${group.rows.length} open items`:sourceLabel(top.source)}</small></div>
      <button className={s.chev} type="button" aria-label={`Open Unit ${group.unit}`} onClick={event=>{event.stopPropagation();setDetailKey(group.key)}}>›</button>
     </div>;
    })}
    {!items.length&&<div className={s.empty}>No work in this queue.</div>}
   </div>
   {items.length>6&&<button type="button" className={s.more} onClick={()=>togglePanel(name)}>{expanded?'Show less':`Show ${items.length-6} more`}</button>}
  </section>;
 }

 function detailActions(row:Row){
  if(row.source==='dvir')return <>
   <button className={s.button} type="button" disabled={Boolean(busy)} onClick={()=>void change(row.id,{action:'createDvirRepair',defectId:row.dvirDefectId})}>Create Job</button>
   <button className={s.button} type="button" disabled={Boolean(busy)} onClick={()=>void change(row.id,{action:'markDvirRepaired',defectId:row.dvirDefectId,logId:row.dvirLogId})}>Mark DVIR Repaired</button>
  </>;
  if(raw(row.source))return <>
   <button className={s.button} type="button" disabled={Boolean(busy)} onClick={()=>void change(row.id,{action:'createMaintenanceRepair',maintenanceId:row.maintenanceId||row.id})}>Create Work Order</button>
   <button className={s.button} type="button" disabled={Boolean(busy)} onClick={()=>void change(row.id,{action:'completeMaintenance',maintenanceId:row.maintenanceId||row.id})}>Complete Due Item</button>
  </>;
  return <>
   <button className={s.button} type="button" disabled={Boolean(busy)} onClick={()=>void openOutside([row.id])}>Send Outside</button>
   <button className={s.button} type="button" disabled={Boolean(busy)} onClick={()=>void change(row.id,{action:'setStatus',status:'Completed'})}>Complete Repair</button>
   <a className={s.link} href="/shop">Open Shop Jobs</a>
  </>;
 }

 const syncLabel=sync?.updatedAt?`Geotab updated ${when(sync.updatedAt)}`:'Geotab yard sync not recorded';
 return <main className={s.page} data-planning-center="true"><div className={s.shell}>
  <header className={s.top}>
   <div className={s.brand}><p>NORTHERN LOGISTICS</p><h1>Planning Center</h1><span>Choose what needs attention, then act on the checked work.</span></div>
   <div className={s.actions}>
    <input className={s.search} value={q} onChange={event=>setQ(event.target.value)} placeholder="Search unit, issue, parts, driver, yard or tech…"/>
    {data?.canManage&&<button type="button" className={s.primary} onClick={()=>{setUnitAddId(null);setAdd(current=>!current)}}>{add?'Close Add Repair':'+ Add Repair'}</button>}
    <button type="button" className={s.button} onClick={()=>void load()}>Refresh</button>
   </div>
  </header>

  <nav className={s.yardBar} aria-label="Yard filter">{(['all',...YARD_KEYS] as Shop[]).map(value=><button type="button" key={value} className={shop===value?s.active:''} onClick={()=>setShop(value)}>{value==='all'?'All Yards':yardLabel(value)} <b>{counts[value]}</b></button>)}</nav>
  <nav className={s.yardBar} aria-label="Work needing attention">
   <strong style={{fontSize:10,color:'#526576',marginRight:3}}>SHOW</strong>
   {([
    ['all','All Work',focusCounts.all],['unassigned','Needs Assignment',focusCounts.unassigned],['critical','Critical / OOS',focusCounts.critical],
    ['waiting','Waiting on Parts',focusCounts.waiting],['maintenance','PM / Annual Due',focusCounts.maintenance],['working','Working Now',focusCounts.working],
   ] as Array<[Attention,string,number]>).map(([value,label,count])=><button type="button" key={value} className={attention===value?s.active:''} onClick={()=>setAttention(value)}>{label} <b>{count}</b></button>)}
  </nav>
  <div className={s.sync}><div className={s.syncLeft}><i className={s.dot}></i><span>{syncLabel}</span></div><div className={s.syncRight}><button type="button" className={s.quiet} onClick={()=>void checkGeotab()}>{busy==='geotab'?'Checking…':'Check Geotab'}</button><a className={s.link} href="/work-orders">Completed Work</a></div></div>
  {message&&<div className={s.notice}>{message}</div>}
  {add&&data?.canManage&&<div className={s.addWrap}><RepairBoardAddRepair equipment={data.equipment} technicians={data.technicians} initialEquipmentId={null} onClose={()=>setAdd(false)} onSaved={load}/></div>}

  <div className={s.filters}>
   <label>Assigned to <select value={assignee} onChange={event=>setAssignee(event.target.value)}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{data?.technicians.map(tech=><option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
   {(attention!=='all'||assignee!=='all'||q.trim())&&<button className={s.quiet} type="button" onClick={()=>{setAttention('all');setAssignee('all');setQ('')}}>Clear filters</button>}
  </div>

  {selected.size>0&&<div className={s.bulk}>
   <strong>{selected.size} selected</strong><span>Action for checked work:</span>
   <select aria-label="Bulk action for checked work" value={bulkAction} onChange={event=>setBulkAction(event.target.value)}>
    <option value="">Choose action…</option>
    {data?.technicians.map(tech=><option key={tech.id} value={tech.id}>Assign to {tech.name}</option>)}
    <option value={BULK_UNASSIGN}>Unassign Selected</option>
    <option value={BULK_OUTSIDE}>Outside Vendor…</option>
   </select>
   <button className={s.primary} type="button" disabled={busy==='bulk'||!bulkAction} onClick={()=>void bulkApply()}>{busy==='bulk'?'Working…':'Apply'}</button>
   <button className={s.button} type="button" disabled={busy==='bulk'} onClick={()=>{setSelected(new Set());setBulkAction('')}}>Clear Selection</button>
  </div>}

  <div className={s.layout}>
   <div className={s.mainGrid}>
    <Panel name="truck-repairs" title="Truck Repairs / DVIR" items={panels.truckRepairs}/>
    <Panel name="trailer-repairs" title="Trailer Repairs / DVIR" items={panels.trailerRepairs}/>
    {showPanel(panels.otherRepairs)&&panels.otherRepairs.length>0&&<Panel name="other-repairs" title="Other Equipment Repairs / DVIR" items={panels.otherRepairs} wide/>}
    <Panel name="pms" title="Truck PMs" items={panels.pms}/>
    <Panel name="truck-annuals" title="Truck Annuals" items={panels.truckAnnuals}/>
    <Panel name="trailer-annuals" title="Trailer Annuals" items={panels.trailerAnnuals}/>
    <Panel name="trailer-services" title="Trailer Services" items={panels.trailerServices}/>
    <Panel name="glass" title="Glass" items={panels.glass} wide/>
   </div>

   <aside className={s.aside}>
    {detail&&<div className={s.drawer}>
     <header className={s.drawerHead}><div className={s.drawerTop}><div><h2>Unit {detail.unit}</h2><p>{detail.rows.length} open item{detail.rows.length===1?'':'s'} · {detail.location||'No location'}</p></div><button className={s.close} type="button" onClick={()=>setDetailKey(null)}>×</button></div></header>
     <div className={s.facts}>
      <div className={s.fact}><span>Driver</span><strong>{detail.driver||'Not listed'}</strong></div>
      <div className={s.fact}><span>Yard / Location</span><strong>{detail.equipmentId&&yards[String(detail.equipmentId)]?.currentYard?`${yardLabel(yards[String(detail.equipmentId)].currentYard)} Yard`:detail.location||'No location'}</strong></div>
      <div className={s.fact}><span>Assigned</span><strong>{groupAssignee(detail)}</strong></div>
      <div className={s.fact}><span>ETA / Depart</span><strong>{detail.equipmentId?etas[String(detail.equipmentId)]||'Not set':'Not set'}</strong></div>
     </div>
     <div className={s.drawerActions}>
      {detail.equipmentId&&<a className={s.button} style={{textDecoration:'none',display:'inline-flex',alignItems:'center'}} href={`/unit?unit=${encodeURIComponent(detail.unit)}`}>Open Unit</a>}
      {detail.equipmentId&&<button className={s.button} type="button" onClick={()=>void setEta(detail.equipmentId!,detail.unit)}>Set ETA / Depart</button>}
      {detail.equipmentId&&<button className={s.button} type="button" onClick={()=>{setAdd(false);setUnitAddId(current=>current===detail.equipmentId?null:detail.equipmentId)}}>{unitAddId===detail.equipmentId?'Close Add':'+ Add Repair'}</button>}
      {detail.equipmentId&&<button className={s.danger} type="button" onClick={()=>{const reason=window.prompt(`Why is Unit ${detail.unit} out of service?`,detail.rows[0]?.issue||'');if(reason?.trim())void change(`oos-${detail.equipmentId}`,{action:'setUnitOos',equipmentId:detail.equipmentId,unit:detail.unit,outOfService:true,reason:reason.trim()})}}>Mark OOS</button>}
     </div>
     {detail.equipmentId&&unitAddId===detail.equipmentId&&data&&<div className={s.addWrap}><RepairBoardAddRepair equipment={data.equipment} technicians={data.technicians} initialEquipmentId={detail.equipmentId} lockEquipment onClose={()=>setUnitAddId(null)} onSaved={load}/></div>}
     <div>{detail.rows.map(row=><article className={s.job} key={row.id}>
      <div className={s.jobHead}><div><div className={s.chips}><span className={s.source}>{sourceLabel(row.source)}</span><span className={`${s.status} ${statusClass(row)}`}>{nextStep(row)}</span></div><h3>{row.issue}</h3></div><span>{row.laborHours.toFixed(2)} hr</span></div>
      {row.dvirComments&&<p><strong>DVIR:</strong> {row.dvirComments}</p>}
      <div className={s.jobGrid}><div><b>Parts needed</b><span>{row.parts||'No parts listed'}</span></div><div><b>Technician</b><span>{row.assignedTo||'Unassigned'}</span></div></div>
      <div className={s.jobControls}>
       {data?.canManage&&<select aria-label={`Technician for ${row.id}`} value="" onChange={event=>{const value=event.target.value;event.target.value='';void assignSingle(row,value)}}>
        <option value="">{scheduled(row.source)?'Assign / action…':'Change assignment…'}</option>
        {data.technicians.map(tech=><option key={tech.id} value={tech.id}>Assign to {tech.name}</option>)}
        {!scheduled(row.source)&&<option value={BULK_UNASSIGN}>Unassigned</option>}
        <option value={BULK_OUTSIDE}>Outside Vendor…</option>
       </select>}
       {detailActions(row)}
      </div>
      <RepairPhotoPreview repairId={row.id} source={row.source} dvirDefectId={row.dvirDefectId}/>
      {row.id.startsWith('repair-')&&<RepairReviewSummary repairId={row.id}/>} 
     </article>)}</div>
    </div>}
   </aside>
  </div>
  <div className={s.classicHint}>Checkboxes select the exact work shown in that queue. Use one action in the blue bar for everything checked.</div>
  <footer className={s.footer}>{data?`Updated ${when(data.updatedAt)}`:'Loading Planning Center…'}</footer>

  {outside&&<div style={modalBackdrop} role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&busy!=='outside-send')setOutside(null)}}>
   <section role="dialog" aria-modal="true" aria-label="Assign outside vendor" style={modalBox}>
    <div style={{fontSize:10,fontWeight:950,letterSpacing:'.1em',color:'#5b7082'}}>SEND OUTSIDE</div>
    <h2 style={{margin:'5px 0 4px'}}>Send {outside.itemIds.length} job{outside.itemIds.length===1?'':'s'} to an outside vendor</h2>
    <p style={{margin:'0 0 12px',fontSize:12,color:'#647789'}}>The job leaves the shop assignment queue and stays in Outside Repairs until vendor closeout.</p>
    <div style={{display:'grid',gap:6,marginBottom:12,maxHeight:150,overflow:'auto'}}>{allRows.filter(row=>outside.itemIds.includes(row.id)).map(row=><div key={row.id} style={modalLine}><strong>Unit {row.unit}</strong><span>{row.issue}</span></div>)}</div>
    <label style={modalLabel}>Outside vendor<select autoFocus value={outside.vendorId} onChange={event=>setOutside(current=>current?{...current,vendorId:event.target.value}:current)} style={modalInput}><option value="">Choose vendor…</option>{outside.vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.phone?` — ${vendor.phone}`:''}</option>)}</select></label>
    <label style={modalLabel}>Optional note<textarea value={outside.notes} maxLength={1000} onChange={event=>setOutside(current=>current?{...current,notes:event.target.value}:current)} style={{...modalInput,minHeight:80,resize:'vertical'}} placeholder="What you told the vendor or what they should know"/></label>
    <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:13}}><button className={s.button} type="button" disabled={busy==='outside-send'} onClick={()=>setOutside(null)}>Cancel</button><button className={s.primary} type="button" disabled={busy==='outside-send'||!outside.vendorId} onClick={()=>void sendOutside()}>{busy==='outside-send'?'Sending…':'Send to Outside Repairs'}</button></div>
   </section>
  </div>}
 </div></main>;
}

const modalBackdrop:CSSProperties={position:'fixed',inset:0,zIndex:300,display:'grid',placeItems:'center',padding:18,background:'rgba(6,20,34,.48)'};
const modalBox:CSSProperties={width:'min(620px,100%)',maxHeight:'90vh',overflow:'auto',padding:18,borderRadius:14,background:'#fff',boxShadow:'0 24px 70px rgba(0,0,0,.24)',color:'#172739'};
const modalLabel:CSSProperties={display:'grid',gap:5,marginTop:10,fontSize:12,fontWeight:850};
const modalInput:CSSProperties={width:'100%',boxSizing:'border-box',minHeight:42,padding:'8px 10px',border:'1px solid #bccbd7',borderRadius:8,background:'#fff',font:'inherit'};
const modalLine:CSSProperties={display:'grid',gridTemplateColumns:'110px minmax(0,1fr)',gap:8,padding:'7px 9px',border:'1px solid #e0e7ed',borderRadius:8,background:'#f8fafc',fontSize:11};
