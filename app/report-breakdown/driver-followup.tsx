'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  receipt:{uploaded:boolean;aiStatus:string;reviewStatus:string};
};

type Props={breakdownId:number;token:string;onReportAnother:()=>void};

function completed(value:string|null){return Boolean(value);}

function formatTime(value:string|null){
  if(!value)return'';
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?'':parsed.toLocaleString();
}

export default function DriverFollowup({breakdownId,token,onReportAnother}:Props){
  const [state,setState]=useState<DriverFollowupState|null>(null);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const receiptInputRef=useRef<HTMLInputElement>(null);

  const load=useCallback(async()=>{
    try{
      const params=new URLSearchParams({breakdownId:String(breakdownId),token});
      const response=await fetch(`/api/breakdowns/driver?${params.toString()}`,{cache:'no-store'});
      const payload=await response.json() as {breakdown?:DriverFollowupState;error?:string};
      if(!response.ok||!payload.breakdown)throw new Error(payload.error||'Breakdown follow-up could not be loaded.');
      setState(payload.breakdown);
      setMessage('');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Breakdown follow-up could not be loaded.');
    }
  },[breakdownId,token]);

  useEffect(()=>{void load();},[load]);

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
        setMessage('Rolling recorded. Returning to the breakdown page...');
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
    setMessage('');
    try{
      const form=new FormData();
      form.set('breakdownId',String(breakdownId));
      form.set('token',token);
      for(const file of files.slice(0,3))form.append('receipt',file);
      const response=await fetch('/api/breakdowns/driver',{method:'POST',body:form});
      const payload=await response.json() as {breakdown?:DriverFollowupState;error?:string};
      if(!response.ok||!payload.breakdown)throw new Error(payload.error||'Receipt could not be uploaded.');
      setState(payload.breakdown);
      setMessage(payload.breakdown.receipt.aiStatus==='read'
        ?'Receipt uploaded and read. Northern will verify it before closing the breakdown.'
        :'Receipt uploaded. Northern has the original receipt and will review it before closing.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Receipt could not be uploaded.');
    }finally{
      setBusy('');
      if(receiptInputRef.current)receiptInputRef.current.value='';
    }
  }

  const arrived=completed(state?.techArrivedAt||null);
  const rolling=completed(state?.rollingAt||null);
  const receiptUploaded=Boolean(state?.receipt.uploaded);

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
            <p className="easy-section-copy">This is your breakdown update screen. Use the three buttons below while you are stopped.</p>

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

              <input
                ref={receiptInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                aria-label="Upload Receipt"
                onChange={(event)=>void uploadReceipt(Array.from(event.target.files||[]).slice(0,3))}
                style={{display:'none'}}
              />
              <button
                type="button"
                className={`easy-button ${receiptUploaded?'orange':''}`}
                disabled={busy!==''||Boolean(state?.closed)}
                onClick={()=>receiptInputRef.current?.click()}
                style={{width:'100%',minHeight:68,fontSize:18,justifyContent:'space-between'}}
              >
                <span>{busy==='receipt'?'Uploading & Reading...':receiptUploaded?'✓ Receipt Uploaded':'Upload Receipt'}</span>
                <small>{receiptUploaded?'Tap to replace':'Optional'}</small>
              </button>

              <button
                type="button"
                className={`easy-button ${rolling?'orange':''}`}
                disabled={busy!==''||!arrived||rolling||Boolean(state?.closed)}
                onClick={()=>void action('rolling')}
                style={{width:'100%',minHeight:68,fontSize:18,justifyContent:'space-between'}}
              >
                <span>{busy==='rolling'?'Sending Update...':rolling?'✓ Rolling':'Rolling'}</span>
                {rolling&&<small>{formatTime(state?.rollingAt||null)}</small>}
              </button>
            </div>

            {!arrived&&(
              <p className="easy-section-copy" style={{marginTop:12}}>Rolling becomes available after you tap Tech Has Arrived. Receipt upload is optional.</p>
            )}

            {message&&<div className="easy-notice" style={{marginTop:16}}>{message}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
