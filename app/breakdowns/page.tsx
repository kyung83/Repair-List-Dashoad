'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BreakdownRow } from '@/lib/roadside-breakdowns';
import DriverReceiptReview from './driver-receipt-review';
import s from './breakdown-flow.module.css';

type BreakdownCategory = { id:number; name:string; active:boolean; sortOrder:number; requiresPosition:boolean; requiresTireSize:boolean };
type BreakdownViewRow = BreakdownRow & { repair_subcategory?:string|null; position_codes?:string[] };
type BreakdownPhoto = { breakdownId:number; objectKey:string; fileName:string; contentType:string; url:string };
type ServiceProvider = { id:number; name:string; phone:string; city:string; state:string; zip:string };
type DiagnosticDraft = { category:string; notes:string };
type DispatchDraft = { serviceProvider:string; serviceProviderPhone:string; eta:string };
type NewProviderDraft = { name:string; phone:string; city:string; state:string; zip:string };
type StageFilter = 'all'|'reported'|'diagnostics'|'enroute'|'onlocation';
type BusyAction = 'diagnostics'|'claim'|'provider'|'onLocation'|'clear'|null;

const STAGE_LABELS:Record<number,string>={1:'Reported',2:'Diagnostics',3:'En Route',4:'On Location',5:'Complete'};
const OFFICE_CATEGORY_DEFAULTS=['Fuel Issue'];

function unitLabel(row:BreakdownRow){
  const type=String(row.equipment_type||'').toLowerCase()==='trailer'?'Trailer':'Truck';
  return `${type} ${row.unit}`;
}
function money(value:number|null){return value==null?'—':value.toLocaleString('en-US',{style:'currency',currency:'USD'});}
function dateTime(value:string){
  if(!value)return'—';
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?`${value.replace(' ','T')}Z`:value;
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();
}
function stageBadge(stage:number){
  if(stage===4)return s.badgeGreen;
  if(stage===1)return s.badgeRed;
  return s.badgeOrange;
}
function uniqueNames(values:string[]){
  const seen=new Set<string>();
  const result:string[]=[];
  for(const raw of values){
    const name=String(raw||'').trim();
    const key=name.toLowerCase();
    if(!name||seen.has(key))continue;
    seen.add(key);result.push(name);
  }
  return result;
}
function initialDiagnostic(row:BreakdownViewRow):DiagnosticDraft{return{category:row.repair_needed||'',notes:''};}
function initialDispatch(row:BreakdownRow):DispatchDraft{return{serviceProvider:row.service_provider||'',serviceProviderPhone:row.service_provider_phone||'',eta:row.eta||''};}

