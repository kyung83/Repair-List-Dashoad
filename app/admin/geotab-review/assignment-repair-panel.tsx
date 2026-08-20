"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Assignment = {
  assignmentId:number;
  equipmentId:number;
  unit:string;
  equipmentType:string;
  equipmentVin:string;
  equipmentActive:boolean;
  archivedAt:string|null;
  geotabDeviceId:string;
  serialNumber:string;
  geotabName:string;
  vinSeen:string;
  assignedAt:string;
  lastSeenAt:string;
};

type Target = {
  id:number;
  unit:string;
  equipmentType:string;
  vin:string;
  currentDeviceId:string;
  currentDeviceName:string;
};

type SearchPayload = { assignments?:Assignment[]; targets?:Target[]; error?:string };

function when(value:string){
  if(!value)return "—";
  const date=new Date(value.includes("T")?value:`${value.replace(" ","T")}Z`);
  return Number.isNaN(date.getTime())?value:date.toLocaleString();
}

export default function GeotabAssignmentRepairPanel(){
  const[sourceQuery,setSourceQuery]=useState("");
  const[targetQuery,setTargetQuery]=useState("");
  const[assignments,setAssignments]=useState<Assignment[]>([]);
  const[targets,setTargets]=useState<Target[]>([]);
  const[selected,setSelected]=useState<Assignment|null>(null);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState("");

  async function sourceSearch(query=sourceQuery){
    const q=query.trim();
    if(!q){setMessage('Enter a unit, VIN, Geotab device ID, device name, or serial number.');return;}
    setBusy('source');setMessage('');
    try{
      const response=await fetch(`/api/admin/geotab-assignment?q=${encodeURIComponent(q)}`,{cache:'no-store'});
      const result=await response.json() as SearchPayload;
      if(response.status===401){window.location.assign('/login?returnTo=/admin/geotab-review');return;}
      if(!response.ok)throw new Error(result.error||'Current Geotab assignments could not be searched.');
      setAssignments(result.assignments||[]);
      if((result.assignments||[]).length===0)setMessage('No current Geotab assignment matched that search.');
    }catch(error){setMessage(error instanceof Error?error.message:'Current Geotab assignments could not be searched.');}finally{setBusy('');}
  }

  async function targetSearch(){
    const q=targetQuery.trim();
    if(!q){setMessage('Enter the correct unit number or VIN.');return;}
    setBusy('target');setMessage('');
    try{
      const response=await fetch(`/api/admin/geotab-assignment?targetQ=${encodeURIComponent(q)}`,{cache:'no-store'});
      const result=await response.json() as SearchPayload;
      if(!response.ok)throw new Error(result.error||'Target units could not be searched.');
      setTargets(result.targets||[]);
      if((result.targets||[]).length===0)setMessage('No active Master Equipment unit matched that search.');
    }catch(error){setMessage(error instanceof Error?error.message:'Target units could not be searched.');}finally{setBusy('');}
  }

  async function move(target:Target){
    if(!selected)return;
    if(target.id===selected.equipmentId){setMessage(`${selected.unit} is already the current assignment.`);return;}
    if(target.currentDeviceId&&target.currentDeviceId!==selected.geotabDeviceId){
      setMessage(`${target.unit} already has another Geotab device. Change that assignment first.`);return;
    }
    const deviceLabel=selected.geotabName||selected.geotabDeviceId;
    if(!window.confirm(`Move Geotab device ${deviceLabel} from ${selected.unit} to ${target.unit}?\n\nThis ends the old current assignment and keeps it in assignment history. It does not merge or delete either equipment record.`))return;
    setBusy(`move-${target.id}`);setMessage('');
    try{
      const response=await fetch('/api/admin/geotab-assignment',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          action:'reassign',
          geotabDeviceId:selected.geotabDeviceId,
          sourceEquipmentId:selected.equipmentId,
          targetEquipmentId:target.id,
        }),
      });
      const result=await response.json() as{ok?:boolean;message?:string;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||'Geotab device could not be reassigned.');
      setMessage(result.message||`${deviceLabel} moved to ${target.unit}.`);
      setSelected(null);setAssignments([]);setTargets([]);setSourceQuery(target.unit);setTargetQuery('');
      await sourceSearch(target.unit);
    }catch(error){setMessage(error instanceof Error?error.message:'Geotab device could not be reassigned.');}finally{setBusy('');}
  }

  useEffect(()=>{
    const initial=new URL(window.location.href).searchParams.get('assignment')?.trim()||'';
    if(initial){setSourceQuery(initial);void sourceSearch(initial);}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  return <section id="geotab-assignment-repair" style={{background:'#f3f5f7',padding:'0 clamp(16px,4vw,46px) 16px',color:'#182331'}}>
    <div style={{background:'#fff',border:'1px solid #cfd9e1',borderRadius:14,padding:18,boxShadow:'0 2px 10px rgba(15,32,48,.05)'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:18,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{maxWidth:900}}>
          <div style={{fontSize:11,fontWeight:950,letterSpacing:'.12em',color:'#556c7f'}}>DIAGNOSTICS · DEVICE ASSIGNMENT</div>
          <h2 style={{margin:'6px 0 0',fontSize:23,color:'#102238'}}>Correct a Geotab device attached to the wrong unit</h2>
          <p style={copy}>Search the current assignment, choose the device, then select the correct Master Equipment unit. The old assignment is ended and preserved in history; the equipment records themselves are not merged or deleted.</p>
        </div>
      </div>

      {message&&<div style={notice}>{message}</div>}

      <div style={{display:'grid',gridTemplateColumns:'minmax(320px,1fr) minmax(320px,1fr)',gap:16,marginTop:16,alignItems:'start'}}>
        <div style={card}>
          <div><strong style={{fontSize:16}}>1. Find the device where it is attached now</strong><p style={small}>Search by unit number, VIN, Geotab device ID, device name, or serial number.</p></div>
          <div style={searchRow}><input value={sourceQuery} onChange={event=>setSourceQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void sourceSearch();}} placeholder="Example: 53281 or 301 (DC)" style={input}/><button type="button" disabled={Boolean(busy)} onClick={()=>void sourceSearch()}>{busy==='source'?'Searching…':'Search'}</button></div>
          <div style={{display:'grid',gap:8}}>{assignments.map(row=>{
            const active=selected?.assignmentId===row.assignmentId;
            return <button key={row.assignmentId} type="button" onClick={()=>{setSelected(row);setTargets([]);setTargetQuery('');setMessage('');}} style={{...resultButton,borderColor:active?'#557991':'#dce3e8',background:active?'#eef5f9':'white'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}><strong>{row.unit}</strong><span style={devicePill}>{row.geotabName||'Geotab device'}</span></div>
              <div style={mono}>{row.geotabDeviceId}</div>
              <div style={meta}>{[row.serialNumber&&`serial ${row.serialNumber}`,row.equipmentVin&&`unit VIN ${row.equipmentVin}`,row.archivedAt?'ARCHIVED':!row.equipmentActive?'INACTIVE':'active'].filter(Boolean).join(' · ')}</div>
            </button>;
          })}</div>
        </div>

        <div style={{...card,opacity:selected?1:.64}}>
          <div><strong style={{fontSize:16}}>2. Move it to the correct unit</strong>{selected?<p style={small}><strong>{selected.geotabName||selected.geotabDeviceId}</strong> is currently attached to <strong>{selected.unit}</strong> since {when(selected.assignedAt)}.</p>:<p style={small}>Choose a current assignment on the left first.</p>}</div>
          <div style={searchRow}><input disabled={!selected} value={targetQuery} onChange={event=>setTargetQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&selected)void targetSearch();}} placeholder="Correct unit number or VIN" style={input}/><button type="button" disabled={!selected||Boolean(busy)} onClick={()=>void targetSearch()}>{busy==='target'?'Searching…':'Find unit'}</button></div>
          <div style={{display:'grid',gap:8}}>{targets.map(row=>{
            const same=row.id===selected?.equipmentId;
            const occupied=Boolean(row.currentDeviceId&&selected&&row.currentDeviceId!==selected.geotabDeviceId);
            return <div key={row.id} style={targetCard}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start',flexWrap:'wrap'}}>
                <div><strong>{row.unit}</strong><div style={meta}>{[row.equipmentType,row.vin&&`VIN ${row.vin}`].filter(Boolean).join(' · ')||`equipment #${row.id}`}</div>{occupied&&<div style={{marginTop:4,color:'#a04432',fontSize:11,fontWeight:800}}>Already has {row.currentDeviceName||row.currentDeviceId}</div>}</div>
                <button type="button" disabled={same||occupied||Boolean(busy)} onClick={()=>void move(row)} style={same||occupied?undefined:primary}>{same?'Current unit':busy===`move-${row.id}`?'Moving…':'Move device here'}</button>
              </div>
            </div>;
          })}</div>
        </div>
      </div>

      <div style={{marginTop:14,padding:'10px 12px',borderRadius:9,background:'#f7f9fa',border:'1px solid #e0e6ea',fontSize:12,color:'#607180',lineHeight:1.5}}>
        <strong>Safety rule:</strong> if the target unit already has a different current Geotab device, this tool will not silently swap them. Correct that device first, then move this one. This prevents one fix from creating a second bad assignment.
      </div>
    </div>
  </section>;
}

