"use client";

import { useEffect, useMemo, useState } from "react";

type Job = {
  id:number; repairId:string; partId:number; partNumber:string; description:string;
  warehouseCode:string; warehouseName:string; unit:string; assignedTo:string; priority:string;
  outOfService:boolean; requestedQuantity:number; reservedQuantity:number; usedQuantity:number;
  remainingQuantity:number; shortageQuantity:number; state:string; createdAt:string;
};
type Stock = { physicalOnHand:number; reserved:number; available:number; onOrder:number; minimumQuantity:number };
type Group = {
  partId:number; partNumber:string; description:string; warehouseCode:string; warehouseName:string;
  requested:number; reserved:number; used:number; shortage:number; waitingJobs:Job[]; stock:Stock|null;
};
type LowStock = Stock & { partId:number; partNumber:string; description:string; warehouseCode:string; warehouseName:string; reorderSuggested:number };
type DeskData = {
  jobShortages:Group[]; requests:Job[]; lowStock:LowStock[];
  summary:{shortageLines:number;waitingJobs:number;readyJobs:number;lowStockLines:number}; updatedAt:string;
};

const n=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");

export default function PartsDeskPage(){
  const[data,setData]=useState<DeskData|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(""),[yard,setYard]=useState("ALL");
  const[orderQty,setOrderQty]=useState<Record<string,string>>({}),[receiveQty,setReceiveQty]=useState<Record<string,string>>({});

  async function load(){
    const r=await fetch('/api/parts-desk',{cache:'no-store'}),p=await r.json() as DeskData&{error?:string};
    if(!r.ok)throw new Error(p.error||'Parts Desk could not be loaded.');
    setData(p);
  }
  useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:'Parts Desk could not be loaded.'));const id=window.setInterval(()=>void load().catch(()=>undefined),15000);return()=>window.clearInterval(id)},[]);

  async function action(group:Pick<Group,'partId'|'warehouseCode'>,kind:'order'|'receive',quantity:number){
    if(!Number.isFinite(quantity)||quantity<=0){setMessage('Enter a positive quantity.');return}
    const key=`${kind}:${group.partId}:${group.warehouseCode}`;setBusy(key);setMessage('');
    try{
      const r=await fetch('/api/parts-desk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:kind,partId:group.partId,warehouseCode:group.warehouseCode,quantity})});
      const p=await r.json() as{ok?:boolean;error?:string;allocations?:unknown[]};
      if(!r.ok||!p.ok)throw new Error(p.error||'Parts action failed.');
      setMessage(kind==='receive'?'Parts received. Waiting jobs were allocated automatically.':'Quantity added to on-order stock.');
      setOrderQty(v=>({...v,[`${group.partId}:${group.warehouseCode}`]:''}));setReceiveQty(v=>({...v,[`${group.partId}:${group.warehouseCode}`]:''}));
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Parts action failed.')}finally{setBusy('')}
  }

  const groups=useMemo(()=>data?.jobShortages.filter(g=>yard==='ALL'||g.warehouseCode===yard)??[],[data,yard]);
  const lows=useMemo(()=>data?.lowStock.filter(g=>yard==='ALL'||g.warehouseCode===yard)??[],[data,yard]);
  const ready=useMemo(()=>data?.requests.filter(r=>(yard==='ALL'||r.warehouseCode===yard)&&r.reservedQuantity>0)??[],[data,yard]);

  return <main style={{minHeight:'100vh',background:'#f3f5f7',padding:'36px 34px 100px',color:'#182331'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'end',flexWrap:'wrap'}}>
      <div><p style={eyebrow}>PARTS OPERATIONS</p><h1 style={{margin:'6px 0 5px',fontSize:34,color:'#0d1b2b'}}>Parts Desk</h1><p style={{margin:0,color:'#667482'}}>One queue for repair shortages, receiving, reservations, and yard-level replenishment.</p></div>
      <div style={{display:'flex',gap:7}}>{['ALL','CLARE','CADILLAC'].map(code=><button key={code} onClick={()=>setYard(code)} style={yard===code?activeTab:tab}>{code==='ALL'?'All Yards':code[0]+code.slice(1).toLowerCase()}</button>)}</div>
    </header>
    {message&&<div style={notice}>{message}</div>}

    <section style={metrics}>{[
      ['JOB SHORTAGES',data?.summary.shortageLines??0],['WAITING JOBS',data?.summary.waitingJobs??0],['READY / RESERVED',data?.summary.readyJobs??0],['LOW STOCK',data?.summary.lowStockLines??0]
    ].map(([label,value])=><article key={String(label)} style={metric}><span>{label}</span><strong>{value}</strong></article>)}</section>

    <section style={panel}><div style={panelHead}><div><p style={eyebrow}>REORDER QUEUE</p><h2 style={title}>Waiting on parts</h2></div><span style={muted}>{groups.length} part / yard line{groups.length===1?'':'s'}</span></div>
      {!groups.length?<div style={empty}>No repair shortages in this yard.</div>:groups.map(group=>{
        const key=`${group.partId}:${group.warehouseCode}`,stock=group.stock;
        const suggested=group.shortage;
        return <article key={key} style={queueCard}>
          <div style={{display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}><div><strong style={{fontSize:18}}>{group.partNumber}</strong><div style={muted}>{group.description} · {group.warehouseName}</div></div><span style={warningPill}>{n(group.shortage)} awaiting</span></div>
          <div style={stockGrid}>{[['ON HAND',stock?.physicalOnHand??0],['RESERVED',stock?.reserved??0],['AVAILABLE',stock?.available??0],['ON ORDER',stock?.onOrder??0]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{n(Number(value))}</strong></div>)}</div>
          <details style={{marginTop:12}}><summary style={{cursor:'pointer',fontWeight:900,color:'#33485b'}}>{group.waitingJobs.length} waiting job{group.waitingJobs.length===1?'':'s'} — priority is OOS/Critical, then oldest</summary><div style={{display:'grid',gap:7,marginTop:8}}>{group.waitingJobs.map(job=><div key={job.id} style={jobRow}><b>Unit {job.unit||'—'}</b><span>{job.outOfService?'OOS · ':''}{job.priority==='1'?'Critical · ':''}{job.assignedTo||'Unassigned'}</span><span>{n(job.reservedQuantity)} reserved · {n(job.shortageQuantity)} awaiting</span></div>)}</div></details>
          <div style={actions}><input type="number" min="0.01" step="any" placeholder={n(suggested)} value={orderQty[key]??''} onChange={e=>setOrderQty(v=>({...v,[key]:e.target.value}))} style={input}/><button disabled={Boolean(busy)} onClick={()=>void action(group,'order',Number(orderQty[key]||suggested))} style={darkButton}>{busy===`order:${key}`?'Saving…':'Order shortage'}</button><input type="number" min="0.01" step="any" placeholder="Received qty" value={receiveQty[key]??''} onChange={e=>setReceiveQty(v=>({...v,[key]:e.target.value}))} style={input}/><button disabled={Boolean(busy)} onClick={()=>void action(group,'receive',Number(receiveQty[key]))} style={orangeButton}>{busy===`receive:${key}`?'Receiving…':'Receive'}</button></div>
        </article>
      })}
    </section>

    <section style={panel}><div style={panelHead}><div><p style={eyebrow}>TECH HANDOFF</p><h2 style={title}>Reserved / ready for jobs</h2></div><span style={muted}>{ready.length} active line{ready.length===1?'':'s'}</span></div>{!ready.length?<div style={empty}>Nothing is currently reserved for a repair.</div>:<div style={{display:'grid',gap:8}}>{ready.map(job=><div key={job.id} style={jobRow}><b>{job.partNumber} · Unit {job.unit||'—'}</b><span>{job.warehouseName} · {job.assignedTo||'Unassigned'}</span><span>{n(job.reservedQuantity)} ready{job.shortageQuantity>0?` · ${n(job.shortageQuantity)} still awaiting`:''}</span></div>)}</div>}</section>

    <section style={panel}><div style={panelHead}><div><p style={eyebrow}>MINIMUMS</p><h2 style={title}>Low-stock replenishment</h2></div><span style={muted}>Uses each warehouse's configured minimum</span></div>{!lows.length?<div style={empty}>No stock is at or below its minimum in this yard.</div>:<div style={{display:'grid',gap:8}}>{lows.slice(0,80).map(item=>{const key=`${item.partId}:${item.warehouseCode}`;return <div key={key} style={lowRow}><div><b>{item.partNumber}</b><span>{item.description} · {item.warehouseName}</span></div><div><span>Available</span><b>{n(item.available)}</b></div><div><span>Minimum</span><b>{n(item.minimumQuantity)}</b></div><div><span>On order</span><b>{n(item.onOrder)}</b></div><button disabled={item.reorderSuggested<=0||Boolean(busy)} onClick={()=>void action(item,'order',item.reorderSuggested)} style={darkButton}>{item.reorderSuggested>0?`Order ${n(item.reorderSuggested)}`:'Covered'}</button></div>})}</div>}</section>
  </main>
}

const eyebrow={margin:0,color:'#f47b20',fontSize:11,fontWeight:950,letterSpacing:'.14em'} as const;
const title={margin:'5px 0 0',fontSize:22,color:'#0d1b2b'} as const;
const muted={color:'#667482',fontSize:12} as const;
const tab={border:'1px solid #cbd3da',borderRadius:999,padding:'9px 13px',background:'white',color:'#263746',fontWeight:900,cursor:'pointer'} as const;
const activeTab={...tab,background:'#0d1b2b',borderColor:'#0d1b2b',color:'white'} as const;
const notice={marginTop:16,padding:12,border:'1px solid #efc16c',borderRadius:9,background:'#fff8e6'} as const;
const metrics={marginTop:18,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10} as const;
const metric={padding:16,border:'1px solid #dde4e9',borderRadius:11,background:'white'} as const;
const panel={marginTop:16,padding:18,border:'1px solid #dce2e7',borderRadius:13,background:'white'} as const;
const panelHead={display:'flex',justifyContent:'space-between',gap:12,alignItems:'end',flexWrap:'wrap',marginBottom:12} as const;
const queueCard={padding:15,border:'1px solid #e0e5e9',borderRadius:11,background:'#fbfcfd',marginTop:10} as const;
const warningPill={display:'inline-flex',alignItems:'center',padding:'6px 10px',borderRadius:999,background:'#fff0d7',color:'#9a5a05',fontWeight:950,fontSize:12} as const;
const stockGrid={display:'grid',gridTemplateColumns:'repeat(4,minmax(90px,1fr))',gap:8,marginTop:12} as const;
const jobRow={display:'grid',gridTemplateColumns:'minmax(150px,1fr) minmax(130px,1fr) auto',gap:10,alignItems:'center',padding:'9px 10px',border:'1px solid #e5e9ed',borderRadius:8,background:'white',fontSize:12} as const;
const actions={display:'grid',gridTemplateColumns:'100px auto 110px auto',gap:7,marginTop:12,alignItems:'center'} as const;
const input={width:'100%',boxSizing:'border-box',padding:'9px 10px',border:'1px solid #ccd5dd',borderRadius:8} as const;
const darkButton={border:0,borderRadius:8,padding:'9px 11px',background:'#0d1b2b',color:'white',fontWeight:900,cursor:'pointer'} as const;
const orangeButton={...darkButton,background:'#f47b20'} as const;
const lowRow={display:'grid',gridTemplateColumns:'minmax(230px,1.5fr) repeat(3,minmax(75px,.5fr)) auto',gap:10,alignItems:'center',padding:'10px 11px',border:'1px solid #e5e9ed',borderRadius:9,background:'#fbfcfd',fontSize:12} as const;
const empty={padding:20,textAlign:'center',color:'#71808e',border:'1px dashed #d2d9df',borderRadius:9} as const;
