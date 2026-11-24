'use client';
import {useState} from 'react';
import {parseRollingTime} from '@/lib/breakdown-rolling-motion';

export type RollingReviewEvidence={candidateAt:string;evidenceAt:string;distanceMiles:number;maxSpeedMph:number;durationMinutes:number;deviceId:string};
const button:React.CSSProperties={minHeight:40,padding:'8px 13px',border:'1px solid #c8d3dd',borderRadius:8,background:'#fff',color:'#25384a',fontWeight:850,cursor:'pointer'};
const primary:React.CSSProperties={...button,background:'#2f6f60',borderColor:'#2f6f60',color:'#fff'};
const field:React.CSSProperties={display:'grid',gap:5,fontSize:12,fontWeight:800,color:'#435565'};
const input:React.CSSProperties={width:'100%',boxSizing:'border-box',minHeight:40,padding:8,border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',color:'#25384a'};
function displayTime(value:string){const n=parseRollingTime(value);return Number.isFinite(n)?new Date(n).toLocaleString():value;}
function localInput(value:string){const n=parseRollingTime(value);if(!Number.isFinite(n))return '';const d=new Date(n);return new Date(n-d.getTimezoneOffset()*60_000).toISOString().slice(0,16);}

export default function RollingReviewPanel({breakdownId,reportedAt,evidence,busy,onBusy,onReviewed}:{breakdownId:number;reportedAt:string|null;evidence:RollingReviewEvidence|null;busy:boolean;onBusy:(value:boolean)=>void;onReviewed:()=>void}){
  const [mode,setMode]=useState<'adjust'|'reject'|'manual'|''>('');
  const [when,setWhen]=useState('');
  const [reason,setReason]=useState('');
  const [message,setMessage]=useState('');
  const downtime=evidence&&reportedAt?(parseRollingTime(evidence.candidateAt)-parseRollingTime(reportedAt))/3_600_000:null;
  function open(next:'adjust'|'reject'|'manual'){setMessage('');setReason('');setWhen(evidence?localInput(evidence.candidateAt):'');setMode(next);}
  async function submit(action:'confirm'|'reject'|'manual',adjusted=false){
    setMessage('');
    let rollingAt=evidence?.candidateAt;
    if(adjusted||action==='manual'){
      const ms=Date.parse(when);
      if(!when||!Number.isFinite(ms)){setMessage('Enter the actual date and time the equipment returned to service.');return;}
      rollingAt=new Date(ms).toISOString();
    }
    if((action!=='confirm'||adjusted)&&!reason.trim()){setMessage('Enter the reason for this review.');return;}
    if(action==='confirm'&&!adjusted&&!window.confirm('Confirm this equipment actually returned to service at the suggested time? Travel alone does not prove the repair was completed.'))return;
    onBusy(true);
    try{
      const response=await fetch('/api/breakdowns/rolling-review',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({breakdownId,action,candidateAt:evidence?.candidateAt,rollingAt,reason:reason.trim()})});
      const result=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||'Could not save rolling review.');
      setMode('');setReason('');setMessage('');onReviewed();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not save rolling review.');}
    finally{onBusy(false);}
  }
  return <section style={{display:'grid',gap:10,padding:12,border:evidence?'1px solid #e7c77f':'1px solid #d7ded9',borderRadius:10,background:evidence?'#fff9ec':'#fbfcfb',color:'#263b4e'}}>
    <div><strong style={{fontSize:14,color:evidence?'#875c13':'#263b4e'}}>{evidence?'Geotab Rolling Review — travel detected':'Rolling not confirmed'}</strong>
    <p style={{fontSize:12,margin:'5px 0 0'}}>{evidence?'Verify that the equipment actually returned to service. Towing or moving equipment does not confirm repair completion.':'Geotab checks active breakdowns every 30 minutes. If the driver forgot to press Rolling, office staff can enter the verified return-to-service time.'}</p></div>
    {evidence&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8,fontSize:12}}>
      <div><small>Suggested Rolling time</small><br/><strong>{displayTime(evidence.candidateAt)}</strong></div>
      <div><small>Distance from stopped location</small><br/><strong>{evidence.distanceMiles.toFixed(1)} mi</strong></div>
      <div><small>Peak speed</small><br/><strong>{evidence.maxSpeedMph.toFixed(0)} MPH</strong></div>
      <div><small>Observed movement</small><br/><strong>{evidence.durationMinutes.toFixed(0)} min</strong></div>
      {downtime!==null&&Number.isFinite(downtime)&&downtime>=0&&<div><small>Suggested downtime</small><br/><strong>{downtime.toFixed(1)} hr</strong></div>}
    </div>}
    {!mode&&<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      {evidence?<><button type="button" style={primary} disabled={busy} onClick={()=>void submit('confirm')}>Confirm Rolling</button><button type="button" style={button} disabled={busy} onClick={()=>open('adjust')}>Adjust Time</button><button type="button" style={button} disabled={busy} onClick={()=>open('reject')}>Still Broken Down / Towed</button></>:<button type="button" style={button} disabled={busy} onClick={()=>open('manual')}>Enter Verified Rolling Time</button>}
    </div>}
    {mode&&<div style={{display:'grid',gap:8}}>
      {mode!=='reject'&&<label style={field}>Actual Rolling time (your local time)<input style={input} type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} disabled={busy}/></label>}
      <label style={field}>{mode==='reject'?'Why was this movement not a return to service?':'Reason / how time was verified'}<textarea style={input} maxLength={250} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></label>
      {mode==='reject'&&<small>Leaves the breakdown active. Future travel can be flagged again after a new stop.</small>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" style={primary} disabled={busy||!reason.trim()||(mode!=='reject'&&!when)} onClick={()=>void submit(mode==='reject'?'reject':mode==='manual'?'manual':'confirm',mode==='adjust')}>{busy?'Saving…':mode==='reject'?'Keep Breakdown Open':'Confirm Rolling'}</button><button type="button" style={button} disabled={busy} onClick={()=>{setMode('');setMessage('');}}>Cancel</button></div>
    </div>}
    {message&&<div role="alert" style={{fontSize:12,color:'#9b2c2c'}}>{message}</div>}
  </section>;
}