const copy:CSSProperties={margin:'7px 0 0',color:'#5b6d7b',lineHeight:1.55,fontSize:14};
const small:CSSProperties={margin:'6px 0 0',color:'#6a7985',lineHeight:1.45,fontSize:12};
const card:CSSProperties={padding:14,border:'1px solid #dce3e8',borderRadius:11,background:'#fbfcfd',display:'grid',gap:11};
const searchRow:CSSProperties={display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:8};
const input:CSSProperties={minHeight:40,padding:'0 10px',border:'1px solid #cbd5dd',borderRadius:8,background:'white',color:'#172536',fontSize:13};
const resultButton:CSSProperties={display:'grid',gap:4,textAlign:'left',padding:11,border:'1px solid #dce3e8',borderRadius:9,color:'#1d2f41',cursor:'pointer'};
const targetCard:CSSProperties={padding:11,border:'1px solid #dce3e8',borderRadius:9,background:'white'};
const mono:CSSProperties={fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontSize:11,color:'#607180',wordBreak:'break-all'};
const meta:CSSProperties={fontSize:11,color:'#778590',marginTop:3};
const devicePill:CSSProperties={fontSize:10,fontWeight:850,color:'#38586f',background:'#edf4f8',border:'1px solid #d2e1ea',padding:'3px 6px',borderRadius:999,maxWidth:210,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'};
const notice:CSSProperties={marginTop:12,padding:'10px 11px',border:'1px solid #d8c17b',borderRadius:8,background:'#fffdf2',fontSize:13};
const primary:CSSProperties={border:0,borderRadius:7,padding:'8px 11px',background:'#0d1b2b',color:'white',fontWeight:900};
