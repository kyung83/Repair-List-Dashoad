'use client';

import { useCallback, useEffect, useState } from 'react';

type ReceiptReview={
  breakdownId:number;
  driverStatus:string;
  techArrivedAt:string|null;
  repairFinishedAt:string|null;
  rollingAt:string|null;
  readyForReviewAt:string|null;
  receipt:null|{
    id:number;
    aiStatus:string;
    model:string;
    vendor:string;
    invoiceNumber:string;
    invoiceDate:string;
    unit:string;
    mileage:string;
    totalAmount:string;
    serviceSummary:string;
    costs:Record<string,unknown>;
    uncertain:string[];
    aiError:string;
    reviewStatus:string;
    reviewedAt:string|null;
    pages:{pageOrder:number;fileName:string;contentType:string;url:string}[];
  };
};

type Draft={vendor:string;invoiceNumber:string;invoiceDate:string;totalAmount:string;serviceSummary:string};

function time(value:string|null){
  if(!value)return'—';
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();
}

const inputStyle:React.CSSProperties={width:'100%',minHeight:42,padding:'8px 10px',border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',color:'#172033',boxSizing:'border-box'};
const labelStyle:React.CSSProperties={display:'grid',gap:5,fontSize:12,fontWeight:850,color:'#334155'};

export default function DriverReceiptReview({breakdownId,onClosed}:{breakdownId:number;onClosed:()=>void}){
  const [review,setReview]=useState<ReceiptReview|null>(null);
  const [draft,setDraft]=useState<Draft>({vendor:'',invoiceNumber:'',invoiceDate:'',totalAmount:'',serviceSummary:''});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const response=await fetch(`/api/breakdowns/receipts?breakdownId=${breakdownId}`,{cache:'no-store'});
      const payload=await response.json() as {review?:ReceiptReview;error?:string};
      if(!response.ok||!payload.review)throw new Error(payload.error||'Driver follow-up could not be loaded.');
      setReview(payload.review);
      const receipt=payload.review.receipt;
      setDraft({
        vendor:receipt?.vendor||'',
        invoiceNumber:receipt?.invoiceNumber||'',
        invoiceDate:receipt?.invoiceDate||'',
        totalAmount:receipt?.totalAmount||'',
        serviceSummary:receipt?.serviceSummary||'',
      });
      setMessage('');
    }catch(error){setMessage(error instanceof Error?error.message:'Driver follow-up could not be loaded.');}
    finally{setLoading(false);}
  },[breakdownId]);

  useEffect(()=>{void load();},[load]);

  function setField(field:keyof Draft,value:string){setDraft(current=>({...current,[field]:value}));}

  async function confirmClose(){
    if(!review?.rollingAt){setMessage('Driver has not marked Rolling yet.');return;}
    if(!window.confirm(`Confirm breakdown #${breakdownId} is complete and close it?`))return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/breakdowns/receipts',{
        method:'PATCH',headers:{'content-type':'application/json'},
        body:JSON.stringify({breakdownId,...draft}),
      });
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Breakdown could not be closed.');
      onClosed();
    }catch(error){setMessage(error instanceof Error?error.message:'Breakdown could not be closed.');}
    finally{setBusy(false);}
  }

  if(loading)return <section style={{marginTop:14,padding:14,border:'1px solid #dfe6ee',borderRadius:12,background:'#f8fafc'}}><p className="easy-section-copy">Loading driver progress...</p></section>;
  if(!review)return message?<div className="easy-notice" style={{marginTop:14}}>{message}</div>:null;
  const receipt=review.receipt;
  const ready=Boolean(review.rollingAt);

  return(
    <section style={{marginTop:14,padding:14,border:ready?'2px solid #ea7b22':'1px solid #dfe6ee',borderRadius:12,background:ready?'#fff8ed':'#f8fafc'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <p className="easy-eyebrow" style={{marginBottom:4}}>DRIVER FOLLOW-UP</p>
          <strong style={{fontSize:16,color:'#172033'}}>{ready?'Ready for Office Review':review.driverStatus==='repair_finished'?'Repair Finished':review.driverStatus==='tech_arrived'?'Tech On Location':'Waiting for Tech Update'}</strong>
        </div>
        {ready&&<span className="easy-badge orange">DRIVER IS ROLLING</span>}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,marginTop:12}}>
        <div className="easy-form-row"><strong>Tech arrived</strong><span>{time(review.techArrivedAt)}</span></div>
        <div className="easy-form-row"><strong>Repair finished</strong><span>{time(review.repairFinishedAt)}</span></div>
        <div className="easy-form-row"><strong>Rolling</strong><span>{time(review.rollingAt)}</span></div>
      </div>

      <div style={{marginTop:14,padding:12,borderRadius:10,border:'1px solid #d5dee8',background:'#fff'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline',flexWrap:'wrap'}}>
          <strong style={{color:'#172033'}}>Receipt Review</strong>
          <span style={{fontSize:12,fontWeight:800,color:receipt?'#27623f':'#64748b'}}>{receipt?'Receipt uploaded':'No receipt uploaded'}</span>
        </div>

        {receipt?(
          <>
            {receipt.pages.length>0&&(
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,190px))',gap:9,marginTop:10}}>
                {receipt.pages.map(page=><a key={page.pageOrder} href={page.url} target="_blank" rel="noreferrer" style={{display:'block',border:'1px solid #d9e1e8',borderRadius:9,overflow:'hidden',background:'#f8fafc'}}><img src={page.url} alt={page.fileName} style={{display:'block',width:'100%',height:140,objectFit:'cover'}}/></a>)}
              </div>
            )}

            {receipt.aiStatus==='failed'&&<div className="easy-notice" style={{marginTop:10,borderColor:'#efb36c',background:'#fff8ed',color:'#7a4514'}}>The receipt was saved, but the automatic reader could not finish. Review the original image manually. {receipt.aiError}</div>}
            {receipt.uncertain.length>0&&<div className="easy-notice" style={{marginTop:10,borderColor:'#efb36c',background:'#fff8ed',color:'#7a4514'}}><strong>Reader wants these checked:</strong><br/>{receipt.uncertain.join(' · ')}</div>}

            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginTop:12}}>
              <label style={labelStyle}>Vendor<input style={inputStyle} value={draft.vendor} onChange={event=>setField('vendor',event.target.value.slice(0,180))}/></label>
              <label style={labelStyle}>Invoice #<input style={inputStyle} value={draft.invoiceNumber} onChange={event=>setField('invoiceNumber',event.target.value.slice(0,100))}/></label>
              <label style={labelStyle}>Invoice Date<input style={inputStyle} type="date" value={draft.invoiceDate} onChange={event=>setField('invoiceDate',event.target.value)}/></label>
              <label style={labelStyle}>Total<input style={inputStyle} inputMode="decimal" value={draft.totalAmount} onChange={event=>setField('totalAmount',event.target.value.replace(/[^0-9.]/g,'').slice(0,12))} placeholder="0.00"/></label>
            </div>
            <label style={{...labelStyle,marginTop:10}}>Work / Service Summary<textarea style={{...inputStyle,minHeight:92,resize:'vertical'}} value={draft.serviceSummary} onChange={event=>setField('serviceSummary',event.target.value.slice(0,4000))}/></label>
            {(receipt.unit||receipt.mileage)&&<p style={{margin:'10px 0 0',fontSize:12,color:'#64748b'}}>Reader reference: {receipt.unit?`Unit ${receipt.unit}`:''}{receipt.unit&&receipt.mileage?' · ':''}{receipt.mileage?`Mileage ${receipt.mileage}`:''}</p>}
          </>
        ):(
          <p className="easy-section-copy" style={{margin:'8px 0 0'}}>Receipt was optional. You can still confirm and close once the driver marks Rolling.</p>
        )}
      </div>

      {message&&<div className="easy-notice" style={{marginTop:10}}>{message}</div>}
      <div className="easy-actions" style={{marginTop:12}}>
        <button type="button" className="easy-button orange" disabled={!ready||busy} onClick={()=>void confirmClose()}>{busy?'Closing...':'Confirm & Close Breakdown'}</button>
        <button type="button" className="easy-button" disabled={busy} onClick={()=>void load()}>Refresh Driver Status</button>
      </div>
    </section>
  );
}
