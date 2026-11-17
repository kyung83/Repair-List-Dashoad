"use client";

import {useEffect,useRef,useState} from 'react';

type History={entryId:number;repairId:number;laborDate:string;hours:number;rate:number;notes:string;startedAt:string|null;endedAt:string|null;unit:string;title:string;status:string};
type Finished={repairId:number;unit:string;title:string;status:string;completedAt:string;totalHours:number};
type LaborRequest={id:number;request_type:'correction'|'missed';status:string;unit_snapshot:string;repair_snapshot:string;original_hours:number|null;requested_hours:number;source_labor_entry_id:number|null;labor_date:string;details:string;manager_note:string;created_at:string;proposed_repair_id:number|null};
type SearchRepair={repairId:number;unit:string;title:string;status:string};
type Data={ok:boolean;error?:string;history:History[];completed:Finished[];requests:LaborRequest[]};
type Props={isWorking:boolean};

function when(value:string|null|undefined){if(!value)return'';const date=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');return Number.isNaN(date.getTime())?value:date.toLocaleDateString();}
function clock(value:string|null|undefined){if(!value)return'';const date=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');return Number.isNaN(date.getTime())?'':date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
function h(value:number|null|undefined){return Number(value||0).toFixed(2)+' hr';}
function labelStatus(value:string){return value==='needs_info'?'Needs your reply':value==='approved'?'Approved':value==='rejected'?'Rejected':value==='processing'?'Under review':'Pending manager review';}
function dateToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return /^\d{4}-\d{2}-\d{2}$/.test(parts)?parts:new Date().toISOString().slice(0,10);}

export default function TechnicianCompletedWork({isWorking}:Props){
  const[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const[form,setForm]=useState<'none'|'correction'|'missed'>('none');
  const[selected,setSelected]=useState<History|null>(null);
  const[requestedHours,setRequestedHours]=useState('');
  const[reason,setReason]=useState('');
  const[unit,setUnit]=useState(''),[workDescription,setWorkDescription]=useState(''),[workDate,setWorkDate]=useState(dateToday);
  const[missedHours,setMissedHours]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const[repairId,setRepairId]=useState(''),[transferRepairId,setTransferRepairId]=useState('');
  const[query,setQuery]=useState(''),[results,setResults]=useState<SearchRepair[]>([]),[searchBusy,setSearchBusy]=useState(false);
  const[clarifications,setClarifications]=useState<Record<number,string>>({});
  const[more,setMore]=useState(false);
  const key=useRef('');

  async function reload(){
    const r=await fetch('/api/shop/labor-review',{cache:'no-store'});
    const p=await r.json() as Data;
    if(!r.ok||!p.ok)throw new Error(p.error||'Work history could not be loaded.');
    setData(p);
  }
  useEffect(()=>{let alive=true;fetch('/api/shop/labor-review',{cache:'no-store'}).then(async r=>{const p=await r.json() as Data;if(!r.ok||!p.ok)throw new Error(p.error||'Work history could not be loaded.');if(alive)setData(p)}).catch(e=>{if(alive)setError(String(e.message||e))});return()=>{alive=false}},[]);
  function openCorrection(entry:History){
    setForm('correction');setSelected(entry);setRequestedHours(String(entry.hours));setReason('');setTransferRepairId('');setQuery('');setResults([]);setError('');key.current='';
    window.requestAnimationFrame(()=>document.getElementById('labor-request-form')?.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  function openMissed(){
    setForm('missed');setSelected(null);setUnit('');setWorkDescription('');setWorkDate(dateToday());setMissedHours('');setFrom('');setTo('');setReason('');setRepairId('');setQuery('');setResults([]);setError('');key.current='';
    window.requestAnimationFrame(()=>document.getElementById('labor-request-form')?.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  async function searchRepairs(){
    if(query.trim().length<2){setError('Enter at least two characters of a unit or repair.');return}
    setSearchBusy(true);setError('');
    try{const r=await fetch('/api/shop/labor-review?q='+encodeURIComponent(query.trim()),{cache:'no-store'});const p=await r.json() as {ok?:boolean;error?:string;repairs?:SearchRepair[]};if(!r.ok||!p.ok)throw new Error(p.error||'Unable to search repairs.');setResults(p.repairs||[])}
    catch(e){setError(e instanceof Error?e.message:'Unable to search repairs.')}finally{setSearchBusy(false)}
  }
  async function post(action:string,body:Record<string,unknown>){
    setSaving(true);setError('');
    try{
      const r=await fetch('/api/shop/labor-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body})});
      const p=await r.json() as {ok?:boolean;error?:string};
      if(!r.ok||!p.ok)throw new Error(p.error||'Request was not saved.');
      key.current='';setForm('none');setReason('');setSelected(null);await reload();
    }catch(e){setError(e instanceof Error?e.message:'Request was not saved.')}finally{setSaving(false)}
  }
  async function submit(){
    if(!key.current)key.current=crypto.randomUUID();
    if(form==='correction'&&selected){
      await post('submit',{requestKey:key.current,requestType:'correction',entryId:selected.entryId,requestedHours:Number(requestedHours),targetRepairId:transferRepairId||undefined,details:reason});
    }else if(form==='missed'){
      await post('submit',{requestKey:key.current,requestType:'missed',repairId:repairId||undefined,unit,workDescription,workDate,requestedHours:Number(missedHours),startedLocal:from,endedLocal:to,details:reason});
    }
  }
  return <div style={container}>
    <div style={hero}>
      <div><span style={eyebrow}>MY WORK · COMPLETED</span><h2 style={{margin:'5px 0',fontSize:24}}>Previous work & labor requests</h2><span style={{fontSize:12,color:'#d9e7e2'}}>Review your saved work without changing the active repair.</span></div>
      <button type="button" onClick={openMissed} style={addButton}>+ ENTER MISSED WORK</button>
    </div>
    {isWorking&&<div style={info}>Your current labor timer continues running while you view Completed. Use Done Working in the existing work screen to stop it.</div>}
    <div style={miniNote}>Correction requests do not change recorded hours until a manager approves them. Missed work, parts and inspection details need separate verification.</div>
    {error&&<div role="alert" style={alert}>{error}</div>}

    {form!=='none'&&<section id="labor-request-form" style={panel}>
      <div style={heading}><strong>{form==='correction'?'Request labor hour correction':'Report work missed during an outage'}</strong><button type="button" onClick={()=>{setForm('none');setError('')}} style={quiet}>Close</button></div>
      {form==='correction'&&selected&&<>
        <div style={muted}>Unit {selected.unit||'SHOP'} · {selected.title} · {selected.laborDate}</div>
        <div style={chipLine}><span>Recorded: <strong>{h(selected.hours)}</strong></span><span>Requested: <strong>{requestedHours||'—'} hr</strong></span></div>
        <label style={field}>Correct hours on this repair<input type="number" step="0.01" min="0.01" max="24" value={requestedHours} onChange={e=>setRequestedHours(e.target.value)} style={input}/></label>
        <div style={muted}>If some of those hours belong on another repair, search for the destination below. Otherwise leave it blank to remove the excess hours.</div>
      </>}
      {form==='missed'&&<>
        <div style={two}>
          <label style={field}>Unit number<input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="482(SC)" maxLength={45} style={input}/></label>
          <label style={field}>Actual work date<input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)} style={input}/></label>
        </div>
        <label style={field}>Work performed<input value={workDescription} onChange={e=>setWorkDescription(e.target.value)} placeholder="Replaced coolant hose, performed inspection…" maxLength={220} style={input}/></label>
        <div style={two}>
          <label style={field}>Start time (optional)<input type="time" value={from} onChange={e=>setFrom(e.target.value)} style={input}/></label>
          <label style={field}>End time (optional)<input type="time" value={to} onChange={e=>setTo(e.target.value)} style={input}/></label>
        </div>
        <label style={field}>Actual labor hours<input type="number" step="0.01" min="0.01" max="24" value={missedHours} onChange={e=>setMissedHours(e.target.value)} placeholder="2.00" style={input}/></label>
      </>}
      <div style={searchBox}>
        <strong style={{fontSize:12}}>{form==='correction'?'Optional: move reduced hours to another repair':'Optional: link the missed work to an existing repair'}</strong>
        <div style={{display:'flex',gap:7}}>
          <input aria-label="Search unit or repair" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search unit or repair description" style={{...input,flex:1}}/>
          <button type="button" onClick={()=>void searchRepairs()} disabled={searchBusy} style={secondary}>{searchBusy?'Searching…':'Search'}</button>
        </div>
        {results.length>0&&<select aria-label="Choose target repair" value={form==='correction'?transferRepairId:repairId} onChange={e=>form==='correction'?setTransferRepairId(e.target.value):setRepairId(e.target.value)} style={input}>
          <option value="">Do not link a different repair yet</option>
          {results.filter(r=>form!=='correction'||r.repairId!==selected?.repairId).map(r=><option key={r.repairId} value={r.repairId}>{r.unit||'SHOP'} · #{r.repairId} · {r.title} ({r.status})</option>)}
        </select>}
        {((form==='correction'&&transferRepairId)||(form==='missed'&&repairId))&&<button type="button" onClick={()=>form==='correction'?setTransferRepairId(''):setRepairId('')} style={quiet}>Clear selected repair #{form==='correction'?transferRepairId:repairId}</button>}
      </div>
      <label style={field}>What happened? {form==='missed'?'Include parts used, notes, and any PM/annual work.':''}
        <textarea rows={3} maxLength={1500} value={reason} onChange={e=>{setReason(e.target.value);key.current=''}} placeholder="Explain the work and why this entry needs review." style={{...input,resize:'vertical'}}/>
      </label>
      <button type="button" onClick={()=>void submit()} disabled={saving||reason.trim().length<8||(form==='correction'&&!selected)||(form==='missed'&&(!workDescription.trim()||!missedHours))} style={submitButton}>{saving?'Submitting…':'SUBMIT FOR MANAGER REVIEW'}</button>
      <div style={muted}>Submitting does not change labor, inventory, repair completion, DVIR status, or PM/annual certifications.</div>
    </section>}

    <section style={panel}>
      <div style={heading}><strong>My requests</strong><span style={muted}>{data?.requests.length??0} total</span></div>
      {!data&&<div style={muted}>Loading your history…</div>}
      {data?.requests.slice(0,20).map(r=><div key={r.id} style={line}>
        <div style={heading}><strong>#{r.id} · {r.request_type==='missed'?'Missed work':'Labor correction'} · {r.unit_snapshot||'SHOP'}</strong><span style={statusText}>{labelStatus(r.status)}</span></div>
        <div style={muted}>{r.labor_date} · {r.request_type==='correction'?h(r.original_hours)+' → ':''}{h(r.requested_hours)} requested</div>
        <div style={{fontSize:12,marginTop:4}}>{r.details}</div>
        {r.manager_note&&<div style={miniNote}>Manager: {r.manager_note}</div>}
        {r.status==='needs_info'&&<div style={{display:'grid',gap:6,marginTop:7}}><textarea aria-label={'Clarification for request '+r.id} rows={2} maxLength={1500} value={clarifications[r.id]??r.details} onChange={e=>setClarifications(s=>({...s,[r.id]:e.target.value}))} style={input}/><button type="button" disabled={saving} onClick={()=>void post('clarify',{requestId:r.id,details:clarifications[r.id]??r.details})} style={secondary}>SEND CLARIFICATION</button></div>}
      </div>)}
      {data&&data.requests.length===0&&<div style={muted}>No requests submitted yet.</div>}
    </section>

    <section style={panel}>
      <div style={heading}><strong>Saved labor sessions</strong><span style={muted}>Last 90 days · includes unfinished repairs</span></div>
      {data?.history.slice(0,more?160:18).map(entry=><div key={entry.entryId} style={line}>
        <div style={heading}><span style={{fontSize:14}}><strong>{entry.unit||'SHOP'}</strong> · {entry.title}</span><span style={statusText}>{entry.status}</span></div>
        <div style={muted}>{entry.laborDate} {entry.startedAt&&entry.endedAt?(' · '+clock(entry.startedAt)+' – '+clock(entry.endedAt)):' · Manual / no timer times'} · <strong>{h(entry.hours)}</strong></div>
        {entry.notes&&<div style={{fontSize:12,marginTop:4}}>{entry.notes}</div>}
        <button type="button" onClick={()=>openCorrection(entry)} style={secondary}>REQUEST LABOR CORRECTION</button>
      </div>)}
      {data&&data.history.length===0&&<div style={muted}>No saved labor entries in the last 90 days.</div>}
      {data&&data.history.length>18&&<button type="button" style={quiet} onClick={()=>setMore(v=>!v)}>{more?'Show fewer':'Show all saved sessions'}</button>}
    </section>

    <section style={panel}>
      <div style={heading}><strong>Completed work orders</strong><span style={muted}>Last 90 days</span></div>
      {data?.completed.slice(0,40).map(repair=><div key={repair.repairId} style={line}><strong>{repair.unit||'SHOP'} · {repair.title}</strong><div style={muted}>{when(repair.completedAt)} · {repair.status} · Total recorded on repair: {h(repair.totalHours)}</div></div>)}
      {data&&data.completed.length===0&&<div style={muted}>No completed work orders in this period.</div>}
    </section>
  </div>;
}
const container={maxWidth:880,margin:'0 auto',display:'grid',gap:12,padding:'8px 12px 60px',color:'#173f37'} as const;
const hero={display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap' as const,background:'#173f37',color:'white',borderRadius:13,padding:'16px'} as const;
const eyebrow={color:'#b9dace',fontSize:10,letterSpacing:'.1em',fontWeight:900} as const;
const addButton={padding:'11px 13px',border:0,borderRadius:9,background:'#fff',color:'#173f37',fontWeight:950,cursor:'pointer'} as const;
const info={border:'1px solid #dfb967',background:'#fff7e5',padding:12,borderRadius:9,fontWeight:750,fontSize:12} as const;
const miniNote={fontSize:12,color:'#72560e',background:'#fff9e9',border:'1px solid #efe0b5',borderRadius:8,padding:'9px 11px',marginTop:6} as const;
const alert={border:'1px solid #f0ad9e',background:'#fff0e9',color:'#8b3020',borderRadius:8,padding:12,fontSize:13,fontWeight:850} as const;
const panel={background:'white',border:'1px solid #d9e1e7',borderRadius:13,padding:15,display:'grid',gap:10} as const;
const heading={display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap' as const} as const;
const muted={fontSize:11,color:'#697a85'} as const;
const line={borderTop:'1px solid #e6eaee',padding:'10px 0',display:'grid',gap:5} as const;
const statusText={fontSize:10,fontWeight:900,color:'#265e50'} as const;
const field={display:'grid',gap:5,fontSize:12,fontWeight:800} as const;
const input={width:'100%',boxSizing:'border-box' as const,padding:'10px',background:'white',color:'#213548',border:'1px solid #bbc9d2',borderRadius:8,fontSize:13} as const;
const two={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:9} as const;
const chipLine={display:'flex',gap:10,flexWrap:'wrap' as const,fontSize:12} as const;
const searchBox={display:'grid',gap:8,padding:12,border:'1px solid #e3e8ee',borderRadius:9,background:'#f8fafb'} as const;
const secondary={width:'fit-content',padding:'8px 12px',borderRadius:8,border:'1px solid #b3c6ce',background:'#e9f2f5',color:'#173f37',fontWeight:900,cursor:'pointer',fontSize:11} as const;
const quiet={background:'white',border:'1px solid #d3dde5',borderRadius:7,padding:'7px 9px',fontSize:11,color:'#38586b',cursor:'pointer'} as const;
const submitButton={padding:'13px',background:'#176f4a',color:'#fff',border:0,borderRadius:9,fontWeight:950,cursor:'pointer'} as const;
