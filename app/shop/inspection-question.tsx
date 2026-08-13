"use client";
import type {ChecklistItem} from './maintenance-types';

type Props={item:ChecklistItem;note:string;busy:boolean;canWork:boolean;completed:boolean;eventType:'pm'|'annual';onNote:(value:string)=>void;onResult:(item:ChecklistItem,result:ChecklistItem['result'])=>void;onSave:(item:ChecklistItem)=>void;onPhoto:(item:ChecklistItem,file:File|null)=>void;onRemovePhoto:(id:number)=>void};
const repaired=(item:ChecklistItem)=>Boolean(item.correctiveRepair?.status.toLowerCase().includes('complete'));

export default function InspectionQuestion({item,note,busy,canWork,completed,eventType,onNote,onResult,onSave,onPhoto,onRemovePhoto}:Props){
 return <div className={`easy-question ${item.result==='fail'?'fail':''}`}>
  <p className="easy-question-number">{item.section} · ITEM {item.number}</p><h4>{item.text}</h4>
  {item.result==='fail'&&<div className="easy-finish blocked"><strong>Repair created. Keep inspecting and fix it at the end.</strong><p style={{margin:'5px 0 0'}}>This repair must be completed before the {eventType==='annual'?'Annual':'PM'} can finish.</p>{item.correctiveRepair&&<div className="easy-actions"><a className="easy-button danger" href={`/shop?repairId=${encodeURIComponent(item.correctiveRepair.id)}`}>Open Repair Job</a>{repaired(item)&&<button className="easy-button primary" disabled={busy||!canWork} onClick={()=>onResult(item,'pass')}>Verify Fixed & Pass</button>}</div>}</div>}
  <div className="easy-result-grid">
   <button className={`easy-result pass ${item.result==='pass'?'active':''}`} disabled={busy||!canWork||completed} onClick={()=>onResult(item,'pass')}>PASS</button>
   <button className={`easy-result fail ${item.result==='fail'?'active':''}`} disabled={busy||!canWork||completed} onClick={()=>onResult(item,'fail')}>FAIL</button>
   <button className={`easy-result na ${item.result==='na'?'active':''}`} disabled={busy||!canWork||completed} onClick={()=>onResult(item,'na')}>N/A</button>
  </div>
  <textarea className="easy-note" value={note} onChange={event=>onNote(event.target.value)} disabled={!canWork||completed} placeholder={item.result==='fail'?'Describe what is wrong. Repair work is handled in the repair job.':'Notes are optional unless the item fails.'}/>
  {canWork&&!completed&&<div className="easy-photo-line"><button className="easy-button" style={{minHeight:40}} disabled={busy} onClick={()=>onSave(item)}>Save Note</button><label className="easy-button" style={{minHeight:40}}>Take / Add Photo<input type="file" accept="image/*" capture="environment" disabled={busy} style={{display:'none'}} onChange={event=>{const file=event.target.files?.[0]??null;onPhoto(item,file);event.currentTarget.value='';}}/></label>{item.photos.map(photo=><div className="easy-photo-thumb" key={photo.id}><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Item ${item.number}`}/></a><button className="easy-photo-remove" disabled={busy} onClick={()=>onRemovePhoto(photo.id)}>×</button></div>)}</div>}
 </div>;
}
