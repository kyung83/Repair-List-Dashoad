"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";

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
type UnmatchedPart = {
  id:number;repairId:string;requestedText:string;requestedQuantity:number;warehouseCode:string;
  unit:string;assignedTo:string;priority:string;outOfService:boolean;createdAt:string;updatedAt:string;
};
type OneTimePart = {
  id:number;partNumber:string;description:string;unitCost:number|null;preferredVendorId:number|null;vendorName:string;
  warehouseId:number;warehouseCode:string;warehouseName:string;quantityAvailable:number;reference:string;lastReceivedAt:string;
};
type Warehouse={id:number;code:string;name:string};
type Vendor={id:number;name:string};
type DeskData = {
  jobShortages:Group[]; requests:Job[]; lowStock:LowStock[]; unmatchedPartRequests?:UnmatchedPart[]; oneTimeParts?:OneTimePart[];
  warehouses?:Warehouse[];vendors?:Vendor[];
  summary:{shortageLines:number;waitingJobs:number;readyJobs:number;lowStockLines:number;unmatchedParts?:number;oneTimeParts?:number}; updatedAt:string;
};
type OneTimeForm={partNumber:string;description:string;warehouseCode:string;quantity:string;unitCost:string;vendorId:string;reference:string;notes:string;sourceRequestId:number|null};

const blankOneTime:OneTimeForm={partNumber:"",description:"",warehouseCode:"",quantity:"1",unitCost:"",vendorId:"",reference:"",notes:"",sourceRequestId:null};
const n=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
const money=(value:number|null)=>value==null?"—":value.toLocaleString(undefined,{style:"currency",currency:"USD"});

