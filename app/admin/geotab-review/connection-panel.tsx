"use client";

import { useEffect, useState, type CSSProperties } from "react";

type RuntimeOverride = {
  active:boolean;
  database:string;
  username:string;
  updatedAt:string;
  updatedByUserId:number|null;
};

type ConnectionStatus = {
  connected:boolean;
  issue:string;
  error:string;
  suggestedDatabase:string;
  credentialSource:string;
  runtimeOverride:RuntimeOverride;
};

type FormState = { database:string; username:string; password:string };

function when(value:string){
  if(!value)return "—";
  const date=new Date(value.includes("T")?value:`${value.replace(" ","T")}Z`);
  return Number.isNaN(date.getTime())?value:date.toLocaleString();
}

export default function GeotabConnectionPanel(){
  const[status,setStatus]=useState<ConnectionStatus|null>(null);
  const[form,setForm]=useState<FormState>({database:"",username:"",password:""});
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState("");

  async function load(){
    const response=await fetch('/api/admin/geotab-connection',{cache:'no-store'});
    const result=await response.json() as ConnectionStatus&{error?:string};
    if(response.status===401){window.location.assign('/login?returnTo=/admin/geotab-review');return;}
    if(!response.ok)throw new Error(result.error||'Geotab connection status could not be loaded.');
    setStatus(result);
    setForm(current=>({
      database:current.database||result.runtimeOverride?.database||result.suggestedDatabase||'',
      username:current.username||result.runtimeOverride?.username||'',
      password:current.password,
    }));
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Geotab connection status could not be loaded.'));},[]);

  async function action(kind:'test'|'save'){
    if(!form.database.trim()||!form.username.trim()||!form.password){setMessage('Enter the Geotab database, username, and password first.');return;}
    setBusy(kind);setMessage('');
    try{
      const response=await fetch('/api/admin/geotab-connection',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({action:kind,database:form.database,username:form.username,password:form.password}),
      });
      const result=await response.json() as{ok?:boolean;message?:string;error?:string;issue?:string};
      if(!response.ok||result.ok===false)throw new Error(result.error||'Geotab credentials did not authenticate.');
      setMessage(result.message||'Geotab credentials authenticated.');
      if(kind==='save'){
        setForm(current=>({...current,password:''}));
        await load();
      }
    }catch(error){setMessage(error instanceof Error?error.message:'Geotab connection action failed.');}finally{setBusy('');}
  }

  async function clearOverride(){
    if(!window.confirm('Clear the saved Diagnostics Geotab account and go back to the deployment credential?'))return;
    setBusy('clear');setMessage('');
    try{
      const response=await fetch('/api/admin/geotab-connection',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'clear'})});
      const result=await response.json() as{ok?:boolean;message?:string;error?:string;status?:ConnectionStatus};
      if(!response.ok||!result.ok)throw new Error(result.error||'Saved Geotab override could not be cleared.');
      setForm({database:'',username:'',password:''});
      setMessage(result.message||'Saved Geotab override cleared.');
      if(result.status)setStatus(result.status);else await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Saved Geotab override could not be cleared.');}finally{setBusy('');}
  }

  const archived=status?.issue==='archived_user';
  const connected=Boolean(status?.connected);
  const override=status?.runtimeOverride;
  const tone=connected?'#b9d9c3':'#e5b765';
  const background=connected?'#f4fbf6':'#fff9ed';

  return <section style={{background:'#f3f5f7',padding:'0 clamp(16px,4vw,46px) 16px',color:'#182331'}}>
    <div style={{background,border:`2px solid ${tone}`,borderRadius:14,padding:18,boxShadow:'0 3px 14px rgba(15,32,48,.05)'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:15,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{maxWidth:900}}>
          <div style={{fontSize:11,fontWeight:950,letterSpacing:'.12em',color:connected?'#25713c':'#9a6508'}}>DIAGNOSTICS · GEOTAB CONNECTION</div>
          <h2 style={{margin:'6px 0 0',fontSize:23,color:'#102238'}}>{connected?'Geotab connection is working':'Geotab connection is blocked'}</h2>
          {archived?<p style={copy}><strong>The service account used by this app was archived or expired in MyGeotab.</strong> GPS, mileage, DVIR and yard pulls cannot authenticate until that account is reactivated or replaced. Retrying an individual truck cannot fix an archived login.</p>:connected?<p style={copy}>Authentication is working. {override?.active?'The replacement account saved from Diagnostics is currently taking priority over the deployment credential.':'The normal deployment credential is currently in use.'}</p>:<p style={copy}>{status?.error||'The app cannot authenticate to Geotab right now.'}</p>}
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={()=>{setMessage('');void load().catch(error=>setMessage(error instanceof Error?error.message:'Connection test failed.'));}}>Test current connection</button>
      </div>

      {!connected&&status?.error&&<div style={errorBox}><strong>Geotab response</strong><div style={{marginTop:4}}>{status.error}</div></div>}
      {message&&<div style={notice}>{message}</div>}

      <div style={{marginTop:16,display:'grid',gridTemplateColumns:'minmax(260px,.8fr) minmax(420px,1.5fr)',gap:14,alignItems:'start'}}>
        <div style={infoCard}>
          <strong style={{fontSize:15}}>How to restore service</strong>
          <p style={smallCopy}>You have two safe choices. Reactivate the existing service account in MyGeotab and then test the current connection, or enter a different active Geotab service account here.</p>
          <a href="https://my.geotab.com" target="_blank" rel="noreferrer" style={linkButton}>Open MyGeotab</a>
          <div style={{marginTop:13,paddingTop:12,borderTop:'1px solid #e0e5e9',fontSize:12,color:'#5d6d7a',lineHeight:1.55}}>
            <div><strong>Current source:</strong> {override?.active?'Diagnostics replacement':'Deployment credential'}</div>
            {override?.active&&<><div><strong>Database:</strong> {override.database||'—'}</div><div><strong>Username:</strong> {override.username||'—'}</div><div><strong>Saved:</strong> {when(override.updatedAt)}</div></>}
          </div>
        </div>

        <div style={formCard}>
          <div><strong style={{fontSize:16}}>Use a replacement Geotab service account</strong><p style={{...smallCopy,marginTop:4}}>Credentials are tested against Geotab before they can be saved. The password is encrypted server-side before D1 storage and is never displayed back on this page.</p></div>
          <div style={{display:'grid',gridTemplateColumns:'minmax(160px,.7fr) minmax(220px,1fr)',gap:9}}>
            <label style={label}>Database<input value={form.database} onChange={event=>setForm({...form,database:event.target.value})} placeholder={status?.suggestedDatabase||'Geotab database'} autoComplete="off" style={input}/></label>
            <label style={label}>Service account username<input value={form.username} onChange={event=>setForm({...form,username:event.target.value})} placeholder="Geotab username / email" autoComplete="username" style={input}/></label>
            <label style={{...label,gridColumn:'1 / -1'}}>Password<input type="password" value={form.password} onChange={event=>setForm({...form,password:event.target.value})} placeholder="Geotab service account password" autoComplete="current-password" style={input}/></label>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button type="button" disabled={Boolean(busy)} onClick={()=>void action('test')}>{busy==='test'?'Testing…':'Test credentials'}</button>
            <button type="button" disabled={Boolean(busy)} onClick={()=>void action('save')} style={primaryButton}>{busy==='save'?'Saving…':'Save & use this account'}</button>
            {override?.active&&<button type="button" disabled={Boolean(busy)} onClick={()=>void clearOverride()} style={dangerButton}>{busy==='clear'?'Clearing…':'Clear saved replacement'}</button>}
          </div>
        </div>
      </div>
    </div>
  </section>;
}

