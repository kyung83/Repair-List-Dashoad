'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';

type ReceiptReview={
  breakdownId:number;
  driverStatus:string;
  techArrivedAt:string|null;
  repairFinishedAt:string|null;
  rollingAt:string|null;
  readyForReviewAt:string|null;
  receipt:null|{
    id:number;aiStatus:string;model:string;vendor:string;invoiceNumber:string;invoiceDate:string;unit:string;mileage:string;
    totalAmount:string;serviceSummary:string;costs:Record<string,unknown>;uncertain:string[];aiError:string;reviewStatus:string;
    reviewedAt:string|null;pages:{pageOrder:number;fileName:string;contentType:string;url:string}[];
  };
};
type Draft={vendor:string;invoiceNumber:string;invoiceDate:string;totalAmount:string;serviceSummary:string};

function time(value:string|null){
  if(!value)return'—';
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();
}
function dollars(value:string){const n=Number(value);return Number.isFinite(n)?n.toLocaleString('en-US',{style:'currency',currency:'USD'}):'$0.00';}
const input:React.CSSProperties={width:'100%',minHeight:44,padding:'9px 11px',border:'1px solid #cbd5e1',borderRadius:9,background:'#fff',color:'#172033',boxSizing:'border-box',fontSize:14};
const label:React.CSSProperties={display:'grid',gap:5,fontSize:11,fontWeight:900,color:'#435565',textTransform:'uppercase',letterSpacing:'.03em'};
const button:React.CSSProperties={minHeight:42,padding:'0 13px',border:'1px solid #c8d3dd',borderRadius:9,background:'#fff',color:'#25384a',fontWeight:900,cursor:'pointer'};
const orange:React.CSSProperties={...button,borderColor:'#f47b20',background:'#f47b20',color:'#fff'};

