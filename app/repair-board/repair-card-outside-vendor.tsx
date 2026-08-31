'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Repair={id:string;unit:string;issue:string;status:string;source:string;equipmentId:number|null};
type Vendor={id:number;name:string;phone:string};
type BoardPayload={canManage?:boolean;repairs?:Repair[];error?:string};
type OutsidePayload={vendors?:Vendor[];ok?:boolean;error?:string;message?:string};

function normalize(value:string){return value.replace(/\s+/g,' ').trim().toLowerCase();}

export default function RepairCardOutsideVendor(){
  const[repairs,setRepairs]=useState<Repair[]>([]);
  const[vendors,setVendors]=useState<Vendor[]>([]);
  const[canManage,setCanManage]=useState(false);
  const[selected,setSelected]=useState<Repair|null>(null);
  const[vendorId,setVendorId]=useState('');
  const[notes,setNotes]=useState('');
  const[message,setMessage]=useState('');
  const[busy,setBusy]=useState(false);
  const observerRef=useRef<MutationObserver|null>(null);

  async function load(){
    const[boardResponse,outsideResponse]=await Promise.all([
      fetch('/api/repair-board',{cache:'no-store'}),
      fetch('/api/outside-repairs',{cache:'no-store'}),
    ]);
    const board=await boardResponse.json() as BoardPayload;
    if(boardResponse.status===401)return;
    if(!boardResponse.ok)throw new Error(board.error||'Repair Board could not be loaded.');
    setCanManage(Boolean(board.canManage));
    setRepairs((board.repairs||[]).filter(row=>row.id.startsWith('repair-')));
    if(outsideResponse.ok){const outside=await outsideResponse.json() as OutsidePayload;setVendors(outside.vendors||[]);}
  }

  useEffect(()=>{void load().catch(()=>{});},[]);

  useEffect(()=>{
    if(!canManage||!repairs.length)return;
    const attach=()=>{
      const cards=Array.from(document.querySelectorAll<HTMLElement>('[class*="repairDetail"]'));
      for(const card of cards){
        const actionBar=card.querySelector<HTMLElement>('[class*="actionBar"]');
        if(!actionBar||actionBar.querySelector('[data-outside-vendor-card-button="1"]'))continue;
        const unitSection=card.closest<HTMLElement>('[class*="unitDetail"]');
        const unitText=(unitSection?.querySelector('h3')?.textContent||'').replace(/^Unit\s+/i,'').trim();
        const issueText=card.querySelector('h4')?.textContent?.trim()||'';
        const matches=repairs.filter(row=>normalize(row.unit)===normalize(unitText)&&normalize(row.issue)===normalize(issueText));
        if(matches.length!==1)continue;
        const repair=matches[0];
        const button=document.createElement('button');
        button.type='button';
        button.dataset.outsideVendorCardButton='1';
        button.textContent='Outside Vendor';
        button.style.minHeight='34px';
        button.style.border='1px solid #163b5c';
        button.style.borderRadius='7px';
        button.style.padding='6px 10px';
        button.style.background='#eef6fb';
        button.style.color='#153b5b';
        button.style.fontWeight='900';
        button.style.cursor='pointer';
        button.addEventListener('click',()=>{setSelected(repair);setVendorId('');setNotes('');setMessage('');});
        actionBar.prepend(button);
      }
    };
    attach();
    observerRef.current?.disconnect();
    const observer=new MutationObserver(attach);
    observer.observe(document.body,{childList:true,subtree:true});
    observerRef.current=observer;
    return()=>{observer.disconnect();observerRef.current=null;document.querySelectorAll('[data-outside-vendor-card-button="1"]').forEach(node=>node.remove());};
  },[canManage,repairs]);

  async function move(){
    if(!selected)return;
    if(!vendorId){setMessage('Choose the outside vendor.');return;}
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/outside-repairs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',repairId:selected.id,vendorId:Number(vendorId),notes})});
      const result=await response.json() as OutsidePayload;
      if(!response.ok||!result.ok)throw new Error(result.error||'Repair could not be moved to Outside Repairs.');
      setSelected(null);
      window.location.reload();
    }catch(error){setMessage(error instanceof Error?error.message:'Repair could not be moved to Outside Repairs.');}
    finally{setBusy(false);}
  }

  if(!selected)return null;
  return <div style={backdrop} role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setSelected(null);}}>
    <section role="dialog" aria-modal="true" aria-label="Assign outside vendor" style={modal}>
      <div style={eyebrow}>MOVE REPAIR TO OUTSIDE VENDOR</div>
      <h2 style={{margin:'3px 0 6px'}}>Unit {selected.unit}</h2>
      <div style={issue}>{selected.issue}</div>
      <label style={label}>Outside vendor
        <select autoFocus value={vendorId} onChange={event=>setVendorId(event.target.value)} style={input}>
          <option value="">Choose vendor</option>
          {vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.phone?` — ${vendor.phone}`:''}</option>)}
        </select>
      </label>
      <label style={label}>Optional note / what you texted the vendor
        <textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={1000} style={{...input,minHeight:86}} placeholder={`Example: Unit ${selected.unit} — ${selected.issue}. Please text when fixed.`}/>
      </label>
      {message&&<div style={notice}>{message}</div>}
      <div style={actions}><button type="button" disabled={busy} onClick={()=>setSelected(null)} style={secondary}>Cancel</button><button type="button" disabled={busy} onClick={()=>void move()} style={{...primary,opacity:busy?.6:1}}>{busy?'Moving…':'Move to Outside Repairs'}</button></div>
    </section>
  </div>;
}

const backdrop:CSSProperties={position:'fixed',inset:0,zIndex:10000,background:'rgba(8,20,32,.55)',display:'grid',placeItems:'center',padding:18};
const modal:CSSProperties={width:'min(560px,100%)',background:'#fff',borderRadius:14,padding:20,boxShadow:'0 24px 70px rgba(0,0,0,.28)',color:'#172536'};
const eyebrow:CSSProperties={fontSize:11,fontWeight:950,letterSpacing:'.11em',color:'#50677a'};
const issue:CSSProperties={padding:'10px 12px',border:'1px solid #d8e1e8',borderRadius:8,background:'#f7fafc',marginBottom:14,fontWeight:750};
const label:CSSProperties={display:'grid',gap:6,fontSize:12,fontWeight:900,marginTop:11};
const input:CSSProperties={width:'100%',boxSizing:'border-box',minHeight:42,border:'1px solid #b9c7d2',borderRadius:8,padding:'8px 10px',background:'#fff',font:'inherit'};
const notice:CSSProperties={marginTop:12,padding:'9px 11px',border:'1px solid #d7c27b',borderRadius:8,background:'#fffdf2',fontSize:13};
const actions:CSSProperties={display:'flex',justifyContent:'flex-end',gap:9,marginTop:16,flexWrap:'wrap'};
const primary:CSSProperties={minHeight:42,border:0,borderRadius:8,padding:'9px 14px',background:'#10243a',color:'#fff',fontWeight:900,cursor:'pointer'};
const secondary:CSSProperties={minHeight:42,border:'1px solid #b7c5d1',borderRadius:8,padding:'9px 14px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'};