function ProviderPicker({row,value,disabled,onChange}:{row:BreakdownRow;value:DispatchDraft;disabled:boolean;onChange:(next:DispatchDraft)=>void}){
  const state=String(row.state||'').trim().toUpperCase();
  const city=String(row.city||'').trim();
  const[providers,setProviders]=useState<ServiceProvider[]>([]);
  const[search,setSearch]=useState('');
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const[showAdd,setShowAdd]=useState(false);
  const[addBusy,setAddBusy]=useState(false);
  const[addError,setAddError]=useState('');
  const[newProvider,setNewProvider]=useState<NewProviderDraft>({name:'',phone:'',city,state,zip:''});

  const loadProviders=useCallback(async()=>{
    if(!state){setProviders([]);setLoading(false);return;}
    setLoading(true);setError('');
    try{
      const params=new URLSearchParams({state});
      if(city)params.set('city',city);
      const response=await fetch(`/api/breakdown-service-providers?${params.toString()}`,{cache:'no-store'});
      const payload=await response.json() as {providers?:ServiceProvider[];error?:string};
      if(!response.ok)throw new Error(payload.error||'Provider directory could not be loaded.');
      setProviders(Array.isArray(payload.providers)?payload.providers:[]);
    }catch(reason){setError(reason instanceof Error?reason.message:'Provider directory could not be loaded.');}
    finally{setLoading(false);}
  },[city,state]);

  useEffect(()=>{setNewProvider(current=>({...current,city,state}));void loadProviders();},[city,state,loadProviders]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    if(!q)return providers;
    const digits=q.replace(/\D/g,'');
    return providers.filter(provider=>{
      const text=`${provider.name} ${provider.city} ${provider.state} ${provider.zip} ${provider.phone}`.toLowerCase();
      return text.includes(q)||Boolean(digits&&provider.phone.replace(/\D/g,'').includes(digits));
    }).slice(0,80);
  },[providers,search]);

  async function addProvider(){
    if(!newProvider.name.trim()){setAddError('Enter the company name.');return;}
    setAddBusy(true);setAddError('');
    try{
      const response=await fetch('/api/breakdown-service-providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        name:newProvider.name.trim(),phone:newProvider.phone.trim(),city:newProvider.city.trim(),state:newProvider.state.trim().toUpperCase(),zip:newProvider.zip.trim(),
      })});
      const payload=await response.json() as {provider?:ServiceProvider;error?:string};
      if(!response.ok||!payload.provider)throw new Error(payload.error||'Provider could not be saved.');
      onChange({...value,serviceProvider:payload.provider.name,serviceProviderPhone:payload.provider.phone});
      setShowAdd(false);setSearch('');setNewProvider({name:'',phone:'',city,state,zip:''});
      await loadProviders();
    }catch(reason){setAddError(reason instanceof Error?reason.message:'Provider could not be saved.');}
    finally{setAddBusy(false);}
  }

  return <div className={s.providerBox}>
    {value.serviceProvider?<div className={s.providerSelected}>
      <div><strong>{value.serviceProvider}</strong><small>{value.serviceProviderPhone||'No phone on file'}</small></div>
      <button type="button" className={s.button} disabled={disabled} onClick={()=>onChange({...value,serviceProvider:'',serviceProviderPhone:''})}>Change</button>
    </div>:null}
    {!showAdd?<>
      <label className={s.field}>Find service provider
        <input className={s.input} value={search} onChange={event=>setSearch(event.target.value.slice(0,100))} placeholder={`Search ${state||'state'} company, city, ZIP or phone`} disabled={disabled}/>
      </label>
      {loading?<div className={s.muted}>Loading providers…</div>:error?<div className={s.notice}>{error}</div>:search.trim()?<div className={s.providerResults}>
        {filtered.map(provider=><button type="button" key={provider.id} className={s.providerResult} disabled={disabled} onClick={()=>{onChange({...value,serviceProvider:provider.name,serviceProviderPhone:provider.phone});setSearch('');}}><strong>{provider.name}</strong><small>{provider.city}, {provider.state}{provider.zip?` ${provider.zip}`:''}{provider.phone?` · ${provider.phone}`:''}</small></button>)}
        {!filtered.length?<div className={s.muted}>No matching provider.</div>:null}
      </div>:null}
      <div className={s.actions} style={{marginTop:8}}><button type="button" className={s.button} disabled={disabled} onClick={()=>setShowAdd(true)}>+ Add Service Provider</button></div>
    </>:<div className={s.providerAdd}>
      <div className={s.twoCol}>
        <label className={s.field}>Company<input className={s.input} value={newProvider.name} onChange={event=>setNewProvider(current=>({...current,name:event.target.value.slice(0,160)}))}/></label>
        <label className={s.field}>Phone<input className={s.input} inputMode="tel" value={newProvider.phone} onChange={event=>setNewProvider(current=>({...current,phone:event.target.value.slice(0,40)}))}/></label>
        <label className={s.field}>City<input className={s.input} value={newProvider.city} onChange={event=>setNewProvider(current=>({...current,city:event.target.value.slice(0,120)}))}/></label>
        <label className={s.field}>State<input className={s.input} value={newProvider.state} onChange={event=>setNewProvider(current=>({...current,state:event.target.value.replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,2)}))}/></label>
      </div>
      <label className={s.field}>ZIP<input className={s.input} value={newProvider.zip} onChange={event=>setNewProvider(current=>({...current,zip:event.target.value.slice(0,20)}))}/></label>
      {addError?<div className={s.notice}>{addError}</div>:null}
      <div className={s.actions}><button type="button" className={s.orangeButton} disabled={disabled||addBusy} onClick={()=>void addProvider()}>{addBusy?'Saving…':'Save Provider'}</button><button type="button" className={s.button} disabled={addBusy} onClick={()=>setShowAdd(false)}>Cancel</button></div>
    </div>}
  </div>;
}