export default function DriverReceiptReview({breakdownId,initialCost,providerName,onClosed}:{breakdownId:number;initialCost:number|null;providerName:string|null;onClosed:()=>void}){
  const[review,setReview]=useState<ReceiptReview|null>(null);
  const[draft,setDraft]=useState<Draft>({vendor:'',invoiceNumber:'',invoiceDate:'',totalAmount:'',serviceSummary:''});
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState('');

  const load=useCallback(async(quiet=false)=>{
    if(!quiet)setLoading(true);
    try{
      const response=await fetch(`/api/breakdowns/receipts?breakdownId=${breakdownId}`,{cache:'no-store'});
      const payload=await response.json() as {review?:ReceiptReview;error?:string};
      if(!response.ok||!payload.review)throw new Error(payload.error||'Driver follow-up could not be loaded.');
      setReview(payload.review);
      const receipt=payload.review.receipt;
      setDraft(current=>quiet?{
        vendor:current.vendor||receipt?.vendor||providerName||'',
        invoiceNumber:current.invoiceNumber||receipt?.invoiceNumber||'',
        invoiceDate:current.invoiceDate||receipt?.invoiceDate||'',
        totalAmount:current.totalAmount||(initialCost!=null?String(initialCost):(receipt?.totalAmount||'')),
        serviceSummary:current.serviceSummary||receipt?.serviceSummary||'',
      }:{
        vendor:receipt?.vendor||providerName||current.vendor||'',
        invoiceNumber:receipt?.invoiceNumber||current.invoiceNumber||'',
        invoiceDate:receipt?.invoiceDate||current.invoiceDate||'',
        totalAmount:initialCost!=null?String(initialCost):(receipt?.totalAmount||current.totalAmount||''),
        serviceSummary:receipt?.serviceSummary||current.serviceSummary||'',
      });
      if(!quiet)setMessage('');
    }catch(error){if(!quiet)setMessage(error instanceof Error?error.message:'Driver follow-up could not be loaded.');}
    finally{if(!quiet)setLoading(false);}
  },[breakdownId,initialCost,providerName]);

  useEffect(()=>{
    void load();
    const interval=window.setInterval(()=>void load(true),10000);
    const refreshWhenVisible=()=>{if(document.visibilityState==='visible')void load(true);};
    document.addEventListener('visibilitychange',refreshWhenVisible);
    return()=>{
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange',refreshWhenVisible);
    };
  },[load]);
  function setField(field:keyof Draft,value:string){setDraft(current=>({...current,[field]:value}));}

  const costNumber=Number(draft.totalAmount);
  const costValid=draft.totalAmount.trim()!==''&&Number.isFinite(costNumber)&&costNumber>=0;
  const rolling=Boolean(review?.rollingAt);
  const statusText=useMemo(()=>{
    if(rolling)return'Driver marked Rolling';
    if(review?.driverStatus==='repair_finished')return'Repair marked finished — Rolling not confirmed';
    if(review?.driverStatus==='tech_arrived')return'Tech on location — Rolling not confirmed';
    return'Rolling not confirmed';
  },[review?.driverStatus,rolling]);

  async function confirmClose(){
    if(!costValid){setMessage('Enter the final total cost. Enter 0.00 if there was no outside cost.');return;}
    const rollingNote=rolling?'Driver has marked Rolling.':'Driver has NOT marked Rolling. Rolling is optional for office closeout.';
    if(!window.confirm(`${rollingNote}\n\nConfirm breakdown #${breakdownId} is repaired, the final cost is ${dollars(draft.totalAmount)}, and close it?`))return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/breakdowns/receipts',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({breakdownId,...draft})});
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Breakdown could not be closed.');
      onClosed();
    }catch(error){setMessage(error instanceof Error?error.message:'Breakdown could not be closed.');}
    finally{setBusy(false);}
  }

  if(loading)return <div style={{marginTop:12,padding:14,border:'1px solid #dfe6ee',borderRadius:10,background:'#f8fafc',color:'#64748b'}}>Loading closeout status…</div>;
  if(!review)return message?<div style={{marginTop:12,padding:11,border:'1px solid #efc16c',borderRadius:9,background:'#fff8e8'}}>{message}</div>:null;
  const receiptRecord=review.receipt;
  const receipt=receiptRecord&&receiptRecord.pages.length>0?receiptRecord:null;
  const receiptUploadFailed=Boolean(receiptRecord&&!receipt&&receiptRecord.aiStatus==='upload_failed');

  return <div style={{marginTop:12,display:'grid',gap:12}}>
    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:8}}>
      <div style={statusBox}><span style={statusLabel}>Tech arrived</span><strong>{time(review.techArrivedAt)}</strong></div>
      <div style={statusBox}><span style={statusLabel}>Repair finished</span><strong>{time(review.repairFinishedAt)}</strong></div>
      <div style={{...statusBox,borderColor:rolling?'#9fcdb1':'#e7c77f',background:rolling?'#eef9f2':'#fff9ec'}}><span style={statusLabel}>Driver status</span><strong style={{color:rolling?'#17633d':'#875c13'}}>{statusText}</strong><small style={{marginTop:3,color:'#71808b'}}>Optional — office can close either way.</small></div>
    </section>

    {receipt?<details style={{border:'1px solid #d9e1e8',borderRadius:10,background:'#fff',padding:11}}>
      <summary style={{cursor:'pointer',fontWeight:900,color:'#263b4e'}}>Receipt uploaded — review details</summary>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,170px))',gap:8,marginTop:10}}>{receipt.pages.map(page=><a key={page.pageOrder} href={page.url} target="_blank" rel="noreferrer" style={{display:'block',border:'1px solid #d9e1e8',borderRadius:8,overflow:'hidden'}}><img src={page.url} alt={page.fileName} style={{display:'block',width:'100%',height:120,objectFit:'cover'}}/></a>)}</div>
      {receipt.aiStatus==='failed'?<div style={warning}>Receipt saved, but automatic reading failed. Check the image manually. {receipt.aiError}</div>:null}
      {receipt.uncertain.length?<div style={warning}><strong>Check:</strong> {receipt.uncertain.join(' · ')}</div>:null}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:9,marginTop:10}}>
        <label style={label}>Vendor<input style={input} value={draft.vendor} onChange={event=>setField('vendor',event.target.value.slice(0,180))}/></label>
        <label style={label}>Invoice #<input style={input} value={draft.invoiceNumber} onChange={event=>setField('invoiceNumber',event.target.value.slice(0,100))}/></label>
        <label style={label}>Invoice Date<input style={input} type="date" value={draft.invoiceDate} onChange={event=>setField('invoiceDate',event.target.value)}/></label>
      </div>
    </details>:<div style={{padding:10,border:receiptUploadFailed?'1px solid #efc16c':'1px dashed #cbd5df',borderRadius:9,background:receiptUploadFailed?'#fff8e8':'transparent',color:receiptUploadFailed?'#765218':'#667482',fontSize:12}}>{receiptUploadFailed?'The driver attempted a receipt upload, but no receipt image was saved. Ask the driver to upload it again.':'No receipt uploaded. Receipt is optional and does not block closeout.'}</div>}

    <section style={{padding:14,border:'2px solid #f2a35f',borderRadius:11,background:'#fff9f3'}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(180px,.55fr) minmax(260px,1.45fr)',gap:12,alignItems:'start'}} className="breakdown-closeout-fields">
        <label style={label}>Final Total Cost
          <div style={{position:'relative'}}><span style={{position:'absolute',left:12,top:12,fontWeight:900,color:'#52616d'}}>$</span><input style={{...input,paddingLeft:27,fontSize:22,fontWeight:950}} inputMode="decimal" value={draft.totalAmount} onChange={event=>setField('totalAmount',event.target.value.replace(/[^0-9.]/g,'').slice(0,12))} placeholder="0.00"/></div>
          <small style={{textTransform:'none',letterSpacing:0,color:'#74808b',fontWeight:700}}>Final cost belongs here because this step means the repair is finished and paid. Use 0.00 for no outside cost.</small>
        </label>
        <label style={label}>Closeout Notes<textarea style={{...input,minHeight:100,resize:'vertical'}} value={draft.serviceSummary} onChange={event=>setField('serviceSummary',event.target.value.slice(0,4000))} placeholder="What was repaired, payment note, anything important for history…"/></label>
      </div>
    </section>

    {message?<div style={{padding:10,border:'1px solid #efc16c',borderRadius:9,background:'#fff8e8',color:'#654d18',fontSize:12,fontWeight:750}}>{message}</div>:null}
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button type="button" style={{...orange,minWidth:220}} disabled={busy||!costValid} onClick={()=>void confirmClose()}>{busy?'Closing…':'Confirm & Close Breakdown'}</button>
      <button type="button" style={button} disabled={busy} onClick={()=>void load()}>Refresh Driver Status</button>
    </div>
    <style>{`@media(max-width:760px){.breakdown-closeout-fields{grid-template-columns:1fr!important}}`}</style>
  </div>;
}

const statusBox:React.CSSProperties={display:'grid',padding:'10px 11px',border:'1px solid #dce3e9',borderRadius:9,background:'#f8fafb',fontSize:12,color:'#263b4e'};
const statusLabel:React.CSSProperties={marginBottom:4,color:'#73808b',fontSize:9,fontWeight:900,textTransform:'uppercase',letterSpacing:'.05em'};
const warning:React.CSSProperties={marginTop:9,padding:9,border:'1px solid #efc16c',borderRadius:8,background:'#fff8e8',color:'#765218',fontSize:11};
