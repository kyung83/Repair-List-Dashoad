"use client";

import {useEffect,useMemo,useState} from 'react';

type Review={
  id:number;requester_user_id:number;request_type:'correction'|'missed';technician_id:number;technicianName:string;requestedBy:string;status:string;
  unit_snapshot:string;repair_snapshot:string;source_labor_entry_id:number|null;source_repair_id:number|null;proposed_repair_id:number|null;
  original_hours:number|null;requested_hours:number;currentHours:number|null;labor_date:string;started_local:string;ended_local:string;
  details:string;manager_note:string;sourceUnit:string;sourceTitle:string;targetUnit:string;targetTitle:string;created_at:string;updated_at:string;
};
type Repair={repairId:number;unit:string;title:string;status:string};
type Payload={ok?:boolean;error?:string;requests?:Review[];repairs?:Repair[];currentUserId?:number};
function time(value:string){const date=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');return Number.isFinite(date.getTime())?date.toLocaleString():value}
function hours(v:number|null|undefined){return Number(v||0).toFixed(2)+' hr'}

export default function LaborReviewPage(){
  const[items,setItems]=useState<Review[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(0);
  const[filter,setFilter]=useState<'pending'|'history'>('pending');
  const[notes,setNotes]=useState<Record<number,string>>({});
  const[targets,setTargets]=useState<Record<number,string>>({});
  const[searches,setSearches]=useState<Record<number,string>>({});
  const[found,setFound]=useState<Record<number,Repair[]>>({});
  const[ack,setAck]=useState<Record<number,boolean>>({});
  const[loading,setLoading]=useState(true);
  const[reviewerId,setReviewerId]=useState<number|null>(null);

  async function reload(){
    const response=await fetch('/api/shop/labor-review',{cache:'no-store'});
    const result=await response.json() as Payload;
    if(!response.ok||!result.ok)throw new Error(result.error||'Unable to load the labor review queue.');
    setItems(result.requests||[]);
    setReviewerId(result.currentUserId??null);
  }
  useEffect(()=>{let alive=true;fetch('/api/shop/labor-review',{cache:'no-store'}).then(async response=>{const result=await response.json() as Payload;if(!response.ok||!result.ok)throw new Error(result.error||'Unable to load labor queue.');if(alive){setItems(result.requests||[]);setReviewerId(result.currentUserId??null)}}).catch(e=>{if(alive)setError(String(e.message||e))}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[]);
  const pending=useMemo(()=>items.filter(x=>x.status==='pending'),[items]);
  const visible=useMemo(()=>filter==='pending'?items.filter(x=>x.status==='pending'||x.status==='needs_info'||x.status==='processing'):items.filter(x=>x.status==='approved'||x.status==='rejected'),[items,filter]);

  async function searchRepair(id:number){
    const q=(searches[id]||'').trim();if(q.length<2){setError('Search using two or more characters of a unit or repair.');return}
    setBusy(id);setError('');
    try{
      const response=await fetch('/api/shop/labor-review?q='+encodeURIComponent(q),{cache:'no-store'});
      const result=await response.json() as Payload;
      if(!response.ok||!result.ok)throw new Error(result.error||'Repair lookup failed.');
      setFound(prev=>({...prev,[id]:result.repairs||[]}));
    }catch(e){setError(e instanceof Error?e.message:'Search failed.')}finally{setBusy(0)}
  }
  async function decide(item:Review,action:'approve'|'reject'|'needs_info'){
    if(item.requester_user_id===reviewerId){setError('Another manager must review your own labor request.');return}
    const note=(notes[item.id]||'').trim();
    if(action!=='approve'&&note.length<5){setError('Enter a manager explanation to reject or request clarification.');return}
    if(action==='approve'&&item.request_type==='missed'&&!ack[item.id]){setError('Confirm that missed-work approval posts labor only. Verify parts and inspections separately.');return}
    const targetRaw=targets[item.id]??(item.proposed_repair_id?String(item.proposed_repair_id):'');
    if(action==='approve'&&item.request_type==='missed'&&!targetRaw){setError('Choose the existing repair that will receive this missed labor.');return}
    if(action==='approve'&&!window.confirm('Approve request #'+item.id+'? This will post its approved labor hours to the selected work order. Original request and decision remain in the audit ledger.'))return;
    setBusy(item.id);setError('');
    try{
      const response=await fetch('/api/shop/labor-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,requestId:item.id,managerNote:note,repairId:targetRaw?Number(targetRaw):undefined,acknowledgeOtherWork:Boolean(ack[item.id])})});
      const result=await response.json() as Payload;
      if(!response.ok||!result.ok)throw new Error(result.error||'Unable to save manager decision.');
      await reload();
    }catch(e){setError(e instanceof Error?e.message:'Unable to review request.')}finally{setBusy(0)}
  }
  return <main style={page}>
    <header style={hero}>
      <div><span style={eyebrow}>MANAGEMENT · WORK ORDER REVIEW</span><h1 style={{margin:'5px 0',fontSize:28}}>Labor Corrections & Missed Work</h1><p style={{margin:0,fontSize:12,color:'#d7e5df'}}>Review technicians' requests before changing recorded labor. No changes to repairs, inventory or inspections on submission.</p></div>
      <a href="/work-orders" style={back}>Work Order Review</a>
    </header>
    {error&&<div role="alert" style={errorBox}>{error}</div>}
    <nav aria-label="Labor review filters" style={nav}>
      <button type="button" onClick={()=>setFilter('pending')} style={filter==='pending'?active:tab}>Needs Review ({pending.length})</button>
      <button type="button" onClick={()=>setFilter('history')} style={filter==='history'?active:tab}>Decisions</button>
      <button type="button" onClick={()=>void reload().catch(e=>setError(String(e.message||e)))} style={tab}>Refresh</button>
    </nav>
    {loading&&<div style={card}>Loading labor requests…</div>}
    {!loading&&visible.length===0&&<div style={card}>{filter==='pending'?'No labor corrections need manager review.':'No reviewed labor requests yet.'}</div>}
    {visible.map(item=><article key={item.id} style={card}>
      <div style={heading}>
        <div><span style={eyebrowDark}>REQUEST #{item.id} · {item.request_type==='missed'?'MISSED WORK':'TIMER CORRECTION'}</span><h2 style={{margin:'4px 0 2px',fontSize:19}}>{item.technicianName} — {item.unit_snapshot||item.sourceUnit||'SHOP'}</h2><div style={muted}>{item.repair_snapshot||item.sourceTitle} · Work date {item.labor_date} · Submitted {time(item.created_at)}</div></div>
        <span style={state}>{item.status==='needs_info'?'Needs technician reply':item.status==='processing'?'Applying…':item.status.toUpperCase()}</span>
      </div>
      <div style={two}>
        <div style={metric}><span style={muted}>{item.request_type==='correction'?'Original saved labor':'Reported missed labor'}</span><strong>{hours(item.request_type==='correction'?item.original_hours:item.requested_hours)}</strong>{item.request_type==='correction'&&<span style={muted}>Entry #{item.source_labor_entry_id} · Current: {hours(item.currentHours)}</span>}</div>
        {item.request_type==='correction'&&<div style={metric}><span style={muted}>Requested corrected hours</span><strong>{hours(item.requested_hours)}</strong><span style={muted}>{Number(item.original_hours)>item.requested_hours?'Difference: '+hours(Number(item.original_hours)-item.requested_hours)+' removed or transferred':'Additional: '+hours(item.requested_hours-Number(item.original_hours))}</span></div>}
      </div>
      <div style={{whiteSpace:'pre-wrap',fontSize:13}}><strong>Technician explanation:</strong> {item.details}</div>
      {item.started_local&&item.ended_local&&<div style={muted}>Reported work time: {item.started_local}–{item.ended_local} (not a certified timer segment)</div>}
      {item.source_repair_id&&<div style={muted}>Source work order: #{item.source_repair_id} · {item.sourceUnit||'SHOP'} · {item.sourceTitle}</div>}
      {item.proposed_repair_id&&<div style={muted}>Requested destination: #{item.proposed_repair_id} · {item.targetUnit||'SHOP'} · {item.targetTitle}</div>}
      {item.manager_note&&item.status!=='pending'&&<div style={reviewed}>Manager note: {item.manager_note}</div>}
      {item.status==='pending'&&item.requester_user_id===reviewerId&&<div style={reviewed}>You submitted this labor request. Another manager must approve, reject, or request clarification.</div>}
      {item.status==='pending'&&item.requester_user_id!==reviewerId&&<div style={controls}>
        <label style={label}>Manager note (required for rejection or clarification)<textarea value={notes[item.id]||''} onChange={e=>setNotes(prev=>({...prev,[item.id]:e.target.value}))} rows={2} maxLength={1000} placeholder="Reason, evidence, or clarification needed" style={{...input,resize:'vertical'}}/></label>
        {(item.request_type==='missed'||Number(item.original_hours)>item.requested_hours)&&<div style={finder}>
          <strong style={{fontSize:12}}>{item.request_type==='missed'?'Required: select existing work order for missed labor':'Optional: choose destination for transferred hours'}</strong>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <input aria-label={'Search destination for request '+item.id} value={searches[item.id]||''} onChange={e=>setSearches(prev=>({...prev,[item.id]:e.target.value}))} placeholder="Search unit or repair" style={{...input,flex:1,minWidth:165}}/>
            <button type="button" style={secondary} disabled={busy!==0} onClick={()=>void searchRepair(item.id)}>Search</button>
          </div>
          <select aria-label={'Destination repair for request '+item.id} value={targets[item.id]??(item.proposed_repair_id?String(item.proposed_repair_id):'')} onChange={e=>setTargets(prev=>({...prev,[item.id]:e.target.value}))} style={input}>
            <option value="">No destination selected</option>
            {item.proposed_repair_id&&<option value={item.proposed_repair_id}>#{item.proposed_repair_id} · {item.targetUnit||'SHOP'} · {item.targetTitle}</option>}
            {(found[item.id]||[]).filter(r=>r.repairId!==item.source_repair_id&&r.repairId!==item.proposed_repair_id).map(r=><option key={r.repairId} value={r.repairId}>#{r.repairId} · {r.unit||'SHOP'} · {r.title} ({r.status})</option>)}
          </select>
        </div>}
        {item.request_type==='missed'&&<label style={checkLine}><input type="checkbox" checked={Boolean(ack[item.id])} onChange={e=>setAck(prev=>({...prev,[item.id]:e.target.checked}))}/>I understand this approval posts labor only. Parts, DVIR, and PM/Annual inspection evidence must be verified using their existing workflows.</label>}
        <div style={buttons}>
          <button type="button" disabled={busy!==0} style={approveButton} onClick={()=>void decide(item,'approve')}>APPROVE LABOR</button>
          <button type="button" disabled={busy!==0} style={secondary} onClick={()=>void decide(item,'needs_info')}>ASK FOR DETAILS</button>
          <button type="button" disabled={busy!==0} style={rejectButton} onClick={()=>void decide(item,'reject')}>REJECT</button>
        </div>
      </div>}
      {item.status==='processing'&&<div style={reviewed}>This request is being applied. If it remains here, verify its audit record before retrying; do not create duplicate labor.</div>}
    </article>)}
  </main>;
}
const page={maxWidth:1060,margin:'0 auto',padding:'18px 14px 90px',display:'grid',gap:13,color:'#173f37'} as const;
const hero={display:'flex',alignItems:'center',justifyContent:'space-between',gap:18,flexWrap:'wrap' as const,padding:19,borderRadius:13,background:'#173f37',color:'white'} as const;
const eyebrow={fontSize:10,color:'#b9dace',fontWeight:950,letterSpacing:'.09em'} as const;
const eyebrowDark={fontSize:10,color:'#557d72',fontWeight:950,letterSpacing:'.09em'} as const;
const back={padding:'10px 12px',border:'1px solid #b9dace',borderRadius:9,color:'white',textDecoration:'none',fontWeight:850,fontSize:12} as const;
const nav={display:'flex',gap:8,flexWrap:'wrap' as const} as const;
const tab={padding:'10px 13px',border:'1px solid #ccd6da',background:'white',color:'#173f37',borderRadius:9,fontWeight:900,cursor:'pointer'} as const;
const active={...tab,background:'#173f37',color:'white',borderColor:'#173f37'} as const;
const card={padding:16,borderRadius:12,background:'white',border:'1px solid #d8e2e7',display:'grid',gap:12} as const;
const heading={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap' as const} as const;
const muted={fontSize:11,color:'#687986'} as const;
const state={padding:'6px 8px',background:'#edf4f0',borderRadius:999,fontSize:10,fontWeight:900,color:'#276b52'} as const;
const two={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10} as const;
const metric={display:'grid',gap:6,padding:12,border:'1px solid #e0e7ec',borderRadius:9,background:'#f7fafb'} as const;
const reviewed={padding:11,background:'#fff7e5',border:'1px solid #eed9a8',borderRadius:9,fontSize:12} as const;
const controls={display:'grid',gap:10,borderTop:'1px solid #e2e9ef',paddingTop:12} as const;
const label={display:'grid',gap:5,fontSize:12,fontWeight:850} as const;
const input={width:'100%',boxSizing:'border-box' as const,padding:10,border:'1px solid #bbc8d1',borderRadius:8,background:'white',color:'#173f37'} as const;
const finder={padding:12,border:'1px solid #dee6ea',borderRadius:9,display:'grid',gap:7} as const;
const checkLine={display:'flex',alignItems:'center',gap:8,fontSize:12,fontWeight:850,color:'#76500e'} as const;
const buttons={display:'flex',gap:8,flexWrap:'wrap' as const} as const;
const approveButton={padding:'11px 14px',border:0,borderRadius:9,color:'white',background:'#176d47',fontWeight:950,cursor:'pointer'} as const;
const secondary={padding:'10px 12px',border:'1px solid #bbccd6',background:'#eaf1f5',borderRadius:9,color:'#29485b',fontWeight:900,cursor:'pointer'} as const;
const rejectButton={...secondary,borderColor:'#f0c7bb',background:'#fff0ee',color:'#9f302c'} as const;
const errorBox={padding:12,background:'#fff0ec',border:'1px solid #eeaea0',borderRadius:9,color:'#873126',fontWeight:850} as const;
