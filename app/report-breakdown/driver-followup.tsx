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
  const [receiptFiles,setReceiptFiles]=useState<File[]>([]);

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

  async function action(name:'tech_arrived'|'repair_finished'|'rolling'){
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
      setMessage(name==='tech_arrived'?'Tech arrival recorded.':name==='repair_finished'?'Repair finished recorded.':'Rolling recorded. Northern will review and close the breakdown.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Breakdown status could not be updated.');
    }finally{setBusy('');}
  }

  async function uploadReceipt(){
    if(!receiptFiles.length){setMessage('Choose a receipt image first.');return;}
    setBusy('receipt');
    setMessage('');
    try{
      const form=new FormData();
      form.set('breakdownId',String(breakdownId));
      form.set('token',token);
      for(const file of receiptFiles.slice(0,3))form.append('receipt',file);
      const response=await fetch('/api/breakdowns/driver',{method:'POST',body:form});
      const payload=await response.json() as {breakdown?:DriverFollowupState;error?:string};
      if(!response.ok||!payload.breakdown)throw new Error(payload.error||'Receipt could not be uploaded.');
      setState(payload.breakdown);
      setReceiptFiles([]);
      setMessage(payload.breakdown.receipt.aiStatus==='read'
        ?'Receipt uploaded and read. Northern will verify it before closing the breakdown.'
        :'Receipt uploaded. Northern has the original receipt and will review it before closing.');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Receipt could not be uploaded.');
    }finally{setBusy('');}
  }

  const arrived=completed(state?.techArrivedAt||null);
  const repaired=completed(state?.repairFinishedAt||null);
  const rolling=completed(state?.rollingAt||null);

  return(
    <main className="easy-page">
      <div className="easy-page-narrow" style={{maxWidth:760}}>
        <section className="easy-card" style={{overflow:'hidden'}}>
          <div style={{padding:26,background:'#0d1b2b',color:'#fff'}}>
            <p className="easy-eyebrow">ROADSIDE BREAKDOWN</p>
            <h1 style={{margin:'8px 0 0',fontSize:32}}>Breakdown #{breakdownId}</h1>
            <p style={{margin:'10px 0 0',color:'#c5d0da',lineHeight:1.5}}>
              {state?`${state.equipmentType==='trailer'?'Trailer':'Truck'} ${state.unit} · ${state.driverName}`:'Your report is saved.'}
            </p>
          </div>

          <div className="easy-card-body">
            <h2 className="easy-section-title">Keep us updated</h2>
            <p className="easy-section-copy">Tap each button as the roadside repair progresses. You can leave this page open or come back to it on this phone.</p>

            <div style={{display:'grid',gap:12,marginTop:18}}>
              <button type="button" className={`easy-button ${arrived?'orange':''}`} disabled={busy!==''||arrived||Boolean(state?.closed)} onClick={()=>void action('tech_arrived')} style={{minHeight:62,fontSize:17,justifyContent:'space-between'}}>
                <span>{arrived?'✓ Tech Has Arrived':'Tech Has Arrived'}</span>
                {arrived&&<small>{formatTime(state?.techArrivedAt||null)}</small>}
              </button>
              <button type="button" className={`easy-button ${repaired?'orange':''}`} disabled={busy!==''||!arrived||repaired||Boolean(state?.closed)} onClick={()=>void action('repair_finished')} style={{minHeight:62,fontSize:17,justifyContent:'space-between'}}>
                <span>{repaired?'✓ Repair Finished':'Repair Finished'}</span>
                {repaired&&<small>{formatTime(state?.repairFinishedAt||null)}</small>}
              </button>
              <button type="button" className={`easy-button ${rolling?'orange':''}`} disabled={busy!==''||!repaired||rolling||Boolean(state?.closed)} onClick={()=>void action('rolling')} style={{minHeight:62,fontSize:17,justifyContent:'space-between'}}>
                <span>{rolling?'✓ Rolling':'Rolling'}</span>
                {rolling&&<small>{formatTime(state?.rollingAt||null)}</small>}
              </button>
            </div>

            <section style={{marginTop:22,padding:16,border:'1px solid #dfe6ee',borderRadius:12,background:'#f8fafc'}}>
              <p className="easy-eyebrow">OPTIONAL RECEIPT</p>
              <p className="easy-section-copy" style={{marginTop:6}}>If the shop gives you a receipt, upload a clear picture here. Northern&apos;s invoice reader will read it, then the office will verify the original before closing the breakdown.</p>
              {state?.receipt.uploaded?(
                <div className="easy-notice" style={{marginTop:12,borderColor:'#b7d9c4',background:'#f1fbf5',color:'#27623f'}}>
                  ✓ Receipt received{state.receipt.aiStatus==='read'?' and read by the invoice reader':''}. Office review is still required.
                </div>
              ):(
                <>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(event)=>setReceiptFiles(Array.from(event.target.files||[]).slice(0,3))}
                    style={{width:'100%',marginTop:12,padding:12,border:'1px solid #cbd5dd',borderRadius:10,background:'#fff',boxSizing:'border-box'}}
                  />
                  <button type="button" className="easy-button" disabled={busy!==''||!receiptFiles.length} onClick={()=>void uploadReceipt()} style={{width:'100%',marginTop:10,minHeight:48}}>
                    {busy==='receipt'?'Uploading & Reading...':'Upload Receipt'}
                  </button>
                </>
              )}
            </section>

            {rolling&&(
              <div className="easy-notice" style={{marginTop:18,borderColor:'#b7d9c4',background:'#f1fbf5',color:'#27623f'}}>
                <strong>You&apos;re marked Rolling.</strong><br/>The breakdown is now waiting for Northern to review the receipt (if one was uploaded), confirm the repair, and close it.
              </div>
            )}
            {message&&<div className="easy-notice" style={{marginTop:14}}>{message}</div>}

            <div className="easy-actions" style={{marginTop:20}}>
              <button type="button" className="easy-button" onClick={onReportAnother}>Report Another Breakdown</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
