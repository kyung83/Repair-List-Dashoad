'use client';

import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';

type Vendor={id:number;name:string;phone:string;email?:string;address?:string};
type VendorResponse={ok?:boolean;created?:boolean;vendor?:Vendor;error?:string};
type VendorForm={name:string;phone:string;email:string};

const blank:VendorForm={name:'',phone:'',email:''};
const DIALOG_SELECTOR='section[role="dialog"][aria-label="Assign outside vendor"]';
const HOST_ATTRIBUTE='data-outside-vendor-quick-add-host';

function vendorSelect(dialog:HTMLElement){
  return dialog.querySelector<HTMLSelectElement>('label select');
}

function ensureVendorOption(select:HTMLSelectElement,vendor:Vendor){
  const value=String(vendor.id);
  let option=Array.from(select.options).find(item=>item.value===value);
  if(!option){
    option=document.createElement('option');
    option.value=value;
    option.textContent=`${vendor.name}${vendor.phone?` — ${vendor.phone}`:''}`;
    select.appendChild(option);
  }
  select.value=value;
}

export default function OutsideVendorQuickAdd(){
  const[host,setHost]=useState<HTMLElement|null>(null);
  const[open,setOpen]=useState(false);
  const[form,setForm]=useState<VendorForm>(blank);
  const[message,setMessage]=useState('');
  const[busy,setBusy]=useState(false);
  const activeDialogRef=useRef<HTMLElement|null>(null);
  const createdVendorRef=useRef<Vendor|null>(null);

  useEffect(()=>{
    let mounted=true;

    const sync=()=>{
      const dialog=document.querySelector<HTMLElement>(DIALOG_SELECTOR);
      if(!dialog){
        if(activeDialogRef.current){
          activeDialogRef.current=null;
          createdVendorRef.current=null;
          if(mounted){setHost(null);setOpen(false);setMessage('');setForm(blank);}
        }
        return;
      }

      if(activeDialogRef.current!==dialog){
        activeDialogRef.current=dialog;
        createdVendorRef.current=null;
        if(mounted){setOpen(false);setMessage('');setForm(blank);}
      }

      const select=vendorSelect(dialog);
      if(!select)return;

      let nextHost=dialog.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
      if(!nextHost){
        nextHost=document.createElement('div');
        nextHost.setAttribute(HOST_ATTRIBUTE,'1');
        const label=select.closest('label');
        if(label)label.insertAdjacentElement('afterend',nextHost);
        else select.insertAdjacentElement('afterend',nextHost);
      }

      const created=createdVendorRef.current;
      if(created)ensureVendorOption(select,created);
      if(mounted)setHost(current=>current===nextHost?current:nextHost);
    };

    const observer=new MutationObserver(sync);
    observer.observe(document.body,{childList:true,subtree:true});
    sync();

    return()=>{
      mounted=false;
      observer.disconnect();
      document.querySelectorAll<HTMLElement>(`[${HOST_ATTRIBUTE}]`).forEach(node=>node.remove());
    };
  },[]);

  function selectVendor(vendor:Vendor){
    createdVendorRef.current=vendor;
    const apply=(dispatch:boolean)=>{
      const dialog=document.querySelector<HTMLElement>(DIALOG_SELECTOR);
      if(!dialog)return;
      const select=vendorSelect(dialog);
      if(!select)return;
      ensureVendorOption(select,vendor);
      if(dispatch)select.dispatchEvent(new Event('change',{bubbles:true}));
    };
    apply(true);
    window.setTimeout(()=>apply(false),0);
    window.setTimeout(()=>apply(false),75);
  }

  async function saveVendor(){
    const name=form.name.replace(/\s+/g,' ').trim();
    if(!name){setMessage('Enter the vendor company name.');return;}
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/outside-work/vendors',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({name,phone:form.phone.trim(),email:form.email.trim(),address:''}),
      });
      const result=await response.json() as VendorResponse;
      if(!response.ok||!result.ok||!result.vendor)throw new Error(result.error||'Outside vendor could not be saved.');
      selectVendor(result.vendor);
      setForm(blank);
      setOpen(false);
      setMessage(result.created===false?`${result.vendor.name} already exists and is now selected.`:`${result.vendor.name} added and selected.`);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Outside vendor could not be saved.');
    }finally{
      setBusy(false);
    }
  }

  if(!host)return null;

  return createPortal(<div style={shell}>
    {!open?<button type="button" style={addButton} onClick={()=>{setOpen(true);setMessage('');}}>+ Add New Vendor</button>:<div style={formShell}>
      <div style={formTitle}>ADD NEW OUTSIDE VENDOR</div>
      <label style={{...label,gridColumn:'1/-1'}}>Vendor name
        <input autoFocus value={form.name} onChange={event=>setForm(current=>({...current,name:event.target.value}))} maxLength={180} style={input} placeholder="Vendor / repair shop name"/>
      </label>
      <label style={label}>Phone <span style={optional}>optional</span>
        <input value={form.phone} onChange={event=>setForm(current=>({...current,phone:event.target.value}))} maxLength={80} style={input} placeholder="Phone number"/>
      </label>
      <label style={label}>Email <span style={optional}>optional</span>
        <input value={form.email} onChange={event=>setForm(current=>({...current,email:event.target.value}))} maxLength={180} style={input} placeholder="Email address"/>
      </label>
      <div style={actions}>
        <button type="button" disabled={busy} style={cancelButton} onClick={()=>{setOpen(false);setMessage('');setForm(blank);}}>Cancel</button>
        <button type="button" disabled={busy} style={{...saveButton,opacity:busy?.65:1}} onClick={()=>void saveVendor()}>{busy?'Saving…':'Save & Select Vendor'}</button>
      </div>
    </div>}
    {message&&<div style={notice}>{message}</div>}
  </div>,host);
}

const shell:CSSProperties={marginTop:8};
const addButton:CSSProperties={minHeight:34,border:'1px solid #aebfce',borderRadius:8,padding:'6px 10px',background:'#fff',color:'#17324a',fontWeight:850,fontSize:12,cursor:'pointer'};
const formShell:CSSProperties={display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:9,marginTop:4,padding:12,border:'1px solid #cbd8e2',borderRadius:10,background:'#f8fafc'};
const formTitle:CSSProperties={gridColumn:'1/-1',fontSize:10,fontWeight:950,letterSpacing:'.09em',color:'#526a7d'};
const label:CSSProperties={display:'grid',gridTemplateColumns:'auto 1fr',gap:'5px 6px',fontSize:11,fontWeight:850,color:'#24384b'};
const optional:CSSProperties={fontWeight:650,color:'#788896'};
const input:CSSProperties={gridColumn:'1/-1',width:'100%',boxSizing:'border-box',minHeight:38,padding:'7px 9px',border:'1px solid #b8c7d3',borderRadius:7,background:'#fff',font:'inherit',fontSize:12};
const actions:CSSProperties={gridColumn:'1/-1',display:'flex',justifyContent:'flex-end',gap:8,marginTop:2};
const cancelButton:CSSProperties={minHeight:36,border:'1px solid #b8c7d3',borderRadius:7,padding:'7px 10px',background:'#fff',color:'#23384b',fontWeight:850,cursor:'pointer'};
const saveButton:CSSProperties={minHeight:36,border:0,borderRadius:7,padding:'7px 11px',background:'#10243a',color:'#fff',fontWeight:900,cursor:'pointer'};
const notice:CSSProperties={marginTop:7,padding:'8px 9px',border:'1px solid #d7c27b',borderRadius:7,background:'#fffdf2',fontSize:11,lineHeight:1.4,color:'#4d5f6f'};
