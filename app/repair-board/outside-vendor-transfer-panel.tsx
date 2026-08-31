'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

type Repair={id:string;unit:string;issue:string;status:string;source:string;equipmentId:number|null};
type Vendor={id:number;name:string;phone:string};
type BoardPayload={canManage?:boolean;repairs?:Repair[];error?:string};
type OutsidePayload={vendors?:Vendor[];assignments?:unknown[];error?:string;ok?:boolean;message?:string};

export default function OutsideVendorTransferPanel(){
  const[canManage,setCanManage]=useState(false);
  const[repairs,setRepairs]=useState<Repair[]>([]);
  const[vendors,setVendors]=useState<Vendor[]>([]);
  const[open,setOpen]=useState(false);
  const[repairId,setRepairId]=useState('');
  const[vendorId,setVendorId]=useState('');
  const[notes,setNotes]=useState('');
  const[message,setMessage]=useState('');
  const[busy,setBusy]=useState(false);

  async function load(){
    const[boardResponse,outsideResponse]=await Promise.all([
      fetch('/api/repair-board',{cache:'no-store'}),
      fetch('/api/outside-repairs',{cache:'no-store'}),
    ]);
    const board=await boardResponse.json() as BoardPayload;
    if(boardResponse.status===401)return;
    if(!boardResponse.ok)throw new Error(board.error||'Repair Board could not be loaded.');
    setCanManage(Boolean(board.canManage));
    setRepairs((board.repairs||[]).filter(row=>row.id.startsWith('repair-')));
    if(outsideResponse.ok){const outside=await outsideResponse.json() as OutsidePayload;setVendors(outside.vendors||[]);}
  }

  useEffect(()=>{void load().catch(()=>{});},[]);
  const selected=useMemo(()=>repairs.find(row=>row.id===repairId)||null,[repairs,repairId]);
  if(!canManage)return null;

  async function submit(){
    if(!repairId)return setMessage('Choose the repair that is going outside.');
    if(!vendorId)return setMessage('Choose the outside vendor.');
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/outside-repairs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',repairId,vendorId:Number(vendorId),notes})});
      const result=await response.json() as OutsidePayload;
      if(!response.ok||!result.ok)throw new Error(result.error||'Repair could not be moved to Outside Repairs.');
      setMessage(result.message||'Repair moved to Outside Repairs.');
      setRepairId('');setVendorId('');setNotes('');setOpen(false);
      await load();
      window.dispatchEvent(new Event('focus'));
      window.location.reload();
    }catch(error){setMessage(error instanceof Error?error.message:'Repair could not be moved to Outside Repairs.');}
    finally{setBusy(false);}
  }

  return <section style={shell}>
    <div style={topRow}>
      <div><div style={eyebrow}>OUTSIDE REPAIR HANDOFF</div><strong style={{fontSize:17}}>Send a Repair Board job to an outside vendor</strong><div style={copy}>The same repair moves off this board and stays in Outside Repairs until the vendor is finished and the invoice is attached.</div></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><a href="/outside-work" style={secondary}>Open Outside Repairs</a><button type="button" style={primary} onClick={()=>setOpen(value=>!value)}>{open?'Cancel':'Assign Outside Vendor'}</button></div>
    </div>
    {message&&<div style={notice}>{message}</div>}
    {open&&<div style={formGrid}>
      <label style={label}>Repair
        <select value={repairId} onChange={event=>setRepairId(event.target.value)} style={input}>
          <option value="">Choose repair</option>
          {repairs.map(row=><option key={row.id} value={row.id}>{row.unit} — {row.issue||row.status}</option>)}
        </select>
      </label>
      <label style={label}>Outside vendor
        <select value={vendorId} onChange={event=>setVendorId(event.target.value)} style={input}>
          <option value="">Choose vendor</option>
          {vendors.map(row=><option key={row.id} value={row.id}>{row.name}{row.phone?` — ${row.phone}`:''}</option>)}
        </select>
      </label>
      <label style={{...label,gridColumn:'1/-1'}}>Optional note / what you texted the vendor
        <textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={1000} style={{...input,minHeight:78}} placeholder="Example: Unit 547 — air leak at rear suspension. Please text when fixed." />
      </label>
      {selected&&<div style={selectedBox}><strong>{selected.unit}</strong><span>{selected.issue}</span><span>Current status: {selected.status}</span></div>}
      <button type="button" disabled={busy} onClick={()=>void submit()} style={{...primary,opacity:busy?.6:1}}>{busy?'Moving…':'Move to Outside Repairs'}</button>
    </div>}
  </section>;
}

const shell:CSSProperties={margin:'14px clamp(16px,4vw,46px) 0',padding:16,border:'1px solid #cfd8e3',borderRadius:12,background:'#f8fbfd',color:'#172536'};
const topRow:CSSProperties={display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'};
const eyebrow:CSSProperties={fontSize:11,fontWeight:950,letterSpacing:'.11em',color:'#50677a',marginBottom:4};
const copy:CSSProperties={fontSize:13,color:'#607080',marginTop:5,maxWidth:760,lineHeight:1.45};
const primary:CSSProperties={minHeight:42,border:0,borderRadius:8,padding:'9px 13px',background:'#10243a',color:'#fff',fontWeight:900,cursor:'pointer'};
const secondary:CSSProperties={minHeight:40,display:'inline-flex',alignItems:'center',padding:'0 12px',border:'1px solid #b7c5d1',borderRadius:8,background:'#fff',color:'#17324a',textDecoration:'none',fontWeight:850,fontSize:13};
const notice:CSSProperties={marginTop:10,padding:'9px 11px',border:'1px solid #d7c27b',borderRadius:8,background:'#fffdf2',fontSize:13};
const formGrid:CSSProperties={marginTop:14,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:11,alignItems:'end'};
const label:CSSProperties={display:'grid',gap:5,fontSize:12,fontWeight:850};
const input:CSSProperties={width:'100%',boxSizing:'border-box',minHeight:42,border:'1px solid #b9c7d2',borderRadius:8,padding:'8px 10px',background:'#fff',font: 'inherit'};
const selectedBox:CSSProperties={display:'grid',gap:3,padding:10,border:'1px solid #d9e2e9',borderRadius:8,background:'#fff',fontSize:12};
