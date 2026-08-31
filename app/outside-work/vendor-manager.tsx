'use client';

import { FormEvent, useEffect, useState, type CSSProperties } from 'react';

type Vendor={id:number;name:string;phone:string;email:string;address:string};
type VendorPayload={vendors?:Vendor[];vendor?:Vendor;ok?:boolean;created?:boolean;error?:string};
type Draft={name:string;phone:string;email:string;address:string};

const blank:Draft={name:'',phone:'',email:'',address:''};

export default function OutsideWorkVendorManager(){
  const[vendors,setVendors]=useState<Vendor[]>([]);
  const[open,setOpen]=useState(false);
  const[editing,setEditing]=useState<Vendor|null>(null);
  const[draft,setDraft]=useState<Draft>(blank);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState('');

  async function load(){
    const response=await fetch('/api/outside-work/vendors',{cache:'no-store'});
    const result=await response.json() as VendorPayload;
    if(response.status===401)return;
    if(!response.ok)throw new Error(result.error||'Outside vendors could not be loaded.');
    setVendors(result.vendors||[]);
  }
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Outside vendors could not be loaded.'));},[]);

  function add(){setEditing(null);setDraft(blank);setMessage('');setOpen(true);}
  function edit(vendor:Vendor){setEditing(vendor);setDraft({name:vendor.name,phone:vendor.phone,email:vendor.email,address:vendor.address});setMessage('');setOpen(true);}
  function close(){if(busy)return;setOpen(false);setEditing(null);setDraft(blank);setMessage('');}

  async function save(event:FormEvent){
    event.preventDefault();
    if(!draft.name.trim()){setMessage('Enter the vendor company name.');return;}
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/outside-work/vendors',{method:editing?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(editing?{id:editing.id,...draft}:draft)});
      const result=await response.json() as VendorPayload;
      if(!response.ok||!result.ok)throw new Error(result.error||'Vendor could not be saved.');
      await load();
      setOpen(false);setEditing(null);setDraft(blank);
    }catch(error){setMessage(error instanceof Error?error.message:'Vendor could not be saved.');}
    finally{setBusy(false);}
  }

  async function deactivate(vendor:Vendor){
    if(!window.confirm(`Remove ${vendor.name} from the active Outside Vendor list? Existing repair history will be kept.`))return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/outside-work/vendors',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:vendor.id,active:false})});
      const result=await response.json() as VendorPayload;
      if(!response.ok||!result.ok)throw new Error(result.error||'Vendor could not be removed.');
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Vendor could not be removed.');}
    finally{setBusy(false);}
  }

  return <section style={wrap}>
    <div style={head}>
      <div><div style={eyebrow}>OUTSIDE WORK</div><h2 style={{margin:'3px 0 4px'}}>Outside Vendors</h2><p style={sub}>These vendors are available in the Repair Board assignment list.</p></div>
      <button type="button" onClick={add} style={primary}>+ Add Outside Vendor</button>
    </div>
    {message&&!open&&<div style={notice}>{message}</div>}
    <div style={list}>
      {vendors.map(vendor=><div key={vendor.id} style={row}>
        <div style={{minWidth:0}}><strong style={vendorName}>{vendor.name}</strong><div style={details}>{[vendor.phone,vendor.email,vendor.address].filter(Boolean).join(' • ')||'No contact information entered'}</div></div>
        <div style={buttons}><button type="button" style={secondary} onClick={()=>edit(vendor)}>Edit</button><button type="button" style={danger} disabled={busy} onClick={()=>void deactivate(vendor)}>Remove</button></div>
      </div>)}
      {!vendors.length&&<div style={empty}>No outside vendors yet. Add the first one here.</div>}
    </div>
    {open&&<div style={backdrop} onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
      <form style={modal} onSubmit={save}>
        <div style={eyebrow}>{editing?'EDIT OUTSIDE VENDOR':'ADD OUTSIDE VENDOR'}</div>
        <h2 style={{margin:'4px 0 14px'}}>{editing?editing.name:'New vendor'}</h2>
        <label style={label}>Vendor Name<input autoFocus value={draft.name} onChange={event=>setDraft(current=>({...current,name:event.target.value}))} maxLength={180} style={input}/></label>
        <label style={label}>Phone<input value={draft.phone} onChange={event=>setDraft(current=>({...current,phone:event.target.value}))} maxLength={80} style={input}/></label>
        <label style={label}>Email<input type="email" value={draft.email} onChange={event=>setDraft(current=>({...current,email:event.target.value}))} maxLength={180} style={input}/></label>
        <label style={label}>Address<input value={draft.address} onChange={event=>setDraft(current=>({...current,address:event.target.value}))} maxLength={300} style={input}/></label>
        {message&&<div style={notice}>{message}</div>}
        <div style={actions}><button type="button" onClick={close} disabled={busy} style={secondary}>Cancel</button><button type="submit" disabled={busy} style={primary}>{busy?'Saving…':editing?'Save Vendor':'Add Vendor'}</button></div>
      </form>
    </div>}
  </section>;
}

const wrap:CSSProperties={maxWidth:1180,margin:'16px auto 0',padding:'0 18px',boxSizing:'border-box'};
const head:CSSProperties={display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'16px 18px',border:'1px solid #d7e1e8',borderRadius:'12px 12px 0 0',background:'#fff'};
const eyebrow:CSSProperties={fontSize:10,fontWeight:950,letterSpacing:'.12em',color:'#547087'};
const sub:CSSProperties={margin:0,fontSize:12,color:'#667b8c'};
const list:CSSProperties={border:'1px solid #d7e1e8',borderTop:0,borderRadius:'0 0 12px 12px',background:'#fff',overflow:'hidden'};
const row:CSSProperties={display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',padding:'12px 16px',borderTop:'1px solid #edf1f4'};
const vendorName:CSSProperties={display:'block',fontSize:14,color:'#16324a'};
const details:CSSProperties={fontSize:11,color:'#6f7f8c',marginTop:3,overflowWrap:'anywhere'};
const buttons:CSSProperties={display:'flex',gap:7,flexShrink:0};
const primary:CSSProperties={minHeight:38,border:0,borderRadius:8,padding:'8px 13px',background:'#10243a',color:'#fff',fontWeight:900,cursor:'pointer'};
const secondary:CSSProperties={minHeight:34,border:'1px solid #b9c7d2',borderRadius:7,padding:'6px 10px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'};
const danger:CSSProperties={...secondary,border:'1px solid #e3b4b4',color:'#9b2828',background:'#fffafa'};
const empty:CSSProperties={padding:18,fontSize:12,color:'#6f7f8c'};
const backdrop:CSSProperties={position:'fixed',inset:0,zIndex:10000,background:'rgba(8,20,32,.55)',display:'grid',placeItems:'center',padding:18};
const modal:CSSProperties={width:'min(560px,100%)',background:'#fff',borderRadius:14,padding:20,boxShadow:'0 24px 70px rgba(0,0,0,.28)',color:'#172536'};
const label:CSSProperties={display:'grid',gap:6,fontSize:12,fontWeight:900,marginTop:11};
const input:CSSProperties={width:'100%',boxSizing:'border-box',minHeight:42,border:'1px solid #b9c7d2',borderRadius:8,padding:'8px 10px',background:'#fff',font:'inherit'};
const notice:CSSProperties={marginTop:12,padding:'9px 11px',border:'1px solid #d7c27b',borderRadius:8,background:'#fffdf2',fontSize:13};
const actions:CSSProperties={display:'flex',justifyContent:'flex-end',gap:9,marginTop:18,flexWrap:'wrap'};