export default function PartsDeskPage(){
  const[data,setData]=useState<DeskData|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(""),[yard,setYard]=useState("ALL");
  const[orderQty,setOrderQty]=useState<Record<string,string>>({}),[receiveQty,setReceiveQty]=useState<Record<string,string>>({});
  const[showOneTime,setShowOneTime]=useState(false),[oneTime,setOneTime]=useState<OneTimeForm>(blankOneTime);

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
      const p=await r.json() as{ok?:boolean;error?:string};
      if(!r.ok||!p.ok)throw new Error(p.error||'Parts action failed.');
      setMessage(kind==='receive'?'Parts received. Waiting jobs were allocated automatically.':'Quantity added to on-order stock.');
      setOrderQty(v=>({...v,[`${group.partId}:${group.warehouseCode}`]:''}));setReceiveQty(v=>({...v,[`${group.partId}:${group.warehouseCode}`]:''}));
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Parts action failed.')}finally{setBusy('')}
  }

  async function markUnmatchedHandled(requestId:number){
    const key=`unmatched:${requestId}`;setBusy(key);setMessage('');
    try{
      const r=await fetch('/api/parts-desk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'handleUnmatched',requestId})});
      const p=await r.json() as{ok?:boolean;error?:string};
      if(!r.ok||!p.ok)throw new Error(p.error||'Unmatched request could not be updated.');
      setMessage('Unmatched part request marked handled.');await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Unmatched request could not be updated.')}finally{setBusy('')}
  }

  async function createOneTime(event:FormEvent){
    event.preventDefault();
    const quantity=Number(oneTime.quantity),unitCost=oneTime.unitCost===""?null:Number(oneTime.unitCost);
    if(!oneTime.description.trim()||!oneTime.warehouseCode||!Number.isFinite(quantity)||quantity<=0){setMessage("Description, warehouse, and positive quantity are required.");return}
    setBusy("one-time-create");setMessage("");
    try{
      const r=await fetch('/api/parts-desk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        action:'createOneTimePart',...oneTime,quantity,unitCost,vendorId:oneTime.vendorId?Number(oneTime.vendorId):null,sourceRequestId:oneTime.sourceRequestId
      })});
      const p=await r.json() as{ok?:boolean;error?:string;partNumber?:string;warehouseName?:string;quantity?:number};
      if(!r.ok||!p.ok)throw new Error(p.error||'One-time part could not be created.');
      setMessage(`${p.partNumber||"One-time part"} created with ${n(Number(p.quantity||quantity))} available at ${p.warehouseName||oneTime.warehouseCode}. Techs can now find it in normal Part Lookup.`);
      setShowOneTime(false);setOneTime(blankOneTime);await load();
    }catch(e){setMessage(e instanceof Error?e.message:'One-time part could not be created.')}finally{setBusy("")}
  }

  async function convertOneTime(item:OneTimePart){
    if(!window.confirm(`Convert ${item.partNumber} — ${item.description} to a stocked inventory item?\n\nIts existing repair history stays marked as one-time. The remaining quantity becomes normal inventory.`))return;
    const key=`convert:${item.id}`;setBusy(key);setMessage("");
    try{
      const r=await fetch('/api/parts-desk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'convertOneTimePart',partId:item.id})});
      const p=await r.json() as{ok?:boolean;error?:string};
      if(!r.ok||!p.ok)throw new Error(p.error||"Part could not be converted.");
      setMessage(`${item.partNumber} is now a stocked inventory item. Open Inventory to set bins and minimums.`);await load();
    }catch(e){setMessage(e instanceof Error?e.message:"Part could not be converted.")}finally{setBusy("")}
  }

  const groups=useMemo(()=>data?.jobShortages.filter(g=>yard==='ALL'||g.warehouseCode===yard)??[],[data,yard]);
  const lows=useMemo(()=>data?.lowStock.filter(g=>yard==='ALL'||g.warehouseCode===yard)??[],[data,yard]);
  const ready=useMemo(()=>data?.requests.filter(r=>(yard==='ALL'||r.warehouseCode===yard)&&r.reservedQuantity>0)??[],[data,yard]);
  const unmatched=useMemo(()=>(data?.unmatchedPartRequests??[]).filter(r=>yard==='ALL'||r.warehouseCode===yard),[data,yard]);
  const oneTimes=useMemo(()=>(data?.oneTimeParts??[]).filter(r=>yard==='ALL'||r.warehouseCode===yard),[data,yard]);

  return <main style={{minHeight:'100vh',background:'#f4f6f4',padding:'36px 34px 100px',color:'#1b2421'}}>
    <ModuleTabs module="parts" />
    <header style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'end',flexWrap:'wrap'}}>
      <div><p style={eyebrow}>PARTS OPERATIONS</p><h1 style={{margin:'6px 0 5px',fontSize:34,color:'#173f37'}}>Parts Desk</h1><p style={{margin:0,color:'#68746f'}}>Decide what gets stocked. Techs only search for a part and apply it to the repair.</p></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <a href="/inventory?new=1" style={secondaryButton}>+ New Inventory Item</a>
      </div>
    </header>
    <div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:16}}><button onClick={()=>setYard('ALL')} style={yard==='ALL'?activeTab:tab}>All Warehouses</button>{(data?.warehouses??[]).map(warehouse=><button key={warehouse.code} onClick={()=>setYard(warehouse.code)} style={yard===warehouse.code?activeTab:tab}>{warehouse.name}</button>)}</div>
    {message&&<div style={notice}>{message}</div>}

    <section style={metrics}>{[
      ['ONE-TIME READY',oneTimes.length],['UNMATCHED PARTS',data?.summary.unmatchedParts??0],['JOB SHORTAGES',data?.summary.shortageLines??0],['READY / RESERVED',data?.summary.readyJobs??0],['LOW STOCK',data?.summary.lowStockLines??0]
    ].map(([label,value])=><article key={String(label)} style={metric}><span>{label}</span><strong>{value}</strong></article>)}</section>

    <section style={{...panel,border:'2px solid #173f37'}}><div style={panelHead}><div><p style={eyebrow}>NON-STOCK / ONE-TIME</p><h2 style={title}>Purchased for a repair — not regular inventory</h2><p style={muted}>These appear in the technician&apos;s normal Part Lookup until the purchased quantity is used.</p></div><span style={muted}>{oneTimes.length} available line{oneTimes.length===1?'':'s'}</span></div>
      {!oneTimes.length?<div style={empty}>No one-time parts are waiting to be used in this warehouse.</div>:<div style={{display:'grid',gap:8}}>{oneTimes.map(item=><article key={`${item.id}:${item.warehouseCode}`} style={oneTimeRow}>
        <div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><strong style={{fontSize:17}}>{item.partNumber}</strong><span style={oneTimePill}>ONE-TIME</span></div><span style={muted}>{item.description} · {item.vendorName||'Vendor not set'}{item.reference?` · Ref ${item.reference}`:''}</span></div>
        <div><span style={smallLabel}>WAREHOUSE</span><strong>{item.warehouseName}</strong></div>
        <div><span style={smallLabel}>AVAILABLE</span><strong>{n(item.quantityAvailable)}</strong></div>
        <div><span style={smallLabel}>COST</span><strong>{money(item.unitCost)}</strong></div>
        <button disabled={Boolean(busy)} onClick={()=>void convertOneTime(item)} style={secondaryAction}>{busy===`convert:${item.id}`?'Converting…':'Convert to Inventory'}</button>
      </article>)}</div>}
    </section>

    <section style={panel}><div style={panelHead}><div><p style={eyebrow}>NEEDS IDENTIFICATION</p><h2 style={title}>Technician requested parts not in the catalog</h2><p style={muted}>Use One-Time Part when this is a one-off purchase. Use New Inventory Item when it should become stocked.</p></div><span style={muted}>{unmatched.length} open request{unmatched.length===1?'':'s'}</span></div>
      {!unmatched.length?<div style={empty}>No unmatched technician part requests in this warehouse.</div>:<div style={{display:'grid',gap:9}}>{unmatched.map(item=><article key={item.id} style={unmatchedCard}>
        <div style={{minWidth:0}}><strong style={{fontSize:18,color:'#173f37'}}>{item.requestedText}</strong><div style={muted}>Unit {item.unit||'—'} · {item.assignedTo||'Unassigned'} · {item.warehouseCode||'Unknown yard'}</div></div>
        <div style={{textAlign:'center'}}><span style={smallLabel}>QTY</span><strong style={{display:'block',fontSize:22}}>{n(item.requestedQuantity)}</strong></div>
        <div style={{fontSize:12,fontWeight:900,color:item.outOfService?'#a64712':'#52616d'}}>{item.outOfService?'OOS · ':''}{item.priority==='1'?'CRITICAL':item.priority==='3'?'LOW':'NORMAL'}</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
          <button disabled={Boolean(busy)} onClick={()=>{setOneTime({...blankOneTime,description:item.requestedText,warehouseCode:item.warehouseCode||'',quantity:String(item.requestedQuantity),sourceRequestId:item.id});setShowOneTime(true)}} style={primarySmall}>+ One-Time Part</button>
          <button disabled={Boolean(busy)} onClick={()=>void markUnmatchedHandled(item.id)} style={darkButton}>{busy===`unmatched:${item.id}`?'Saving…':'Mark handled'}</button>
        </div>
      </article>)}</div>}
    </section>

    <section style={panel}><div style={panelHead}><div><p style={eyebrow}>STOCKED PARTS</p><h2 style={title}>Waiting on parts</h2></div><span style={muted}>{groups.length} stocked part / warehouse line{groups.length===1?'':'s'}</span></div>
      {!groups.length?<div style={empty}>No stocked-part shortages in this warehouse.</div>:groups.map(group=>{
        const key=`${group.partId}:${group.warehouseCode}`,stock=group.stock,suggested=group.shortage;
        return <article key={key} style={queueCard}>
          <div style={{display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}><div><strong style={{fontSize:18}}>{group.partNumber}</strong><div style={muted}>{group.description} · {group.warehouseName}</div></div><span style={warningPill}>{n(group.shortage)} awaiting</span></div>
          <div style={stockGrid}>{[['ON HAND',stock?.physicalOnHand??0],['RESERVED',stock?.reserved??0],['AVAILABLE',stock?.available??0],['ON ORDER',stock?.onOrder??0]].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{n(Number(value))}</strong></div>)}</div>
          <details style={{marginTop:12}}><summary style={{cursor:'pointer',fontWeight:900,color:'#33485b'}}>{group.waitingJobs.length} waiting job{group.waitingJobs.length===1?'':'s'} — priority is OOS/Critical, then oldest</summary><div style={{display:'grid',gap:7,marginTop:8}}>{group.waitingJobs.map(job=><div key={job.id} style={jobRow}><b>Unit {job.unit||'—'}</b><span>{job.outOfService?'OOS · ':''}{job.priority==='1'?'Critical · ':''}{job.assignedTo||'Unassigned'}</span><span>{n(job.reservedQuantity)} reserved · {n(job.shortageQuantity)} awaiting</span></div>)}</div></details>
          <div style={actions}><input type="number" min="0.01" step="any" placeholder={n(suggested)} value={orderQty[key]??''} onChange={e=>setOrderQty(v=>({...v,[key]:e.target.value}))} style={input}/><button disabled={Boolean(busy)} onClick={()=>void action(group,'order',Number(orderQty[key]||suggested))} style={darkButton}>{busy===`order:${key}`?'Saving…':'Order shortage'}</button><input type="number" min="0.01" step="any" placeholder="Received qty" value={receiveQty[key]??''} onChange={e=>setReceiveQty(v=>({...v,[key]:e.target.value}))} style={input}/><button disabled={Boolean(busy)} onClick={()=>void action(group,'receive',Number(receiveQty[key]))} style={orangeButton}>{busy===`receive:${key}`?'Receiving…':'Receive'}</button></div>
        </article>
      })}
    </section>

    <section style={panel}><div style={panelHead}><div><p style={eyebrow}>TECH HANDOFF</p><h2 style={title}>Reserved / ready for jobs</h2></div><span style={muted}>{ready.length} active line{ready.length===1?'':'s'}</span></div>{!ready.length?<div style={empty}>Nothing is currently reserved for a repair.</div>:<div style={{display:'grid',gap:8}}>{ready.map(job=><div key={job.id} style={jobRow}><b>{job.partNumber} · Unit {job.unit||'—'}</b><span>{job.warehouseName} · {job.assignedTo||'Unassigned'}</span><span>{n(job.reservedQuantity)} ready{job.shortageQuantity>0?` · ${n(job.shortageQuantity)} still awaiting`:''}</span></div>)}</div>}</section>

    <section style={panel}><div style={panelHead}><div><p style={eyebrow}>STOCK MINIMUMS</p><h2 style={title}>Low-stock replenishment</h2></div><span style={muted}>One-time parts are excluded</span></div>{!lows.length?<div style={empty}>No stocked inventory is at or below its minimum in this warehouse.</div>:<div style={{display:'grid',gap:8}}>{lows.slice(0,80).map(item=>{const key=`${item.partId}:${item.warehouseCode}`;return <div key={key} style={lowRow}><div><b>{item.partNumber}</b><span>{item.description} · {item.warehouseName}</span></div><div><span>Available</span><b>{n(item.available)}</b></div><div><span>Minimum</span><b>{n(item.minimumQuantity)}</b></div><div><span>On order</span><b>{n(item.onOrder)}</b></div><button disabled={item.reorderSuggested<=0||Boolean(busy)} onClick={()=>void action(item,'order',item.reorderSuggested)} style={darkButton}>{item.reorderSuggested>0?`Order ${n(item.reorderSuggested)}`:'Covered'}</button></div>})}</div>}</section>

    {showOneTime&&<div style={modalBackdrop}><form onSubmit={createOneTime} style={modal}>
      <div style={{gridColumn:'1 / -1'}}><p style={eyebrow}>NON-STOCK PURCHASE</p><h2 style={{margin:'5px 0'}}>Create One-Time Part</h2><p style={muted}>This part will be available to techs in normal Part Lookup, but it will not count as stocked inventory or create reorder activity.{oneTime.sourceRequestId?" The technician request will be closed automatically when this is saved.":""}</p></div>
      <label style={field}>Part number <small>Optional — one will be generated if blank.</small><input value={oneTime.partNumber} onChange={e=>setOneTime(v=>({...v,partNumber:e.target.value}))} style={input}/></label>
      <label style={field}>Description<input required value={oneTime.description} onChange={e=>setOneTime(v=>({...v,description:e.target.value}))} style={input}/></label>
      <label style={field}>Warehouse<select required value={oneTime.warehouseCode} onChange={e=>setOneTime(v=>({...v,warehouseCode:e.target.value}))} style={input}><option value="">Choose warehouse…</option>{(data?.warehouses??[]).map(w=><option key={w.code} value={w.code}>{w.name}</option>)}</select></label>
      <label style={field}>Quantity received<input required type="number" min="0.01" step="any" value={oneTime.quantity} onChange={e=>setOneTime(v=>({...v,quantity:e.target.value}))} style={input}/></label>
      <label style={field}>Unit cost ($)<input type="number" min="0" step="0.01" value={oneTime.unitCost} onChange={e=>setOneTime(v=>({...v,unitCost:e.target.value}))} style={input}/></label>
      <label style={field}>Vendor<select value={oneTime.vendorId} onChange={e=>setOneTime(v=>({...v,vendorId:e.target.value}))} style={input}><option value="">No vendor selected</option>{(data?.vendors??[]).map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label style={field}>PO / invoice / reference<input value={oneTime.reference} onChange={e=>setOneTime(v=>({...v,reference:e.target.value}))} style={input}/></label>
      <label style={{...field,gridColumn:'1 / -1'}}>Notes<textarea rows={3} value={oneTime.notes} onChange={e=>setOneTime(v=>({...v,notes:e.target.value}))} style={{...input,resize:'vertical'}}/></label>
      <div style={{gridColumn:'1 / -1',display:'flex',justifyContent:'flex-end',gap:8}}><button type="button" disabled={Boolean(busy)} onClick={()=>{setShowOneTime(false);setOneTime(blankOneTime)}} style={secondaryAction}>Cancel</button><button type="submit" disabled={Boolean(busy)} style={primaryButton}>{busy==='one-time-create'?'Saving…':'Create One-Time Part'}</button></div>
    </form></div>}
  </main>
}