const copy:CSSProperties={margin:'7px 0 0',color:'#586979',lineHeight:1.55,fontSize:14};
const smallCopy:CSSProperties={margin:'7px 0 12px',color:'#657482',lineHeight:1.5,fontSize:12};
const infoCard:CSSProperties={padding:14,border:'1px solid #dce2e7',borderRadius:10,background:'white'};
const formCard:CSSProperties={padding:14,border:'1px solid #dce2e7',borderRadius:10,background:'white',display:'grid',gap:11};
const label:CSSProperties={display:'grid',gap:5,color:'#485b6b',fontSize:11,fontWeight:900};
const input:CSSProperties={minHeight:42,padding:'0 10px',border:'1px solid #cbd5dd',borderRadius:8,background:'white',color:'#172536',fontSize:13};
const notice:CSSProperties={marginTop:12,padding:'10px 11px',border:'1px solid #d8c17b',borderRadius:8,background:'#fffdf2',fontSize:13};
const errorBox:CSSProperties={marginTop:12,padding:'10px 11px',border:'1px solid #e1b45d',borderRadius:8,background:'#fff4dd',color:'#715116',fontSize:12,lineHeight:1.45};
const linkButton:CSSProperties={display:'inline-flex',alignItems:'center',minHeight:36,padding:'0 10px',border:'1px solid #ccd5dd',borderRadius:8,color:'#17324a',textDecoration:'none',fontWeight:850,fontSize:12};
const primaryButton:CSSProperties={border:0,borderRadius:7,padding:'8px 11px',background:'#0d1b2b',color:'white',fontWeight:900};
const dangerButton:CSSProperties={border:'1px solid #d8a19d',borderRadius:7,padding:'8px 11px',background:'#fff5f4',color:'#9b2c25',fontWeight:850};
