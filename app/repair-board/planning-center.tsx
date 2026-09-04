'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import RepairBoardAddRepair from './add-repair-form';
import RepairPhotoPreview from './repair-photo-preview';
import {normalizeYard,YARD_DEFINITIONS,YARD_KEYS,yardLabel,type YardKey,type YardSelection} from '@/lib/yards';
import s from './planning-center.module.css';

type Src='repair'|'dvir'|'dvir-repair'|'pm'|'annual'|'pm-repair'|'annual-repair';
type Shop='all'|YardKey;
type Category='all'|'active'|'pm'|'annual'|'glass';
type StatusFilter='all'|'overdue'|'due-soon'|'in-progress'|'waiting'|'unassigned';
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
type Activity={id:number;action:string;detail:string;createdAt:string;unit:string;actor:string};
type Review={
 notes:{id:number;detail:string;technician:string;createdAt:string}[];
 parts:{partId:number;partNumber:string;description:string;quantity:number}[];
 labor:{id:number;technician:string;hours:number;notes:string;startedAt:string|null;endedAt:string|null}[];
 requests:{id:number;partNumber:string;description:string;requestedQuantity:number;reservedQuantity:number;usedQuantity:number;remainingQuantity:number;shortageQuantity:number;status:string}[];
};

const pm=(source:Src)=>source==='pm'||source==='pm-repair';
const annual=(source:Src)=>source==='annual'||source==='annual-repair';
const raw=(source:Src)=>source==='pm'||source==='annual';
const scheduled=(source:Src)=>source==='dvir'||raw(source);
const kind=(value:string)=>/trailer/i.test(value)?'trailer':/truck|tractor|vehicle/i.test(value)?'truck':'other';
const glass=(row:Row)=>!pm(row.source)&&!annual(row.source)&&/\b(glass|windshield|windscreen|window|backlite|side glass)\b/i.test(`${row.issue} ${row.parts}`);
const rowKey=(row:Row)=>row.equipmentId?`e-${row.equipmentId}`:`u-${row.unit.trim().toLowerCase()||row.id}`;
const sourceLabel=(source:Src)=>source==='dvir'?'DVIR':source==='dvir-repair'?'DVIR Job':source==='pm'?'PM Due':source==='annual'?'Annual Due':source==='pm-repair'?'PM Job':source==='annual-repair'?'Annual Job':'Repair';
const displayDriver=(value:string)=>value.includes('@')?'':value.trim();

function groups(rows:Row[]){
 const map=new Map<string,Group>();
 for(const row of rows){
  const key=rowKey(row),current=map.get(key);
  if(current){current.rows.push(row);current.location||=row.location;current.driver||=displayDriver(row.driver);}
  else map.set(key,{key,unit:row.unit,equipmentId:row.equipmentId,equipmentType:row.equipmentType,location:row.location,driver:displayDriver(row.driver),rows:[row]});
 }
 return [...map.values()].map(group=>({...group,rows:[...group.rows].sort((a,b)=>a.priority-b.priority||a.issue.localeCompare(b.issue))}));
}
function statusRank(row:Row){const z=row.status.toLowerCase();return z.includes('overdue')||row.priority===1?0:z.includes('waiting')?1:row.activeTimer||z.includes('progress')?2:z.includes('due soon')?3:z.includes('assigned')?4:5;}
function lead(group:Group){return [...group.rows].sort((a,b)=>statusRank(a)-statusRank(b)||a.priority-b.priority)[0];}
function groupIssue(group:Group){const values=group.rows.map(row=>row.issue.trim()).filter(Boolean);return values.slice(0,2).join(' • ')+(values.length>2?` +${values.length-2} more`:'');}
function groupParts(group:Group){const values=[...new Set(group.rows.map(row=>row.parts.trim()).filter(Boolean))];return values.length?values.slice(0,2).join(' • '):'No parts listed';}
function groupAssignee(group:Group){const values=[...new Set(group.rows.map(row=>row.assignedTo.trim()).filter(Boolean))];return values.length?values.join(', '):'Unassigned';}
function shownStatus(row:Row){if(row.activeTimer)return'In Progress';if(row.priority===1&&!pm(row.source)&&!annual(row.source)&&!row.status.toLowerCase().includes('overdue'))return'Critical';return row.status||'Open';}
function statusClass(row:Row){const z=shownStatus(row).toLowerCase();if(z.includes('overdue')||z.includes('critical'))return s.overdue;if(z.includes('due soon'))return s.due;if(z.includes('waiting'))return s.waiting;if(z.includes('progress')||row.activeTimer)return s.progress;if(z.includes('assigned'))return s.assigned;return'';}
function when(value?:string|null){if(!value)return'';const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;const date=new Date(normalized);return Number.isNaN(date.getTime())?value:date.toLocaleString();}

