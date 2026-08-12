"use client";

import { useEffect, useMemo, useState } from "react";

type ChecklistPhoto = { id:number; fileName:string; contentType:string; createdAt:string; url:string };
type CorrectiveRepair = { id:string; status:string };
type ChecklistItem = { id:number|null; number:number; section:string; text:string; result:"pending"|"pass"|"fail"|"na"; notes:string; photos:ChecklistPhoto[]; correctiveRepair?:CorrectiveRepair|null };
type ChecklistData = { repairId:string; equipmentId:number; unit:string; eventType:"pm"|"annual"; started:boolean; status:"not_started"|"in_progress"|"ready"|"completed"; currentMileage:number|null; mileageSource:"Geotab"|"Manual"; mileageUpdatedAt:string|null; mileageAtStart?:number|null; mileageAtCompletion?:number|null; pendingCount?:number; failedCount?:number; items:ChecklistItem[]; error?:string };
type Props = { repairId:string; canWork:boolean };

function formatMileage(value:number|null|undefined){return value==null?'Not available':`${Number(value).toLocaleString()} mi`;}

export default function MaintenanceChecklistPanel({repairId,canWork}:Props){
  const [data,setData]=useState<ChecklistData|null>(null);
  const [unavailable,setUnavailable]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [notes,setNotes]=useState<Record<number,string>>({});
  const [manualMileage,setManualMileage]=useState("");
  const [currentNumber,setCurrentNumber]=useState<number|null>(null);

  function accept(payload:ChecklistData){
    setData(payload);
    setNotes(Object.fromEntries(payload.items.map(item=>[item.number,item.notes||''])));
    if(payload.mileageSource==='Manual'&&payload.currentMileage!=null)setManualMileage(String(payload.currentMileage));
    setCurrentNumber(current=>{
      if(current&&payload.items.some(item=>item.number===current))return current;
      return payload.items.find(item=>item.result==='pending')?.number??payload.items.find(item=>item.result==='fail')?.number??payload.items[0]?.number??null;
    });
  }

  async function load(){
    const response=await fetch(`/api/maintenance-checklist?repairId=${encodeURIComponent(repairId)}`,{cache:'no-store'});
    const payload=await response.json() as ChecklistData&{error?:string};
    if(!response.ok){if((payload.error||'').includes('only available for scheduled PM and annual')){setUnavailable(true);setData(null);return;}throw new Error(payload.error||'Maintenance checklist could not be loaded.');}
    setUnavailable(false);accept(payload);
  }
  useEffect(()=>{setData(null);setUnavailable(false);setMessage('');setCurrentNumber(null);void load().catch(error=>setMessage(error instanceof Error?error.message:'Maintenance checklist could not be loaded.'));},[repairId]);

  async function postJson(body:Record<string,unknown>){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/maintenance-checklist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,repairId})});
      const payload=await response.json() as ChecklistData&{ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Checklist change failed.');
      accept(payload);return payload;
    }catch(error){setMessage(error instanceof Error?error.message:'Checklist change failed.');return null;}finally{setBusy(false);}
  }

  function nextUnfinished(payload:ChecklistData,after:number){
    const index=payload.items.findIndex(item=>item.number===after);
    const later=payload.items.slice(index+1).find(item=>item.result==='pending'||item.result==='fail');
    const earlier=payload.items.slice(0,index).find(item=>item.result==='pending'||item.result==='fail');
    return later?.number??earlier?.number??after;
  }

  async function setItem(item:ChecklistItem,result=item.result){
    const note=(notes[item.number]??'').trim();
    if(result==='fail'&&!note){setMessage('Describe what is wrong in the note box, then press FAIL again.');return;}
    const payload=await postJson({action:'setItem',itemNumber:item.number,result,notes:note});
    if(!payload)return;
    if(result==='fail'){
      setCurrentNumber(item.number);
      setMessage('Repair created. Fix this item before finishing the inspection. You can add parts to the repair job.');
    }else{
      setCurrentNumber(nextUnfinished(payload,item.number));
      setMessage(result==='pass'&&item.result==='fail'?'Repair marked corrected and the checklist item now passes.':'Saved.');
    }
  }

  async function uploadPhoto(item:ChecklistItem,file:File|null){
    if(!file)return;setBusy(true);setMessage('');
    try{
      const form=new FormData();form.set('action','uploadPhoto');form.set('repairId',repairId);form.set('itemNumber',String(item.number));form.set('photo',file);
      const response=await fetch('/api/maintenance-checklist',{method:'POST',body:form});const payload=await response.json() as ChecklistData&{ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Photo upload failed.');accept(payload);setMessage('Photo saved.');
    }catch(error){setMessage(error instanceof Error?error.message:'Photo upload failed.');}finally{setBusy(false);}
  }
  async function removePhoto(photoId:number){if(!window.confirm('Remove this photo?'))return;await postJson({action:'removePhoto',photoId});}

  if(unavailable||(!data&&!message))return null;
  if(!data)return <div className="easy-notice">{message||'Loading inspection…'}</div>;

  const done=data.items.filter(item=>item.result!=='pending').length;
  const pending=data.pendingCount??data.items.filter(item=>item.result==='pending').length;
  const failed=data.failedCount??data.items.filter(item=>item.result==='fail').length;
  const isReady=data.status==='ready';const isCompleted=data.status==='completed';
  const current=data.items.find(item=>item.number===currentNumber)??data.items.find(item=>item.result==='pending')??data.items.find(item=>item.result==='fail')??data.items[0];
  const currentIndex=Math.max(0,data.items.findIndex(item=>item.number===current?.number));
  const percent=data.items.length?Math.round(done/data.items.length*100):0;
  const heading=data.eventType==='annual'?'Annual Inspection':'PM Inspection';

  return <section className="easy-checklist">
    <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div><p className="easy-eyebrow">STEP-BY-STEP INSPECTION</p><h3 className="easy-section-title" style={{fontSize:26,marginTop:6}}>{heading} — Unit {data.unit||'—'}</h3><p className="easy-section-copy">Do one item at a time. The system saves the record as you go.</p></div>
      <div className="easy-badge green" style={{fontSize:13,minHeight:36}}>{formatMileage(data.currentMileage)} · {data.mileageSource==='Geotab'?'Automatic':'Manual'}</div>
    </div>
    {message&&<div className="easy-notice">{message}</div>}

    {!data.started?<div className="easy-finish" style={{marginTop:16}}><strong style={{display:'block',fontSize:18}}>Ready to begin?</strong><p style={{margin:'6px 0 0'}}>Starting saves the mileage and creates the permanent inspection record.</p>{canWork&&<button className="easy-button orange" style={{marginTop:12}} disabled={busy} onClick={()=>void postJson({action:'startChecklist'})}>Start {data.eventType==='annual'?'Annual':'PM'}</button>}</div>:<>
      <div style={{marginTop:16,display:'flex',justifyContent:'space-between',gap:10,fontSize:13,fontWeight:850,color:'#52616e'}}><span>{done} of {data.items.length} checked</span><span>{percent}%</span></div>
      <div className="easy-progress-track" style={{marginTop:7}}><div className="easy-progress-fill" style={{width:`${percent}%`}}/></div>

      {current&&<div className={`easy-question ${current.result==='fail'?'fail':''}`}>
        <p className="easy-question-number">{current.section} · ITEM {current.number}</p><h4>{current.text}</h4>
        {current.result==='fail'&&<div className="easy-finish blocked"><strong>Repair required before this {data.eventType==='annual'?'Annual':'PM'} can finish.</strong>{current.correctiveRepair&&<div className="easy-actions"><a className="easy-button danger" href={`/shop?repairId=${encodeURIComponent(current.correctiveRepair.id)}`}>Open Repair Job</a><button className="easy-button" disabled={busy||!canWork} onClick={()=>void setItem(current,'pass')}>Mark Repaired & Pass</button></div>}</div>}
        <div className="easy-result-grid">
          <button className={`easy-result pass ${current.result==='pass'?'active':''}`} disabled={busy||!canWork||isCompleted} onClick={()=>void setItem(current,'pass')}>PASS</button>
          <button className={`easy-result fail ${current.result==='fail'?'active':''}`} disabled={busy||!canWork||isCompleted} onClick={()=>void setItem(current,'fail')}>FAIL</button>
          <button className={`easy-result na ${current.result==='na'?'active':''}`} disabled={busy||!canWork||isCompleted} onClick={()=>void setItem(current,'na')}>N/A</button>
        </div>
        <textarea className="easy-note" value={notes[current.number]??''} onChange={event=>setNotes(value=>({...value,[current.number]:event.target.value}))} disabled={!canWork||isCompleted} placeholder={current.result==='fail'?'Describe what is wrong and what was repaired.':'Notes are optional unless the item fails.'}/>
        {canWork&&!isCompleted&&<div className="easy-photo-line"><button className="easy-button" style={{minHeight:40}} disabled={busy} onClick={()=>void setItem(current)}>Save Note</button><label className="easy-button" style={{minHeight:40}}>Take / Add Photo<input type="file" accept="image/*" capture="environment" disabled={busy} style={{display:'none'}} onChange={event=>{const file=event.target.files?.[0]??null;void uploadPhoto(current,file);event.currentTarget.value='';}}/></label>{current.photos.map(photo=><div className="easy-photo-thumb" key={photo.id}><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Item ${current.number}`}/></a><button className="easy-photo-remove" disabled={busy} onClick={()=>void removePhoto(photo.id)}>×</button></div>)}</div>}
      </div>}

      <div className="easy-check-nav"><button className="easy-button" disabled={currentIndex<=0} onClick={()=>setCurrentNumber(data.items[currentIndex-1]?.number??null)}>← Previous</button><span style={{color:'#6b7784',fontSize:13}}>Item {currentIndex+1} of {data.items.length}</span><button className="easy-button" disabled={currentIndex>=data.items.length-1} onClick={()=>setCurrentNumber(data.items[currentIndex+1]?.number??null)}>Next →</button></div>
      <details className="easy-review"><summary>Review all checklist answers</summary><div className="easy-chip-grid">{data.items.map(item=><button key={item.number} className={`easy-chip ${item.result}`} onClick={()=>setCurrentNumber(item.number)} title={`${item.section}: ${item.text}`}>{item.number}</button>)}</div></details>

      {data.mileageSource==='Manual'&&data.eventType==='pm'&&!isCompleted&&<div style={{marginTop:16,maxWidth:360}}><label style={{display:'grid',gap:6,fontWeight:900,color:'#52616e',fontSize:13}}>Current mileage<input className="easy-search-input" type="number" min="0" step="1" value={manualMileage} onChange={event=>setManualMileage(event.target.value)} disabled={!canWork||busy}/></label></div>}

      {!isCompleted&&!isReady&&<div className={`easy-finish ${failed>0?'blocked':''}`}>
        {pending>0?<><strong>{pending} inspection item{pending===1?'':'s'} still need an answer.</strong><p style={{margin:'5px 0 0'}}>Finish those before closing the job.</p></>:failed>0?<><strong>{failed} failed item{failed===1?'':'s'} still need repair.</strong><p style={{margin:'5px 0 0'}}>Open each repair, attach parts/labor as needed, fix it, then change the checklist item to Pass.</p></>:<><strong>Inspection is complete.</strong><p style={{margin:'5px 0 10px'}}>Everything passed or was marked N/A. This unlocks the maintenance work order for completion.</p>{canWork&&<button className="easy-button primary" disabled={busy} onClick={()=>void postJson({action:'markReady',...(data.mileageSource==='Manual'&&data.eventType==='pm'?{mileage:manualMileage}:{})})}>Finish Inspection</button>}</>}
      </div>}
      {isReady&&<div className="easy-finish"><strong>Inspection complete.</strong><p style={{margin:'5px 0 0'}}>Complete the job in Shop Jobs. The maintenance history and next schedule update automatically.</p></div>}
      {isCompleted&&<div className="easy-finish"><strong>{heading} completed.</strong><p style={{margin:'5px 0 0'}}>The permanent record is saved.</p>{data.eventType==='annual'&&<div className="easy-actions"><a className="easy-button orange" href={`/annual-inspections/print?repairId=${encodeURIComponent(data.repairId)}`}>Print Annual Form</a></div>}</div>}
    </>}
  </section>;
}
