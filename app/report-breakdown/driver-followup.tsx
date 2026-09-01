'use client';

import { useCallback, useEffect, useState } from 'react';

type DriverFollowupState={
  breakdownId:number;
  unit:string;
  equipmentType:string;
  driverName:string;
  driverStatus:string;
  techArrivedAt:string|null;
  repairFinishedAt:string|null;
  rollingAt:string|null;
  readyForReviewAt:string|null;
  closed:boolean;
  status:string;
  serviceProvider:string;
  serviceProviderPhone:string;
  eta:string;
  dispatchUpdatedAt:string|null;
  receipt:{uploaded:boolean;aiStatus:string;reviewStatus:string};
};

type Props={breakdownId:number;token:string;onReportAnother:()=>void};
type ReceiptUploadPayload={breakdown?:DriverFollowupState;error?:string};

function completed(value:string|null){return Boolean(value);}

function formatTime(value:string|null){
  if(!value)return'';
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?'':parsed.toLocaleString();
}

function phoneHref(value:string){
  return `tel:${value.replace(/[^0-9+]/g,'')}`;
}

export default function DriverFollowup({breakdownId,token,onReportAnother}:Props){
  const [state,setState]=useState<DriverFollowupState|null>(null);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');

  const load=useCallback(async(quiet=false)=>{
    try{
      const params=new URLSearchParams({breakdownId:String(breakdownId),token});
      const response=await fetch(`/api/breakdowns/driver?${params.toString()}`,{cache:'no-store'});
      const payload=await response.json() as {breakdown?:DriverFollowupState;error?:string};
      if(!response.ok||!payload.breakdown)throw new Error(payload.error||'Breakdown follow-up could not be loaded.');
      if(payload.breakdown.rollingAt||payload.breakdown.closed||payload.breakdown.status==='not_breakdown'||payload.breakdown.status==='complete'){
        onReportAnother();
        return;
      }
      setState(payload.breakdown);
      if(!quiet)setMessage('');
    }catch(error){
      if(!quiet)setMessage(error instanceof Error?error.message:'Breakdown follow-up could not be loaded.');
    }
  },[breakdownId,token,onReportAnother]);

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

  async function action(name:'tech_arrived'|'rolling'){
    setBusy(name);
    setMessage('');
    try{
      const response=await fetch('/api/breakdowns/driver',{
        method:'PATCH',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({breakdownId,token,action:name}),
      });
      const payload=await response.json() as {breakdown?:DriverFollowupState;error?:string};
      if(!response.ok||!payload.breakdown)throw new Error(payload.error||'Breakdown status could not be updated.');
      setState(payload.breakdown);
      if(name==='rolling'){
        setMessage('Repair finished and rolling recorded. Returning to the breakdown page...');
        window.setTimeout(()=>onReportAnother(),650);
      }else{
        setMessage('Tech arrival recorded and emailed to the breakdown thread.');
      }
    }catch(error){
      setMessage(error instanceof Error?error.message:'Breakdown status could not be updated.');
    }finally{setBusy('');}
  }

  async function uploadReceipt(files:File[]){
    if(!files.length)return;
    setBusy('receipt');
    setMessage('Uploading receipt to Northern...');
    try{
      const form=new FormData();
      form.set('breakdownId',String(breakdownId));
      form.set('token',token);
      for(const file of files.slice(0,3))form.append('receipt',file,file.name);

      const response=await fetch('/api/breakdowns/driver',{method:'POST',body:form});
      const responseText=await response.text();
      let payload:ReceiptUploadPayload={};
      if(responseText){
        try{
          payload=JSON.parse(responseText) as ReceiptUploadPayload;
        }catch{
          if(response.status===413)throw new Error('That receipt photo is too large to upload.');
          throw new Error(`Receipt upload returned an unreadable response (HTTP ${response.status}).`);
        }
      }
      if(!response.ok||!payload.breakdown)throw new Error(payload.error||'Receipt could not be uploaded.');
      setState(payload.breakdown);
      setMessage('Receipt uploaded. Northern will read and review it on our side.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Receipt could not be uploaded.');
    }finally{
      setBusy('');
    }
  }

  const arrived=completed(state?.techArrivedAt||null);
  const rolling=completed(state?.rollingAt||null);
  const receiptUploaded=Boolean(state?.receipt.uploaded);
  const hasDispatchUpdate=Boolean(state?.serviceProvider||state?.eta);

  return(
    <main className="easy-page">
      <div className="easy-page-narrow" style={{maxWidth:720}}>
        <section className="easy-card" style={{overflow:'hidden'}}>
          <div style={{padding:26,background:'#0d1b2b',color:'#fff'}}>
            <p className="easy-eyebrow">BREAKDOWN SUBMITTED</p>
            <h1 style={{margin:'8px 0 0',fontSize:32}}>Breakdown #{breakdownId}</h1>
            <p style={{margin:'10px 0 0',color:'#c5d0da',lineHeight:1.5}}>
              {state?`${state.equipmentType==='trailer'?'Trailer':'Truck'} ${state.unit} · ${state.driverName}`:'Your report is saved.'}
            </p>
          </div>

          <div className="easy-card-body">
            <h2 className="easy-section-title">Roadside Updates</h2>
            <p className="easy-section-copy">Keep this screen open while you are stopped. Dispatch updates appear here automatically.</p>

            {hasDispatchUpdate?(
              <div className="easy-notice" style={{marginTop:16,padding:18,border:'2px solid #75b98a',background:'#edf9f0',color:'#173b24'}}>
                <p style={{margin:0,fontSize:12,fontWeight:950,letterSpacing:'.12em'}}>SERVICE UPDATE</p>
                <h3 style={{margin:'7px 0 12px',fontSize:22}}>Roadside help is on the way</h3>
                <div style={{display:'grid',gap:8,fontSize:17}}>
                  <div><strong>Service Provider:</strong> {state?.serviceProvider||'Assigned'}</div>
                  <div><strong>ETA:</strong> {state?.eta||'Being confirmed'}</div>
                  {state?.serviceProviderPhone&&(
                    <div><strong>Provider Phone:</strong> <a href={phoneHref(state.serviceProviderPhone)} style={{color:'#0b5d2a',fontWeight:850}}>{state.serviceProviderPhone}</a></div>
                  )}
                </div>
                <small style={{display:'block',marginTop:12,color:'#476451'}}>This screen checks for new dispatch information every 10 seconds.</small>
              </div>
            ):!arrived?(
              <div className="easy-notice" style={{marginTop:16}}>
                Northern is arranging roadside service. Keep this screen open — the service provider and ETA will appear here automatically when they are assigned.
              </div>
            ):null}

            <div style={{display:'grid',gap:14,marginTop:20}}>
              <button
                type="button"
                className={`easy-button ${arrived?'orange':''}`}
                disabled={busy!==''||arrived||Boolean(state?.closed)}
                onClick={()=>void action('tech_arrived')}
                style={{width:'100%',minHeight:68,fontSize:18,justifyContent:'space-between'}}
              >
                <span>{busy==='tech_arrived'?'Sending Update...':arrived?'✓ Tech Has Arrived':'Tech Has Arrived'}</span>
                {arrived&&<small>{formatTime(state?.techArrivedAt||null)}</small>}
              </button>

              <div style={{display:'grid',gap:7}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontWeight:850,color:'#243447'}}>
                  <span>{receiptUploaded?'✓ Receipt Uploaded':'Upload Receipt'}</span>
                  <small>{receiptUploaded?'Select again to replace':'Optional'}</small>
                </div>
                <input
                  type="file"
                  name="receiptPicker"
                  accept="image/*"
                  multiple
                  aria-label="Upload Receipt"
                  disabled={busy!==''||Boolean(state?.closed)}
                  onChange={(event)=>void uploadReceipt(Array.from(event.target.files||[]).slice(0,3))}
                  style={{width:'100%',minHeight:68,padding:'14px',border:'1px solid #cbd5dd',borderRadius:12,background:'#fff',color:'#172033',fontSize:16,boxSizing:'border-box'}}
                />
                {busy==='receipt'&&<small style={{color:'#64748b'}}>Uploading receipt...</small>}
              </div>

              <button
                type="button"
                className={`easy-button ${rolling?'orange':''}`}
                disabled={busy!==''||!arrived||rolling||Boolean(state?.closed)}
                onClick={()=>void action('rolling')}
                style={{width:'100%',minHeight:68,fontSize:18,justifyContent:'space-between'}}
              >
                <span>{busy==='rolling'?'Sending Update...':rolling?'✓ Repair Finished / Rolling':'Repair Finished / Rolling'}</span>
                {rolling&&<small>{formatTime(state?.rollingAt||null)}</small>}
              </button>
            </div>

            {!arrived&&(
              <p className="easy-section-copy" style={{marginTop:12}}>Repair Finished / Rolling becomes available after you tap Tech Has Arrived. Receipt upload is optional.</p>
            )}

            {message&&<div className="easy-notice" style={{marginTop:16}}>{message}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