function RepairReviewSummary({repairId}:{repairId:string}){
 const[review,setReview]=useState<Review|null>(null);
 const[failed,setFailed]=useState(false);
 useEffect(()=>{
  let cancelled=false;
  void fetch(`/api/shop/repair-review?repairId=${encodeURIComponent(repairId)}`,{cache:'no-store'})
   .then(async response=>{if(!response.ok)throw new Error();return response.json() as Promise<Review>;})
   .then(payload=>{if(!cancelled)setReview(payload);})
   .catch(()=>{if(!cancelled)setFailed(true);});
  return()=>{cancelled=true};
 },[repairId]);
 if(failed||!review)return null;
 const hasAnything=review.notes.length||review.parts.length||review.labor.length||review.requests.length;
 if(!hasAnything)return null;
 return <div className={s.review}>
  <h4>Shop work recorded</h4>
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
 const[activity,setActivity]=useState<Activity[]>([]);
 const[shop,setShop]=useState<Shop>('all');
 const[category,setCategory]=useState<Category>('all');
 const[statusFilter,setStatusFilter]=useState<StatusFilter>('all');
 const[assignee,setAssignee]=useState('all');
 const[q,setQ]=useState('');
 const[selected,setSelected]=useState<Set<string>>(()=>new Set());
 const[bulkTech,setBulkTech]=useState('');
 const[detailKey,setDetailKey]=useState<string|null>(null);
 const[expandedPanels,setExpandedPanels]=useState<Set<string>>(()=>new Set());
 const[add,setAdd]=useState(false);
 const[unitAddId,setUnitAddId]=useState<number|null>(null);
 const[busy,setBusy]=useState('');
 const[message,setMessage]=useState('');

 const load=useCallback(async()=>{
  const extras=Promise.all([
   fetch('/api/repair-board/eta',{cache:'no-store'}),
   fetch('/api/yard-status',{cache:'no-store'}),
   fetch('/api/repair-board/activity',{cache:'no-store'}),
  ]);
  const boardResponse=await fetch('/api/repair-board',{cache:'no-store'});
  const board=await boardResponse.json() as Data&{error?:string};
  if(!boardResponse.ok)throw new Error(board.error||'Planning Center could not be loaded.');
  setData(board);
  const[etaResponse,yardResponse,activityResponse]=await extras;
  const eta=await etaResponse.json().catch(()=>({})) as {etaByEquipment?:Record<string,string>};
  const yard=await yardResponse.json().catch(()=>({})) as {byEquipment?:Record<string,YardInfo>;sync?:Sync|null};
  const recent=await activityResponse.json().catch(()=>({})) as {activity?:Activity[]};
  setEtas(etaResponse.ok?eta.etaByEquipment||{}:{});
  setYards(yardResponse.ok?yard.byEquipment||{}:{});
  setSync(yardResponse.ok?yard.sync||null:null);
  setActivity(activityResponse.ok?recent.activity||[]:[]);
 },[]);
 useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Planning Center could not be loaded.'));},[load]);
 useEffect(()=>{setSelected(new Set());setBulkTech('');},[shop,category,statusFilter,assignee]);

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

 const filtered=useMemo(()=>{
  const needle=q.trim().toLowerCase();
  return yardRows.filter(row=>{
   const isGlass=glass(row),isPm=pm(row.source),isAnnual=annual(row.source);
   if(category==='active'&&(isGlass||isPm||isAnnual))return false;
   if(category==='pm'&&!isPm)return false;
   if(category==='annual'&&!isAnnual)return false;
   if(category==='glass'&&!isGlass)return false;
   const z=row.status.toLowerCase();
   if(statusFilter==='overdue'&&!z.includes('overdue')&&row.priority!==1)return false;
   if(statusFilter==='due-soon'&&!z.includes('due soon'))return false;
   if(statusFilter==='in-progress'&&!(row.activeTimer||z.includes('progress')))return false;
   if(statusFilter==='waiting'&&!z.includes('waiting'))return false;
   if(statusFilter==='unassigned'&&row.technicianId!==null)return false;
   if(assignee==='unassigned'&&row.technicianId!==null)return false;
   if(/^\d+$/.test(assignee)&&Number(assignee)!==Number(row.technicianId||0))return false;
   if(needle&&![row.unit,row.issue,row.parts,row.location,displayDriver(row.driver),row.assignedTo,row.status,sourceLabel(row.source),etas[String(row.equipmentId||'')]].join(' ').toLowerCase().includes(needle))return false;
   return true;
  });
 },[yardRows,q,category,statusFilter,assignee,etas]);

 const panels=useMemo(()=>{
  const available=filtered.filter(row=>!row.outOfService);
  const glassRows=available.filter(glass);
  const active=available.filter(row=>!pm(row.source)&&!annual(row.source)&&!glass(row));
  const pmRows=available.filter(row=>pm(row.source));
  const annualRows=available.filter(row=>annual(row.source));
  return{
   active:groups(active),
   pms:groups(pmRows.filter(row=>kind(row.equipmentType)!=='trailer')),
   truckAnnuals:groups(annualRows.filter(row=>kind(row.equipmentType)!=='trailer')),
   trailerAnnuals:groups(annualRows.filter(row=>kind(row.equipmentType)==='trailer')),
   trailerServices:groups(pmRows.filter(row=>kind(row.equipmentType)==='trailer')),
   glass:groups(glassRows),
  };
 },[filtered]);
 const allGroups=useMemo(()=>groups(allRows),[allRows]);
 const detail=detailKey?allGroups.find(group=>group.key===detailKey)||null:null;

 const metrics=useMemo(()=>{
  const overdue=yardRows.filter(row=>row.status.toLowerCase().includes('overdue')||row.priority===1).length;
  const dueSoon=yardRows.filter(row=>row.status.toLowerCase().includes('due soon')).length;
  const inProgress=yardRows.filter(row=>row.activeTimer||row.status.toLowerCase().includes('progress')).length;
  const unassigned=yardRows.filter(row=>row.technicianId===null).length;
  return{open:yardRows.length,overdue,dueSoon,inProgress,unassigned};
 },[yardRows]);
 const upcoming=useMemo(()=>yardRows.filter(row=>pm(row.source)||annual(row.source)).sort((a,b)=>statusRank(a)-statusRank(b)||a.unit.localeCompare(b.unit,undefined,{numeric:true})).slice(0,10),[yardRows]);

 async function req(id:string,body:Record<string,unknown>){
  const response=await fetch('/api/repair-board',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repairId:id,...body})});
  const result=await response.json() as {ok?:boolean;error?:string};
  if(!response.ok||!result.ok)throw new Error(result.error||'Repair Board change failed.');
  return result;
 }
 async function change(id:string,body:Record<string,unknown>){
  setBusy(id);setMessage('');
  try{await req(id,body);await load();}
  catch(error){setMessage(error instanceof Error?error.message:'Repair Board change failed.');}
  finally{setBusy('');}
 }
 async function assignSingle(row:Row,technicianId:number){
  if(!technicianId)return;
  if(row.source==='dvir')return change(row.id,{action:'createDvirRepair',defectId:row.dvirDefectId,technicianId});
  if(raw(row.source))return change(row.id,{action:'createMaintenanceRepair',maintenanceId:row.maintenanceId||row.id,technicianId});
  return change(row.id,{action:'assignTechnician',technicianId});
 }
 async function bulkAssign(){
  const technicianId=Number(bulkTech);
  if(!technicianId)return setMessage('Choose a technician for the selected work.');
  const itemIds=[...selected];
  if(!itemIds.length)return;
  setBusy('bulk');setMessage('');
  try{
   const response=await fetch('/api/repair-board/bulk-assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({technicianId,itemIds})});
   const result=await response.json() as {ok?:boolean;error?:string;assignedCount?:number;technicianName?:string};
   if(!response.ok||!result.ok)throw new Error(result.error||'Selected work could not be assigned.');
   setMessage(`${result.assignedCount||itemIds.length} selected item(s) assigned to ${result.technicianName||'the technician'}.`);
   setSelected(new Set());setBulkTech('');await load();
  }catch(error){setMessage(error instanceof Error?error.message:'Selected work could not be assigned.');}
  finally{setBusy('');}
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

 function Panel({name,title,items,wide=false}:{name:string;title:string;items:Group[];wide?:boolean}){
  const expanded=expandedPanels.has(name),shown=expanded?items:items.slice(0,6);
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
      <div className={s.meta}><span className={`${s.status} ${statusClass(top)}`}>{shownStatus(top)}</span><small>{group.rows.length>1?`${group.rows.length} open items`:sourceLabel(top.source)}</small></div>
      <button className={s.chev} type="button" onClick={event=>{event.stopPropagation();setDetailKey(group.key)}}>›</button>
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
   <button className={s.button} type="button" disabled={Boolean(busy)} onClick={()=>void change(row.id,{action:'setStatus',status:'Completed'})}>Complete Repair</button>
   <a className={s.link} href="/shop">Open Shop Jobs</a>
  </>;
 }

 const diag=sync?`${sync.positions} positions · ${YARD_DEFINITIONS.map(definition=>`${sync[definition.key]} ${definition.label}`).join(' · ')}${sync.updatedAt?` · ${when(sync.updatedAt)}`:''}`:'No Geotab yard sync recorded.';
 return <main className={s.page}><div className={s.shell}>
  <header className={s.top}>
   <div className={s.brand}><p>NORTHERN LOGISTICS</p><h1>Planning Center</h1><span>Repairs, PMs, annuals, glass and service planning in one place</span></div>
   <div className={s.actions}>
    <input className={s.search} value={q} onChange={event=>setQ(event.target.value)} placeholder="Search unit, issue, parts, driver, yard or technician…"/>
    {data?.canManage&&<button type="button" className={s.primary} onClick={()=>{setUnitAddId(null);setAdd(current=>!current)}}>{add?'Close Add Repair':'+ Add Repair'}</button>}
    <button type="button" className={s.button} onClick={()=>void load()}>Refresh</button>
   </div>
  </header>

  <nav className={s.yardBar}>{(['all',...YARD_KEYS] as Shop[]).map(value=><button type="button" key={value} className={shop===value?s.active:''} onClick={()=>setShop(value)}>{value==='all'?'All Yards':yardLabel(value)} <b>{counts[value]}</b></button>)}</nav>
  <div className={s.sync}><div className={s.syncLeft}><i className={s.dot}></i><strong>Geotab</strong><span>{diag}</span></div><div className={s.syncRight}><button type="button" className={s.quiet} onClick={()=>void checkGeotab()}>{busy==='geotab'?'Checking…':'Check Geotab Now'}</button><a className={s.link} href="/work-orders">WO Review</a></div></div>
  {message&&<div className={s.notice}>{message}</div>}
  {add&&data?.canManage&&<div className={s.addWrap}><RepairBoardAddRepair equipment={data.equipment} technicians={data.technicians} initialEquipmentId={null} onClose={()=>setAdd(false)} onSaved={load}/></div>}

  <div className={s.filters}>
   <label>Category <select value={category} onChange={event=>setCategory(event.target.value as Category)}><option value="all">All work</option><option value="active">Active repairs / DVIR</option><option value="pm">PM / Services</option><option value="annual">Annuals</option><option value="glass">Glass</option></select></label>
   <label>Status <select value={statusFilter} onChange={event=>setStatusFilter(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="overdue">Overdue / critical</option><option value="due-soon">Due soon</option><option value="in-progress">In progress</option><option value="waiting">Awaiting parts</option><option value="unassigned">Unassigned</option></select></label>
   <label>Assignee <select value={assignee} onChange={event=>setAssignee(event.target.value)}><option value="all">All technicians</option><option value="unassigned">Unassigned</option>{data?.technicians.map(tech=><option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
   {(category!=='all'||statusFilter!=='all'||assignee!=='all')&&<button className={s.quiet} type="button" onClick={()=>{setCategory('all');setStatusFilter('all');setAssignee('all')}}>Clear filters</button>}
  </div>

  <section className={s.summary}>
   <div className={`${s.metric} ${s.metricInfo}`}><span>All Open</span><strong>{metrics.open}</strong><small>Current selected yard</small></div>
   <div className={`${s.metric} ${s.metricDanger}`}><span>Overdue / Critical</span><strong>{metrics.overdue}</strong><small>Needs attention</small></div>
   <div className={`${s.metric} ${s.metricWarn}`}><span>Due Soon</span><strong>{metrics.dueSoon}</strong><small>PM / annual planning</small></div>
   <div className={`${s.metric} ${s.metricSuccess}`}><span>In Progress</span><strong>{metrics.inProgress}</strong><small>Labor or work underway</small></div>
   <div className={s.metric}><span>Unassigned</span><strong>{metrics.unassigned}</strong><small>Ready to schedule</small></div>
  </section>

  {selected.size>0&&<div className={s.bulk}><strong>{selected.size} selected</strong><span>Assign all checked work to:</span><select value={bulkTech} onChange={event=>setBulkTech(event.target.value)}><option value="">Choose technician…</option>{data?.technicians.map(tech=><option key={tech.id} value={tech.id}>{tech.name}</option>)}</select><button className={s.primary} type="button" disabled={busy==='bulk'||!bulkTech} onClick={()=>void bulkAssign()}>{busy==='bulk'?'Assigning…':'Apply Assignment'}</button><button className={s.button} type="button" disabled={busy==='bulk'} onClick={()=>{setSelected(new Set());setBulkTech('')}}>Clear Selection</button></div>}

  <div className={s.layout}>
   <div className={s.mainGrid}>
    {(category==='all'||category==='active')&&<Panel name="active" title="Active Repairs / DVIR" items={panels.active} wide/>}
    {(category==='all'||category==='pm')&&<Panel name="pms" title="PMs" items={panels.pms}/>} 
    {(category==='all'||category==='annual')&&<Panel name="truck-annuals" title="Truck Annuals" items={panels.truckAnnuals}/>} 
    {(category==='all'||category==='annual')&&<Panel name="trailer-annuals" title="Trailer Annuals" items={panels.trailerAnnuals}/>} 
    {(category==='all'||category==='pm')&&<Panel name="trailer-services" title="Trailer Services" items={panels.trailerServices}/>} 
    {(category==='all'||category==='glass')&&<Panel name="glass" title="Glass" items={panels.glass} wide/>}
   </div>

   <aside className={s.aside}>
    {detail?<div className={s.drawer}>
     <header className={s.drawerHead}><div className={s.drawerTop}><div><h2>Unit {detail.unit}</h2><p>{detail.rows.length} open item{detail.rows.length===1?'':'s'} · {detail.location||'No location'}</p></div><button className={s.close} type="button" onClick={()=>setDetailKey(null)}>×</button></div></header>
     <div className={s.facts}>
      <div className={s.fact}><span>Driver</span><strong>{detail.driver||'Not listed'}</strong></div>
      <div className={s.fact}><span>Yard / Location</span><strong>{detail.equipmentId&&yards[String(detail.equipmentId)]?.currentYard?`${yardLabel(yards[String(detail.equipmentId)].currentYard)} Yard`:detail.location||'No location'}</strong></div>
      <div className={s.fact}><span>Assigned</span><strong>{groupAssignee(detail)}</strong></div>
      <div className={s.fact}><span>ETA / Depart</span><strong>{detail.equipmentId?etas[String(detail.equipmentId)]||'Not set':'Not set'}</strong></div>
     </div>
     <div className={s.drawerActions}>
      {detail.equipmentId&&<button className={s.button} type="button" onClick={()=>void setEta(detail.equipmentId!,detail.unit)}>Set ETA / Depart</button>}
      {detail.equipmentId&&<button className={s.button} type="button" onClick={()=>{setAdd(false);setUnitAddId(current=>current===detail.equipmentId?null:detail.equipmentId)}}>{unitAddId===detail.equipmentId?'Close Add':'+ Add Repair'}</button>}
      {detail.equipmentId&&<button className={s.danger} type="button" onClick={()=>{const reason=window.prompt(`Why is Unit ${detail.unit} out of service?`,detail.rows[0]?.issue||'');if(reason?.trim())void change(`oos-${detail.equipmentId}`,{action:'setUnitOos',equipmentId:detail.equipmentId,unit:detail.unit,outOfService:true,reason:reason.trim()})}}>Mark OOS</button>}
     </div>
     {detail.equipmentId&&unitAddId===detail.equipmentId&&data&&<div className={s.addWrap}><RepairBoardAddRepair equipment={data.equipment} technicians={data.technicians} initialEquipmentId={detail.equipmentId} lockEquipment onClose={()=>setUnitAddId(null)} onSaved={load}/></div>}
     <div>{detail.rows.map(row=><article className={s.job} key={row.id}>
      <div className={s.jobHead}><div><div className={s.chips}><span className={s.source}>{sourceLabel(row.source)}</span><span className={`${s.status} ${statusClass(row)}`}>{shownStatus(row)}</span></div><h3>{row.issue}</h3></div><span>{row.laborHours.toFixed(2)} hr</span></div>
      {row.dvirComments&&<p><strong>DVIR:</strong> {row.dvirComments}</p>}
      <div className={s.jobGrid}><div><b>Parts needed</b><span>{row.parts||'No parts listed'}</span></div><div><b>Technician</b><span>{row.assignedTo||'Unassigned'}</span></div></div>
      <div className={s.jobControls}>
       {data?.canManage&&<select aria-label={`Technician for ${row.id}`} value={scheduled(row.source)?'':String(row.technicianId||'')} onChange={event=>{const tech=Number(event.target.value);if(tech)void assignSingle(row,tech)}}><option value="">{scheduled(row.source)?'Assign & create…':'Choose technician…'}</option>{data.technicians.map(tech=><option key={tech.id} value={tech.id}>{tech.name}</option>)}</select>}
       {data?.canManage&&!scheduled(row.source)&&<select aria-label={`Status for ${row.id}`} value={row.status} onChange={event=>void change(row.id,{action:'setStatus',status:event.target.value})}>{[...new Set([row.status,'New','Assigned','Waiting for Parts','In Progress','Completed'])].map(value=><option key={value}>{value}</option>)}</select>}
       {detailActions(row)}
      </div>
      <RepairPhotoPreview repairId={row.id} source={row.source} dvirDefectId={row.dvirDefectId}/>
      {row.id.startsWith('repair-')&&<RepairReviewSummary repairId={row.id}/>} 
     </article>)}</div>
    </div>:<>
     <section className={s.sideCard}><header className={s.sideHead}><strong>Upcoming Work</strong><span>{upcoming.length}</span></header><div className={s.sideBody}>{upcoming.length?upcoming.map(row=><div className={s.sideItem} key={`up-${row.id}`}><strong>Unit {row.unit} · {sourceLabel(row.source)}</strong><span>{row.issue}</span><small>{row.assignedTo||'Unassigned'} · {row.location||'No location'}</small></div>):<div className={s.empty}>No PM or annual work due in this view.</div>}</div></section>
     <section className={s.sideCard}><header className={s.sideHead}><strong>Recent Activity</strong><a className={s.link} href="/work-orders">View work orders</a></header><div className={s.sideBody}>{activity.length?activity.slice(0,10).map(item=><div className={s.sideItem} key={item.id}><strong>{item.unit?`Unit ${item.unit}`:item.action}</strong><span className={s.activityText}>{item.detail||item.action}</span><small>{item.actor} · {when(item.createdAt)}</small></div>):<div className={s.empty}>No recent activity available.</div>}</div></section>
     {(data?.oosUnits.length||0)>0&&<section className={s.sideCard}><header className={s.sideHead}><strong>Out of Service</strong><span>{data?.oosUnits.length}</span></header><div className={s.sideBody}>{data?.oosUnits.slice(0,8).map(unit=><div className={s.sideItem} key={unit.equipmentId}><strong>Unit {unit.unit}</strong><span>{unit.reason||'No reason entered'}</span><small>{unit.location||'No location'} · {unit.openWork.length} open item{unit.openWork.length===1?'':'s'}</small></div>)}</div></section>}
    </>}
   </aside>
  </div>
  <div className={s.classicHint}>Checking a row selects the work in that queue. Pick one technician in the blue assignment bar to assign every checked item. Individual controls remain inside the expanded unit view for one-off corrections.</div>
  <footer className={s.footer}>{data?`${shop==='all'?'All Yards':yardLabel(shop)} · updated ${when(data.updatedAt)}`:'Loading Planning Center…'}</footer>
 </div></main>;
}
