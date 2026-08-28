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

type ReceiptUploadPayload={breakdown?:DriverFollowupState;error?:string};

const RECEIPT_TARGET_BYTES=700_000;
const RECEIPT_MAX_DIMENSION=1600;
const RECEIPT_MIN_DIMENSION=720;
const RECEIPT_QUALITIES=[0.82,0.72,0.62,0.52,0.44,0.36];
const RECEIPT_SERVER_SAFE_TYPES=new Set(['image/jpeg','image/png','image/webp']);

function completed(value:string|null){return Boolean(value);}

function formatTime(value:string|null){
  if(!value)return'';
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?'':parsed.toLocaleString();
}

function canvasJpeg(canvas:HTMLCanvasElement,quality:number){
  return new Promise<Blob>((resolve,reject)=>{
    canvas.toBlob((blob)=>{
      if(blob)resolve(blob);
      else reject(new Error('The receipt photo could not be resized.'));
    },'image/jpeg',quality);
  });
}

function loadReceiptImage(file:File){
  return new Promise<HTMLImageElement>((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const image=new Image();
    image.onload=()=>{
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror=()=>{
      URL.revokeObjectURL(url);
      reject(new Error('This receipt photo could not be prepared for upload. Take or select the photo again.'));
    };
    image.src=url;
  });
}

function receiptBaseName(file:File){
  const base=(file.name||'breakdown-receipt')
    .replace(/\.[^.]+$/,'')
    .replace(/[^a-zA-Z0-9._-]+/g,'-')
    .slice(0,120);
  return base||'breakdown-receipt';
}

async function prepareReceiptFile(file:File){
  const type=String(file.type||'').toLowerCase();
  if(RECEIPT_SERVER_SAFE_TYPES.has(type)&&file.size<=RECEIPT_TARGET_BYTES)return file;

  const image=await loadReceiptImage(file);
  const sourceWidth=image.naturalWidth||image.width;
  const sourceHeight=image.naturalHeight||image.height;
  if(!sourceWidth||!sourceHeight)throw new Error('The receipt photo has no readable dimensions.');

  const initialScale=Math.min(1,RECEIPT_MAX_DIMENSION/Math.max(sourceWidth,sourceHeight));
  let width=Math.max(1,Math.round(sourceWidth*initialScale));
  let height=Math.max(1,Math.round(sourceHeight*initialScale));
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d',{alpha:false});
  if(!context)throw new Error('The receipt photo could not be prepared for upload.');

  let best:Blob|null=null;
  for(let pass=0;pass<4;pass+=1){
    canvas.width=width;
    canvas.height=height;
    context.fillStyle='#fff';
    context.fillRect(0,0,width,height);
    context.drawImage(image,0,0,width,height);

    for(const quality of RECEIPT_QUALITIES){
      const blob=await canvasJpeg(canvas,quality);
      if(!best||blob.size<best.size)best=blob;
      if(blob.size<=RECEIPT_TARGET_BYTES)break;
    }
    if(best&&best.size<=RECEIPT_TARGET_BYTES)break;

    const longest=Math.max(width,height);
    if(longest<=RECEIPT_MIN_DIMENSION)break;
    const nextScale=Math.max(RECEIPT_MIN_DIMENSION/longest,0.8);
    width=Math.max(1,Math.round(width*nextScale));
    height=Math.max(1,Math.round(height*nextScale));
  }

  if(!best)throw new Error('The receipt photo could not be resized.');
  return new File([best],`${receiptBaseName(file)}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
}

async function prepareReceiptFiles(files:File[]){
  const prepared:File[]=[];
  for(const file of files.slice(0,3))prepared.push(await prepareReceiptFile(file));
  return prepared;
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
      if(payload.breakdown.rollingAt||payload.breakdown.closed||payload.breakdown.status==='not_breakdown'||payload.breakdown.status==='complete'){
        onReportAnother();
        return;
      }
      setState(payload.breakdown);
      setMessage('');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Breakdown follow-up could not be loaded.');
    }
  },[breakdownId,token,onReportAnother]);

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
    setMessage('Preparing receipt photo...');
    try{
      const prepared=await prepareReceiptFiles(files);
      const form=new FormData();
      form.set('breakdownId',String(breakdownId));
      form.set('token',token);
      for(const file of prepared)form.append('receipt',file,file.name);

      setMessage('Uploading and reading receipt...');
      const response=await fetch('/api/breakdowns/driver',{method:'POST',body:form});
      const responseText=await response.text();
      let payload:ReceiptUploadPayload={};
      if(responseText){
        try{
          payload=JSON.parse(responseText) as ReceiptUploadPayload;
        }catch{
          if(response.status===413)throw new Error('The receipt photo was still too large to upload. Select it again and retry.');
          throw new Error(`Receipt upload returned an unreadable response (HTTP ${response.status}).`);
        }
      }
      if(!response.ok||!payload.breakdown)throw new Error(payload.error||'Receipt could not be uploaded.');
      setState(payload.breakdown);
      setMessage(payload.breakdown.receipt.aiStatus==='read'
        ?'Receipt uploaded and read. Northern will verify it before closing the breakdown.'
        :'Receipt uploaded. Northern has the receipt and will review it before closing.');
    }catch(error){
      const detail=error instanceof Error?error.message:'Receipt could not be uploaded.';
      setMessage(/string did not match the expected pattern/i.test(detail)
        ?'The phone could not send that receipt photo. Select or take the receipt again and retry.'
        :detail);
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
                accept="image/*"
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