const eyebrow={margin:0,color:'#2f6f60',fontSize:11,fontWeight:950,letterSpacing:'.14em'} as const;
const title={margin:'5px 0 0',fontSize:22,color:'#173f37'} as const;
const muted={color:'#68746f',fontSize:12} as const;
const smallLabel={display:'block',fontSize:9,color:'#77838d',fontWeight:900,letterSpacing:'.08em',marginBottom:3} as const;
const tab={border:'1px solid #cbd3da',borderRadius:999,padding:'9px 13px',background:'white',color:'#24312c',fontWeight:900,cursor:'pointer'} as const;
const activeTab={...tab,background:'#173f37',borderColor:'#173f37',color:'white'} as const;
const notice={marginTop:16,padding:12,border:'1px solid #efc16c',borderRadius:9,background:'#fff8e6'} as const;
const metrics={marginTop:18,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10} as const;
const metric={padding:16,border:'1px solid #dde4e9',borderRadius:11,background:'white'} as const;
const panel={marginTop:16,padding:18,border:'1px solid #d7ded9',borderRadius:13,background:'white'} as const;
const panelHead={display:'flex',justifyContent:'space-between',gap:12,alignItems:'end',flexWrap:'wrap',marginBottom:12} as const;
const unmatchedCard={display:'grid',gridTemplateColumns:'minmax(220px,1fr) 70px 110px minmax(220px,auto)',gap:12,alignItems:'center',padding:14,border:'2px solid #e1b256',borderRadius:10,background:'#fff9ed'} as const;
const oneTimeRow={display:'grid',gridTemplateColumns:'minmax(260px,1fr) 130px 90px 100px auto',gap:12,alignItems:'center',padding:13,border:'1px solid #cdd8d3',borderRadius:10,background:'#f8fbf9'} as const;
const oneTimePill={display:'inline-flex',padding:'3px 7px',borderRadius:999,background:'#e7efe9',color:'#173f37',fontSize:9,fontWeight:950,letterSpacing:'.06em'} as const;
const queueCard={padding:15,border:'1px solid #e0e5e9',borderRadius:11,background:'#fbfcfb',marginTop:10} as const;
const warningPill={display:'inline-flex',alignItems:'center',padding:'6px 10px',borderRadius:999,background:'#fff0d7',color:'#9a5a05',fontWeight:950,fontSize:12} as const;
const stockGrid={display:'grid',gridTemplateColumns:'repeat(4,minmax(90px,1fr))',gap:8,marginTop:12} as const;
const jobRow={display:'grid',gridTemplateColumns:'minmax(150px,1fr) minmax(130px,1fr) auto',gap:10,alignItems:'center',padding:'9px 10px',border:'1px solid #e5e9ed',borderRadius:8,background:'white',fontSize:12} as const;
const actions={display:'grid',gridTemplateColumns:'100px auto 110px auto',gap:7,marginTop:12,alignItems:'center'} as const;
const input={width:'100%',boxSizing:'border-box',padding:'9px 10px',border:'1px solid #ccd5dd',borderRadius:8,background:'white'} as const;
const darkButton={border:0,borderRadius:8,padding:'9px 11px',background:'#173f37',color:'white',fontWeight:900,cursor:'pointer'} as const;
const orangeButton={...darkButton,background:'#2f6f60'} as const;
const lowRow={display:'grid',gridTemplateColumns:'minmax(230px,1.5fr) repeat(3,minmax(75px,.5fr)) auto',gap:10,alignItems:'center',padding:'10px 11px',border:'1px solid #e5e9ed',borderRadius:9,background:'#fbfcfb',fontSize:12} as const;
const empty={padding:20,textAlign:'center',color:'#71808e',border:'1px dashed #d2d9df',borderRadius:9} as const;
const primaryButton={display:'inline-flex',alignItems:'center',justifyContent:'center',border:0,borderRadius:9,padding:'12px 16px',background:'#173f37',color:'white',fontWeight:900,cursor:'pointer',textDecoration:'none'} as const;
const secondaryButton={...primaryButton,background:'white',color:'#173f37',border:'1px solid #173f37'} as const;
const primarySmall={...primaryButton,padding:'8px 10px',fontSize:11} as const;
const secondaryAction={display:'inline-flex',alignItems:'center',justifyContent:'center',border:'1px solid #9baaa4',borderRadius:8,padding:'8px 10px',background:'white',color:'#173f37',fontWeight:900,cursor:'pointer',textDecoration:'none'} as const;
const modalBackdrop={position:'fixed',inset:0,background:'#07111db8',display:'grid',placeItems:'center',padding:20,zIndex:80,overflowY:'auto'} as const;
const modal={width:'min(760px,100%)',display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12,padding:20,borderRadius:14,background:'white',boxShadow:'0 20px 60px #0004'} as const;
const field={display:'grid',gap:5,fontSize:12,fontWeight:800,color:'#334d43'} as const;