export default function BreakdownsPage(){
  const[breakdowns,setBreakdowns]=useState<BreakdownViewRow[]>([]);
  const[photosByBreakdown,setPhotosByBreakdown]=useState<Record<number,BreakdownPhoto[]>>({});
  const[categories,setCategories]=useState<BreakdownCategory[]>([]);
  const[diagnostics,setDiagnostics]=useState<Record<number,DiagnosticDraft>>({});
  const[dispatches,setDispatches]=useState<Record<number,DispatchDraft>>({});
  const[selectedId,setSelectedId]=useState<number|null>(null);
  const[filter,setFilter]=useState<StageFilter>('all');
  const[categoryFilter,setCategoryFilter]=useState('');
  const[query,setQuery]=useState('');
  const[loading,setLoading]=useState(true);
  const[busyAction,setBusyAction]=useState<BusyAction>(null);
  const[message,setMessage]=useState('');
  const initialLoadDone=useRef(false);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const[breakdownResponse,photoResponse,categoryResponse]=await Promise.all([
        fetch('/api/breakdowns?open=1',{cache:'no-store'}),
        fetch('/api/breakdowns/photos?open=1',{cache:'no-store'}),
        fetch('/api/breakdown-categories',{cache:'no-store'}),
      ]);
      const payload=await breakdownResponse.json() as {breakdowns?:BreakdownViewRow[];error?:string};
      const photoPayload=await photoResponse.json() as {photos?:BreakdownPhoto[];error?:string};
      const categoryPayload=await categoryResponse.json() as {categories?:BreakdownCategory[];error?:string};
      if(!breakdownResponse.ok)throw new Error(payload.error||'Failed to load breakdowns.');
      if(!photoResponse.ok)throw new Error(photoPayload.error||'Failed to load breakdown photos.');
      if(!categoryResponse.ok)throw new Error(categoryPayload.error||'Failed to load breakdown categories.');
      const rows=Array.isArray(payload.breakdowns)?payload.breakdowns:[];
      const photos=Array.isArray(photoPayload.photos)?photoPayload.photos:[];
      const grouped=photos.reduce<Record<number,BreakdownPhoto[]>>((current,photo)=>{const id=Number(photo.breakdownId);if(Number.isFinite(id))(current[id]||=[]).push(photo);return current;},{});
      setBreakdowns(rows);setPhotosByBreakdown(grouped);setCategories(Array.isArray(categoryPayload.categories)?categoryPayload.categories:[]);
      setDiagnostics(current=>Object.fromEntries(rows.map(row=>[row.id,current[row.id]||initialDiagnostic(row)])));
      setDispatches(Object.fromEntries(rows.map(row=>[row.id,initialDispatch(row)])));
      setMessage('');
      const firstLoad=!initialLoadDone.current;
      const requested=Number(new URLSearchParams(window.location.search).get('id')||0);
      setSelectedId(current=>{
        if(current&&rows.some(row=>row.id===current))return current;
        if(Number.isInteger(requested)&&requested>0&&rows.some(row=>row.id===requested))return requested;
        if(firstLoad&&rows.length===1)return rows[0].id;
        return null;
      });
      initialLoadDone.current=true;
    }catch(error){setMessage(error instanceof Error?error.message:'Failed to load breakdowns.');}
    finally{setLoading(false);}
  },[]);

  const loadDiagnostic=useCallback(async(id:number)=>{
    try{
      const response=await fetch(`/api/breakdowns/${id}/repair-type`,{cache:'no-store'});
      const payload=await response.json() as {repairCategory?:string;notes?:string;error?:string};
      if(!response.ok)throw new Error(payload.error||'Our diagnosis could not be loaded.');
      setDiagnostics(current=>({...current,[id]:{category:String(payload.repairCategory||''),notes:String(payload.notes||'')}}));
    }catch(error){setMessage(error instanceof Error?error.message:'Our diagnosis could not be loaded.');}
  },[]);

  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    const pop=()=>{const id=Number(new URLSearchParams(window.location.search).get('id')||0);setSelectedId(Number.isInteger(id)&&id>0?id:null);};
    window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);
  },[]);
  useEffect(()=>{if(selectedId)void loadDiagnostic(selectedId);},[selectedId,loadDiagnostic]);

  const selected=useMemo(()=>breakdowns.find(row=>row.id===selectedId)||null,[breakdowns,selectedId]);
  const officeCategoryNames=useMemo(()=>uniqueNames([
    ...OFFICE_CATEGORY_DEFAULTS,
    ...categories.map(category=>category.name),
    ...breakdowns.map(row=>row.repair_needed||''),
  ]),[categories,breakdowns]);
  const summary=useMemo(()=>({
    open:breakdowns.length,
    reported:breakdowns.filter(row=>row.stage===1).length,
    enRoute:breakdowns.filter(row=>row.stage===3).length,
    onLocation:breakdowns.filter(row=>row.stage===4).length,
  }),[breakdowns]);

  const visible=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return breakdowns.filter(row=>{
      if(filter==='reported'&&row.stage!==1)return false;
      if(filter==='diagnostics'&&row.stage!==2)return false;
      if(filter==='enroute'&&row.stage!==3)return false;
      if(filter==='onlocation'&&row.stage!==4)return false;
      const displayCategory=row.repair_needed||row.repair_category;
      if(categoryFilter&&displayCategory!==categoryFilter)return false;
      if(!needle)return true;
      return [row.id,row.unit,row.driver_name,row.city,row.state,row.repair_category,row.repair_needed,row.description,row.service_provider,row.eta].join(' ').toLowerCase().includes(needle);
    });
  },[breakdowns,filter,categoryFilter,query]);

  function openBreakdown(id:number){
    setSelectedId(id);setMessage('');
    const url=new URL(window.location.href);url.searchParams.set('id',String(id));window.history.pushState(null,'',url);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function backToList(){
    setSelectedId(null);setMessage('');
    const url=new URL(window.location.href);url.searchParams.delete('id');window.history.pushState(null,'',url);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function updateDiagnostic(id:number,patch:Partial<DiagnosticDraft>){setDiagnostics(current=>({...current,[id]:{...(current[id]||{category:'',notes:''}),...patch}}));}
  function updateDispatch(id:number,next:DispatchDraft){setDispatches(current=>({...current,[id]:next}));}

  async function saveDiagnostics(row:BreakdownViewRow){
    const draft=diagnostics[row.id]||initialDiagnostic(row);
    if(!draft.category.trim()){setMessage('Choose our repair category.');return;}
    if(!draft.notes.trim()){setMessage('Add our diagnostic notes.');return;}
    setBusyAction('diagnostics');setMessage('');
    try{
      const response=await fetch(`/api/breakdowns/${row.id}/repair-type`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({repairCategory:draft.category.trim(),notes:draft.notes.trim()})});
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Our diagnosis could not be saved.');
      await load();setSelectedId(row.id);setDiagnostics(current=>({...current,[row.id]:draft}));setMessage(`Breakdown #${row.id} diagnosis saved.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Our diagnosis could not be saved.');}
    finally{setBusyAction(null);}
  }

  async function claim(row:BreakdownViewRow){
    setBusyAction('claim');setMessage('');
    try{
      const response=await fetch(`/api/breakdowns/${row.id}/claim`,{method:'POST'});const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Breakdown could not be claimed.');
      await load();setSelectedId(row.id);setMessage(`Breakdown #${row.id} claimed.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Breakdown could not be claimed.');}
    finally{setBusyAction(null);}
  }

  async function saveProvider(row:BreakdownViewRow){
    const draft=dispatches[row.id]||initialDispatch(row);
    if(!draft.serviceProvider.trim()){setMessage('Choose the service provider first.');return;}
    if(!draft.eta.trim()){setMessage('Enter the ETA before dispatching.');return;}
    setBusyAction('provider');setMessage('');
    try{
      const body:Record<string,unknown>={serviceProvider:draft.serviceProvider.trim(),serviceProviderPhone:draft.serviceProviderPhone.trim(),eta:draft.eta.trim()};
      if(row.stage<3){body.stage=3;body.status='en_route';}
      const response=await fetch(`/api/breakdowns/${row.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Provider and ETA could not be saved.');
      await load();setSelectedId(row.id);setMessage(`Breakdown #${row.id} provider and ETA saved. Driver screen updated.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Provider and ETA could not be saved.');}
    finally{setBusyAction(null);}
  }

  async function markOnLocation(row:BreakdownViewRow){
    setBusyAction('onLocation');setMessage('');
    try{
      const response=await fetch(`/api/breakdowns/${row.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({stage:4,status:'on_location',onLocation:true})});
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Breakdown could not be marked on location.');
      await load();setSelectedId(row.id);setMessage(`Breakdown #${row.id} marked On Location.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Breakdown could not be updated.');}
    finally{setBusyAction(null);}
  }

  async function clearNotBreakdown(row:BreakdownViewRow){
    if(!window.confirm(`Clear ${unitLabel(row)} for ${row.driver_name} as NOT A BREAKDOWN?\n\nThis closes the linked repair as Cancelled. The history is kept.`))return;
    setBusyAction('clear');setMessage('');
    try{
      const response=await fetch(`/api/breakdowns/${row.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({notBreakdown:true})});const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Breakdown could not be cleared.');
      backToList();await load();setMessage(`Breakdown #${row.id} cleared as not a breakdown.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Breakdown could not be cleared.');}
    finally{setBusyAction(null);}
  }

  if(selected){
    const diagnostic=diagnostics[selected.id]||initialDiagnostic(selected);
    const dispatch=dispatches[selected.id]||initialDispatch(selected);
    const photos=photosByBreakdown[selected.id]||[];
    const diagnosticsBusy=busyAction==='diagnostics';
    const claimBusy=busyAction==='claim';
    const providerBusy=busyAction==='provider';
    const onLocationBusy=busyAction==='onLocation';
    const clearBusy=busyAction==='clear';
    const anyActionBusy=busyAction!==null;
    const categoryOptions=uniqueNames([diagnostic.category,...officeCategoryNames]);
    return <main className={s.page}><div className={s.shell}>
      <div className={s.detailHeader}>
        <div>
          <button type="button" className={s.back} onClick={backToList}>← Back to Active Breakdowns</button>
          <h1 className={s.detailTitle}>Breakdown #{selected.id} <span className={stageBadge(selected.stage)}>{STAGE_LABELS[selected.stage]||selected.status}</span></h1>
          <div className={s.detailMeta}>{unitLabel(selected)} · {selected.driver_name} · {selected.city}, {selected.state}</div>
        </div>
        <div className={s.summaryCard}>
          <div className={s.summaryItem}><span>Claimed by</span><strong>{selected.claimed_by||'Unclaimed'}</strong></div>
          <div className={s.summaryItem}><span>Reported</span><strong>{dateTime(selected.created_at)}</strong></div>
          <div className={s.summaryItem}><span>Provider</span><strong>{selected.service_provider||'Not assigned'}</strong></div>
          <div className={s.summaryItem}><span>Final cost</span><strong>{money(selected.cost)}</strong></div>
        </div>
      </div>

      {message?<div className={s.notice}>{message}</div>:null}

      <div className={s.progress}>
        {[1,3,4,5].map((stage,index)=>{
          const done=selected.stage>=stage;const current=selected.stage===stage||(stage===1&&selected.stage===2);
          const labels=['Reported / Diagnose','Provider En Route','On Location','Closed'];
          return <div key={stage} className={`${s.step} ${done?s.stepDone:''} ${current?s.stepCurrent:''}`}><span className={s.stepDot}>{done?'✓':index+1}</span><span>{labels[index]}</span></div>;
        })}
      </div>

      <div className={s.workflow}>
        <section className={s.card}>
          <div className={s.cardHeader}><div className={s.cardTitleWrap}><span className={s.number}>1</span><div><h2 className={s.cardTitle}>Driver Report & Our Diagnosis</h2><p className={s.cardHelp}>The driver report stays read-only. Choose our repair category and write our own notes below it.</p></div></div></div>
          <div className={s.reported}>
            <strong>Driver Report — Read Only</strong><br/>
            <b>Category:</b> {selected.repair_category||'Not entered'}
            {selected.repair_subcategory?<> · <b>Issue:</b> {selected.repair_subcategory}</>:null}<br/>
            {selected.position_codes?.length?<><b>Position:</b> {selected.position_codes.join(', ')}<br/></>:null}
            <b>Driver notes:</b> {selected.description||'No notes entered.'}
          </div>
          {photos.length?<div className={s.photoGrid}>{photos.map(photo=><a className={s.photo} key={photo.objectKey} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.fileName} loading="lazy"/></a>)}</div>:null}
          <label className={s.field}>Our Repair Category<select className={s.select} value={diagnostic.category} disabled={diagnosticsBusy} onChange={event=>updateDiagnostic(selected.id,{category:event.target.value})}><option value="">Choose our diagnosis…</option>{categoryOptions.map(category=><option key={category} value={category}>{category}</option>)}</select></label>
          <label className={s.field}>Our Notes<textarea className={s.textarea} value={diagnostic.notes} disabled={diagnosticsBusy} onChange={event=>updateDiagnostic(selected.id,{notes:event.target.value.slice(0,2000)})} placeholder="Example: Fuel issue — suspect fuel pump; engine sputters and dies."/></label>
          <div className={s.actions} style={{marginTop:11}}><button type="button" className={s.orangeButton} disabled={anyActionBusy} onClick={()=>void saveDiagnostics(selected)}>{diagnosticsBusy?'Saving…':'Save Our Diagnosis'}</button>{!selected.claimed_by_user_id?<button type="button" className={s.button} disabled={anyActionBusy} onClick={()=>void claim(selected)}>{claimBusy?'Claiming…':'Claim Breakdown'}</button>:null}</div>
        </section>

        <section className={s.card}>
          <div className={s.cardHeader}><div className={s.cardTitleWrap}><span className={s.number}>2</span><div><h2 className={s.cardTitle}>Service Provider & ETA</h2><p className={s.cardHelp}>Dispatch information only. Final cost is intentionally not entered here.</p></div></div></div>
          <ProviderPicker row={selected} value={dispatch} disabled={providerBusy} onChange={next=>updateDispatch(selected.id,next)}/>
          <label className={s.field}>ETA<input className={s.input} value={dispatch.eta} disabled={providerBusy} onChange={event=>updateDispatch(selected.id,{...dispatch,eta:event.target.value.slice(0,80)})} placeholder="Example: 40 min or 1:30 PM"/></label>
          <div className={s.actions} style={{marginTop:11}}><button type="button" className={s.orangeButton} disabled={anyActionBusy} onClick={()=>void saveProvider(selected)}>{providerBusy?'Saving…':selected.stage<3?'Save & Mark En Route':'Save Provider / ETA'}</button></div>
        </section>

        <section className={s.card}>
          <div className={s.cardHeader}><div className={s.cardTitleWrap}><span className={s.number}>3</span><div><h2 className={s.cardTitle}>Status</h2><p className={s.cardHelp}>The driver can update arrival and rolling from their phone. Office can still move the call forward.</p></div></div></div>
          <div className={s.statusBox}>
            <div className={s.statusRow}><span>Current stage</span><strong>{STAGE_LABELS[selected.stage]||selected.status}</strong></div>
            <div className={s.statusRow}><span>Provider</span><strong>{selected.service_provider||'Not assigned'}</strong></div>
            <div className={s.statusRow}><span>ETA</span><strong>{selected.eta||'Not set'}</strong></div>
            <div className={s.statusRow}><span>On location</span><strong>{selected.on_location_at?dateTime(selected.on_location_at):'Not confirmed'}</strong></div>
          </div>
          {selected.stage<4?<div className={s.actions} style={{marginTop:11}}><button type="button" className={s.button} disabled={anyActionBusy} onClick={()=>void markOnLocation(selected)}>{onLocationBusy?'Saving…':'Mark On Location'}</button></div>:null}
        </section>

        <section className={`${s.card} ${s.cardWide}`}>
          <div className={s.cardHeader}><div className={s.cardTitleWrap}><span className={s.number}>4</span><div><h2 className={s.cardTitle}>Closeout / Payment</h2><p className={s.cardHelp}>Enter the final total after the repair is complete. Driver Rolling is tracked, but it does not block office closeout.</p></div></div></div>
          <DriverReceiptReview breakdownId={selected.id} initialCost={selected.cost} providerName={selected.service_provider} onClosed={()=>{backToList();void load();}}/>
        </section>
      </div>

      <div className={s.bottomBar}><button type="button" className={s.button} disabled={loading} onClick={()=>void load()}>Refresh Status</button><button type="button" className={s.dangerButton} disabled={anyActionBusy} onClick={()=>void clearNotBreakdown(selected)}>{clearBusy?'Clearing…':'Clear — Not a Breakdown'}</button></div>
    </div></main>;
  }

  const stageChips:Array<{key:StageFilter;label:string;count:number}>=[
    {key:'all',label:'All',count:summary.open},{key:'reported',label:'Reported',count:summary.reported},{key:'diagnostics',label:'Diagnostics',count:breakdowns.filter(row=>row.stage===2).length},{key:'enroute',label:'En Route',count:summary.enRoute},{key:'onlocation',label:'On Location',count:summary.onLocation},
  ];

  return <main className={s.page}><div className={s.shell}>
    <div className={s.header}><div><p className={s.eyebrow}>ROADSIDE OPERATIONS</p><h1 className={s.title}>Active Breakdowns</h1><p className={s.subtitle}>Multiple calls stay in one compact board. The driver report is preserved separately from our diagnosis, provider/ETA, status, final cost and closeout.</p></div><div className={s.actions}><a className={s.button} href="/breakdowns/setup">Breakdown Setup</a><button className={s.button} type="button" onClick={()=>void load()} disabled={loading}>Refresh</button></div></div>
    {message?<div className={s.notice}>{message}</div>:null}
    <section className={s.metrics}><article className={s.metric}><span>Open</span><strong>{summary.open}</strong><small>All active roadside calls</small></article><article className={s.metric}><span>Reported</span><strong>{summary.reported}</strong><small>Needs diagnostics / dispatch</small></article><article className={s.metric}><span>En Route</span><strong>{summary.enRoute}</strong><small>Provider traveling</small></article><article className={s.metric}><span>On Location</span><strong>{summary.onLocation}</strong><small>Repair underway / closeout</small></article></section>

    <section className={s.panel}>
      <div className={s.panelHead}><div><h2 className={s.sectionTitle}>Breakdown Board</h2><p className={s.sectionCopy}>Tap or click one breakdown to open its single working card.</p></div><span className={s.badge}>{visible.length} shown</span></div>
      <div className={s.filters}>
        <input className={s.input} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search unit, driver, provider, category…"/>
        <select className={s.select} value={categoryFilter} onChange={event=>setCategoryFilter(event.target.value)}><option value="">All Categories</option>{officeCategoryNames.map(category=><option key={category} value={category}>{category}</option>)}</select>
        <div className={s.chips}>{stageChips.map(item=><button type="button" key={item.key} className={filter===item.key?s.chipActive:s.chip} onClick={()=>setFilter(item.key)}>{item.label} {item.count}</button>)}</div>
      </div>

      {loading?<div className={s.empty}>Loading breakdowns…</div>:!visible.length?<div className={s.empty}>No open breakdowns match this view.</div>:<>
        <div className={s.tableWrap}><table className={s.table}><thead><tr><th>Breakdown</th><th>Unit</th><th>Our Diagnosis / Driver Report</th><th>Status</th><th>Driver</th><th>Provider / ETA</th><th>Final Cost</th><th>Updated</th><th></th></tr></thead><tbody>{visible.map(row=><tr key={row.id} onClick={()=>openBreakdown(row.id)}><td><strong>#{row.id}</strong></td><td><span className={s.unit}>{unitLabel(row)}</span><span className={s.muted}>{row.city}, {row.state}</span></td><td><strong>{row.repair_needed||'Diagnosis not entered'}</strong><span className={s.muted}>Driver: {row.repair_category}{row.description?` — ${row.description}`:''}</span></td><td><span className={stageBadge(row.stage)}>{STAGE_LABELS[row.stage]||row.status}</span></td><td>{row.driver_name}<span className={s.muted}>{row.claimed_by?`Claimed by ${row.claimed_by}`:'Unclaimed'}</span></td><td>{row.service_provider||'Not assigned'}<span className={s.muted}>ETA {row.eta||'—'}</span></td><td><strong>{money(row.cost)}</strong></td><td>{dateTime(row.updated_at)}</td><td><button type="button" className={s.button} onClick={event=>{event.stopPropagation();openBreakdown(row.id);}}>Open</button></td></tr>)}</tbody></table></div>
        <div className={s.mobileList}>{visible.map(row=><button type="button" key={row.id} className={s.mobileCard} style={{width:'100%',textAlign:'left',cursor:'pointer'}} onClick={()=>openBreakdown(row.id)}><div className={s.mobileTop}><div><span className={s.unit}>#{row.id} · {unitLabel(row)}</span><span className={s.muted}>{row.repair_needed||'Diagnosis not entered'}</span></div><span className={stageBadge(row.stage)}>{STAGE_LABELS[row.stage]||row.status}</span></div><div className={s.mobileMeta}><span>Driver: {row.repair_category}{row.description?` — ${row.description}`:''}</span><span>{row.service_provider||'No provider'} · ETA {row.eta||'—'}</span><span>{row.driver_name} · {dateTime(row.updated_at)}</span></div></button>)}</div>
      </>}
    </section>
  </div></main>;
}
