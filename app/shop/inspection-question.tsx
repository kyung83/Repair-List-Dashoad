"use client";

import {useEffect,useState} from 'react';
import type {ChecklistItem} from './maintenance-types';

type Props={item:ChecklistItem;note:string;busy:boolean;canWork:boolean;completed:boolean;eventType:'pm'|'annual';onNote:(value:string)=>void;onResult:(item:ChecklistItem,result:ChecklistItem['result'])=>void;onSave:(item:ChecklistItem)=>void;onPhoto:(item:ChecklistItem,file:File|null)=>void;onRemovePhoto:(id:number)=>void};
type Rules={allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string;measurementValue:string};

const defaultRules:Rules={allowPass:true,allowFail:true,allowNa:true,requireNotes:false,requirePhoto:false,requireMeasurement:false,measurementLabel:'',measurementUnit:'',measurementValue:''};
const repaired=(item:ChecklistItem)=>Boolean(item.correctiveRepair?.status.toLowerCase().includes('complete'));

export default function InspectionQuestion({item,note,busy,canWork,completed,eventType,onNote,onResult,onSave,onPhoto,onRemovePhoto}:Props){
  const fixed=repaired(item),lockedFailure=item.result==='fail'&&!fixed;
  const[rules,setRules]=useState<Rules>(defaultRules);
  const[measurement,setMeasurement]=useState('');
  const[localMessage,setLocalMessage]=useState('');
  const[fieldBusy,setFieldBusy]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    setRules(defaultRules);
    setMeasurement('');
    setLocalMessage('');
    if(item.id==null)return()=>{cancelled=true};
    void fetch(`/api/maintenance-checklist-item?itemId=${encodeURIComponent(String(item.id))}`,{cache:'no-store'})
      .then(async response=>{
        const payload=await response.json() as Rules&{error?:string};
        if(!response.ok)throw new Error(payload.error||'Checklist requirements could not be loaded.');
        return payload;
      })
      .then(payload=>{if(!cancelled){setRules(payload);setMeasurement(payload.measurementValue||'')}})
      .catch(error=>{if(!cancelled)setLocalMessage(error instanceof Error?error.message:'Checklist requirements could not be loaded.')});
    return()=>{cancelled=true};
  },[item.id]);

  async function saveMeasurement(){
    if(item.id==null||(!rules.measurementLabel&&!rules.requireMeasurement))return true;
    const value=measurement.trim();
    if(rules.requireMeasurement&&!value){setLocalMessage(`${rules.measurementLabel||'Measurement'} is required.`);return false}
    if(value&&!Number.isFinite(Number(value))){setLocalMessage('Enter a valid numeric measurement.');return false}
    setFieldBusy(true);setLocalMessage('');
    try{
      const response=await fetch('/api/maintenance-checklist-item',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'setMeasurement',itemId:item.id,measurementValue:value})});
      const payload=await response.json() as Rules&{ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Measurement could not be saved.');
      setRules(payload);setMeasurement(payload.measurementValue||'');
      return true;
    }catch(error){setLocalMessage(error instanceof Error?error.message:'Measurement could not be saved.');return false}
    finally{setFieldBusy(false)}
  }

  async function choose(result:ChecklistItem['result']){
    if(result==='pass'&&!rules.allowPass){setLocalMessage('Pass is not allowed for this item.');return}
    if(result==='fail'&&!rules.allowFail){setLocalMessage('Fail is not allowed for this item.');return}
    if(result==='na'&&!rules.allowNa){setLocalMessage('N/A is not allowed for this item.');return}
    if(rules.requireNotes&&!note.trim()){setLocalMessage('Add the required note before answering this item.');return}
    if(result==='fail'&&!note.trim()){setLocalMessage('Describe what is wrong before marking this item Fail.');return}
    if(rules.requirePhoto&&item.photos.length===0){setLocalMessage('Add the required photo before answering this item.');return}
    if(!await saveMeasurement())return;
    setLocalMessage('');
    onResult(item,result);
  }

  const disabled=busy||fieldBusy||!canWork||completed;
  const measurementVisible=Boolean(rules.measurementLabel||rules.requireMeasurement);
  const requirementBits=[rules.requireNotes?'Note required':'',rules.requirePhoto?'Photo required':'',rules.requireMeasurement?'Measurement required':''].filter(Boolean);

  return <div className={`easy-question ${item.result==='fail'?'fail':''}`}>
    <p className="easy-question-number">{item.section} - ITEM {item.number}</p>
    <h4>{item.text}</h4>
    {requirementBits.length>0&&<div style={{margin:'8px 0',fontSize:12,fontWeight:900,color:'#7a4d12'}}>{requirementBits.join(' · ')}</div>}
    {localMessage&&<div className="easy-notice" style={{margin:'10px 0'}}>{localMessage}</div>}
    {item.result==='fail'&&<div className="easy-finish blocked"><strong>Repair created. Keep inspecting.</strong><p style={{margin:'5px 0 0'}}>Do not stop the {eventType==='annual'?'Annual':'PM'} labor timer. Fix this from the Repairs Found section after the questions are done.</p>{fixed&&<div className="easy-actions"><button className="easy-button primary" disabled={disabled||!rules.allowPass} onClick={()=>void choose('pass')}>Verify Fixed and Pass</button></div>}</div>}
    <div className="easy-result-grid">
      {rules.allowPass&&<button className={`easy-result pass ${item.result==='pass'?'active':''}`} disabled={disabled||lockedFailure} onClick={()=>void choose('pass')}>PASS</button>}
      {rules.allowFail&&<button className={`easy-result fail ${item.result==='fail'?'active':''}`} disabled={disabled} onClick={()=>void choose('fail')}>FAIL</button>}
      {rules.allowNa&&<button className={`easy-result na ${item.result==='na'?'active':''}`} disabled={disabled||lockedFailure} onClick={()=>void choose('na')}>N/A</button>}
    </div>
    {measurementVisible&&<label style={{display:'grid',gap:6,margin:'12px 0',fontWeight:900,color:'#52616e',fontSize:13}}>{rules.measurementLabel||'Measurement'}{rules.requireMeasurement?' *':''}<div style={{display:'flex',alignItems:'center',gap:8}}><input className="easy-search-input" style={{maxWidth:220}} type="number" inputMode="decimal" step="any" value={measurement} onChange={event=>setMeasurement(event.target.value)} disabled={!canWork||completed||fieldBusy} placeholder="Enter measurement"/>{rules.measurementUnit&&<strong>{rules.measurementUnit}</strong>}</div></label>}
    <textarea className="easy-note" value={note} onChange={event=>onNote(event.target.value)} disabled={!canWork||completed} placeholder={item.result==='fail'?'Describe what is wrong. The repair will be worked at the end under the same PM/Annual labor.':rules.requireNotes?'Required note':'Notes are optional unless the item fails.'}/>
    {canWork&&!completed&&<div className="easy-photo-line"><button className="easy-button" style={{minHeight:40}} disabled={busy||fieldBusy} onClick={()=>onSave(item)}>Save Note</button><label className="easy-button" style={{minHeight:40,borderColor:rules.requirePhoto&&item.photos.length===0?'#f47b20':undefined}}>Take / Add Photo{rules.requirePhoto?' *':''}<input type="file" accept="image/*" capture="environment" disabled={busy||fieldBusy} style={{display:'none'}} onChange={event=>{const file=event.target.files?.[0]??null;onPhoto(item,file);event.currentTarget.value='';}}/></label>{item.photos.map(photo=><div className="easy-photo-thumb" key={photo.id}><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Item ${item.number}`}/></a><button className="easy-photo-remove" disabled={busy||fieldBusy} onClick={()=>onRemovePhoto(photo.id)}>x</button></div>)}</div>}
  </div>
}
