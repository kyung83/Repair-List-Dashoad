'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

type Assignment={id:number;repairId:string;repairNumericId:number;equipmentId:number|null;unit:string;repairTitle:string;vendorId:number;vendorName:string;vendorPhone:string;status:'waiting_vendor'|'waiting_invoice';notes:string;assignedAt:string;vendorFinishedAt:string;updatedAt:string};
type Payload={assignments?:Assignment[];error?:string;ok?:boolean;message?:string};

function when(value:string){if(!value)return'—';const parsed=new Date(value.includes('T')?value:`${value.replace(' ','T')}Z`);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();}

export default function LiveOutsideRepairs(){
  const[rows,setRows]=useState<Assignment[]>([]);const[message,setMessage]=useState('');const[busy,setBusy]=useState('');
  async function load(){const response=await fetch('/api/outside-repairs',{cache:'no-store'});if(response.status===401)return;const result=await response.json() as Payload;if(!response.ok)throw new Error(result.error||'Outside Repairs could not be loaded.');setRows(result.assignments||[]);}
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Outside Repairs could not be loaded.'));},[]);
  const waitingVendor=useMemo(()=>rows.filter(row=>row.status==='waiting_vendor'),[rows]);
  const waitingInvoice=useMemo(()=>rows.filter(row=>row.status==='waiting_invoice'),[rows]);

  async function action(row:Assignment,actionName:'vendor-finished'|'return-shop'){
    setBusy(`${actionName}-${row.repairId}`);setMessage('');
    try{const response=await fetch('/api/outside-repairs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:actionName,repairId:row.repairId})});const result=await response.json() as Payload;if(!response.ok||!result.ok)throw new Error(result.error||'Outside repair could not be updated.');setRows(result.assignments||[]);setMessage(result.message||'Outside repair updated.');}
    catch(error){setMessage(error instanceof Error?error.message:'Outside repair could not be updated.');}finally{setBusy('');}
  }

  return <section style={shell}>
    <div style={header}><div><div style={eyebrow}>SHOP · OUTSIDE REPAIRS</div><h1 style={title}>Outside repair queue</h1><p style={copy}>Jobs moved from the Repair Board live here. When the vendor texts that the unit is fixed, move it to Waiting on Invoice. Uploading the invoice closes the same original repair.</p></div><span style={count}>{rows.length} ACTIVE</span></div>
    {message&&<div style={notice}>{message}</div>}
    <div style={columns}>
      <Queue title="Waiting on Vendor" subtitle="Vendor still has the unit / repair is not confirmed fixed." rows={waitingVendor} emptyText="Nothing is currently waiting on a vendor." busy={busy} onAction={action}/>
      <Queue title="Waiting on Invoice" subtitle="Vendor said it is fixed. Operationally done; invoice is still missing." rows={waitingInvoice} emptyText="No finished vendor repairs are waiting on an invoice." busy={busy} onAction={action}/>
    </div>
  </section>;
}

function Queue({title,subtitle,rows,emptyText,busy,onAction}:{title:string;subtitle:string;rows:Assignment[];emptyText:string;busy:string;onAction:(row:Assignment,action:'vendor-finished'|'return-shop')=>Promise<void>}){
  return <div style={queue}><div><h2 style={h2}>{title}</h2><p style={small}>{subtitle}</p></div>{rows.length===0?<div style={empty}>{emptyText}</div>:rows.map(row=><article key={row.id} style={card}>
    <div style={rowTop}><div><strong style={{fontSize:20}}>Unit {row.unit||'—'}</strong><div style={repair}>{row.repairTitle}</div></div><span style={status}>{row.status==='waiting_vendor'?'WAITING ON VENDOR':'WAITING ON INVOICE'}</span></div>
    <div style={details}><span>Vendor</span><strong>{row.vendorName}</strong><span>Phone</span><strong>{row.vendorPhone||'—'}</strong><span>Sent out</span><strong>{when(row.assignedAt)}</strong>{row.vendorFinishedAt&&<><span>Vendor finished</span><strong>{when(row.vendorFinishedAt)}</strong></>}</div>
    {row.notes&&<div style={notes}><strong>Note / vendor text:</strong> {row.notes}</div>}
    <div style={actions}>
      {row.status==='waiting_vendor'&&<button type="button" style={primary} disabled={Boolean(busy)} onClick={()=>void onAction(row,'vendor-finished')}>{busy===`vendor-finished-${row.repairId}`?'Saving…':'Vendor Says Fixed'}</button>}
      {row.status==='waiting_invoice'&&<a style={primaryLink} href={`/outside-work?repairId=${encodeURIComponent(row.repairId)}&unit=${encodeURIComponent(row.unit)}`}>Upload Invoice</a>}
      <button type="button" style={secondary} disabled={Boolean(busy)} onClick={()=>void onAction(row,'return-shop')}>{busy===`return-shop-${row.repairId}`?'Moving…':'Move Back to Shop'}</button>
    </div>
  </article>)}</div>;
}

const shell:CSSProperties={margin:'18px auto 0',maxWidth:1440,padding:'0 clamp(16px,4vw,46px)',color:'#172536'};
const header:CSSProperties={display:'flex',justifyContent:'space-between',gap:14,alignItems:'flex-start',flexWrap:'wrap'};
const eyebrow:CSSProperties={fontSize:11,fontWeight:950,letterSpacing:'.11em',color:'#50677a'};
const title:CSSProperties={margin:'5px 0 0',fontSize:28,color:'#10243a'};
const copy:CSSProperties={margin:'7px 0 0',maxWidth:850,fontSize:14,lineHeight:1.5,color:'#607080'};
const count:CSSProperties={padding:'8px 10px',borderRadius:9,border:'1px solid #b6c6d3',background:'#f7fafc',fontSize:12,fontWeight:900};
const notice:CSSProperties={marginTop:12,padding:'10px 12px',border:'1px solid #d7c27b',borderRadius:8,background:'#fffdf2',fontSize:13};
const columns:CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:16,marginTop:16};
const queue:CSSProperties={padding:14,border:'1px solid #d4dee6',borderRadius:12,background:'#f8fafc',display:'grid',gap:11,alignContent:'start'};
const h2:CSSProperties={margin:0,fontSize:19,color:'#17324a'};
const small:CSSProperties={margin:'4px 0 0',fontSize:12,color:'#687887',lineHeight:1.45};
const card:CSSProperties={padding:14,border:'1px solid #d7e0e7',borderRadius:10,background:'#fff',display:'grid',gap:11};
const rowTop:CSSProperties={display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start',flexWrap:'wrap'};
const repair:CSSProperties={marginTop:4,fontSize:13,color:'#526373',maxWidth:500};
const status:CSSProperties={fontSize:10,fontWeight:950,letterSpacing:'.06em',padding:'6px 8px',border:'1px solid #e0b96a',borderRadius:7,background:'#fff8e8',color:'#78530d'};
const details:CSSProperties={display:'grid',gridTemplateColumns:'110px 1fr',gap:'5px 10px',fontSize:12,alignItems:'baseline'};
const notes:CSSProperties={padding:9,borderRadius:8,background:'#f6f8fa',fontSize:12,lineHeight:1.45,color:'#4f6070'};
const actions:CSSProperties={display:'flex',gap:8,flexWrap:'wrap'};
const primary:CSSProperties={minHeight:40,border:0,borderRadius:8,padding:'8px 11px',background:'#10243a',color:'#fff',fontWeight:900,cursor:'pointer'};
const primaryLink:CSSProperties={minHeight:40,display:'inline-flex',alignItems:'center',borderRadius:8,padding:'0 11px',background:'#10243a',color:'#fff',fontWeight:900,textDecoration:'none'};
const secondary:CSSProperties={minHeight:40,border:'1px solid #b6c6d3',borderRadius:8,padding:'8px 11px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'};
const empty:CSSProperties={padding:22,border:'1px dashed #c7d2dc',borderRadius:9,textAlign:'center',fontSize:13,color:'#6a7987',background:'#fff'};
