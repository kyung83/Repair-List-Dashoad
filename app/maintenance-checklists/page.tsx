"use client";

import {useEffect,useMemo,useState} from 'react';

type EventType='pm'|'annual';
type TemplateItem={position:number;section:string;text:string;enabled:boolean;allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string};
type Template={id:number;eventType:EventType;templateKey:string;name:string;version:number;active:boolean;createdAt:string;items:TemplateItem[]};
type Version={id:number;name:string;version:number;active:boolean;createdAt:string;itemCount:number};
type KindData={active:Template;versions:Version[]};
type SetupData={pm:KindData;annual:KindData;updatedAt:string};

const blankItem=(section='New Section'):TemplateItem=>({position:0,section,text:'',enabled:true,allowPass:true,allowFail:true,allowNa:true,requireNotes:false,requirePhoto:false,requireMeasurement:false,measurementLabel:'',measurementUnit:''});

function renumber(items:TemplateItem[]){return items.map((item,index)=>({...item,position:index+1}))}
function formatDate(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString()}

export default function MaintenanceChecklistEditorPage(){
  const[data,setData]=useState<SetupData|null>(null);
  const[kind,setKind]=useState<EventType>('pm');
  const[name,setName]=useState('');
  const[items,setItems]=useState<TemplateItem[]>([]);
  const[dirty,setDirty]=useState(false);
  const[saving,setSaving]=useState(false);
  const[message,setMessage]=useState('');
  const[dragIndex,setDragIndex]=useState<number|null>(null);

  function applyTemplate(nextKind:EventType,payload:SetupData){
    const template=payload[nextKind].active;
    setName(template.name);
    setItems(renumber(template.items.map(item=>({...item}))));
    setDirty(false);
    setMessage('');
  }

  async function load(){
    const response=await fetch('/api/maintenance-checklist-templates',{cache:'no-store'});
    const payload=await response.json() as SetupData&{error?:string};
    if(!response.ok)throw new Error(payload.error||'Checklist editor could not be loaded.');
    setData(payload);
    applyTemplate(kind,payload);
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Checklist editor could not be loaded.'))},[]);

  function switchKind(next:EventType){
    if(next===kind)return;
    if(dirty&&!window.confirm('Discard the unpublished checklist changes?'))return;
    setKind(next);
    if(data)applyTemplate(next,data);
  }

  function patch(index:number,patch:Partial<TemplateItem>){
    setItems(current=>renumber(current.map((item,itemIndex)=>itemIndex===index?{...item,...patch}:item)));
    setDirty(true);
  }

  function addItem(section?:string){
    const defaultSection=section||items.at(-1)?.section||'New Section';
    setItems(current=>renumber([...current,blankItem(defaultSection)]));
    setDirty(true);
    window.setTimeout(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'}),0);
  }

  function addSection(){
    const section=window.prompt('Name the new checklist section:','New Section')?.trim();
    if(!section)return;
    addItem(section);
  }

  function move(index:number,target:number){
    if(target<0||target>=items.length||index===target)return;
    setItems(current=>{
      const next=[...current];
      const[picked]=next.splice(index,1);
      next.splice(target,0,picked);
      return renumber(next);
    });
    setDirty(true);
  }

  function remove(index:number){
    const item=items[index];
    if(!window.confirm(`Remove item ${index+1}${item?.text?`: ${item.text}`:''} from the new version?`))return;
    setItems(current=>renumber(current.filter((_,itemIndex)=>itemIndex!==index)));
    setDirty(true);
  }

  async function publish(){
    if(!items.length)return setMessage('Add at least one checklist item first.');
    if(items.some(item=>!item.section.trim()||!item.text.trim()))return setMessage('Every checklist item needs a section and question before publishing.');
    if(!items.some(item=>item.enabled))return setMessage('At least one checklist item must be enabled.');
    if(!window.confirm(`Publish this as a new ${kind==='annual'?'Annual':'PM'} checklist version? Inspections already started will keep their existing questions.`))return;
    setSaving(true);setMessage('');
    try{
      const response=await fetch('/api/maintenance-checklist-templates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'publish',eventType:kind,name,items})});
      const payload=await response.json() as SetupData&{ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Checklist version could not be published.');
      setData(payload);
      applyTemplate(kind,payload);
      setMessage(`${kind==='annual'?'Annual':'PM'} checklist version ${payload[kind].active.version} published. New inspections will use it.`);
    }catch(error){setMessage(error instanceof Error?error.message:'Checklist version could not be published.')}
    finally{setSaving(false)}
  }

  const active=data?.[kind].active;
  const versions=data?.[kind].versions??[];
  const enabledCount=items.filter(item=>item.enabled).length;
  const sectionCount=useMemo(()=>new Set(items.filter(item=>item.enabled).map(item=>item.section.trim()).filter(Boolean)).size,[items]);

  return <main style={page}>
    <header style={header}>
      <div><p style={eyebrow}>MAINTENANCE SETUP</p><h1 style={title}>PM & Annual Checklist Editor</h1><p style={subtitle}>Build the exact inspection your technicians see. Publishing creates a new version; PMs or Annuals already started keep the version they started with.</p></div>
      <div style={versionCard}><span>ACTIVE VERSION</span><strong>v{active?.version??'—'}</strong><small>{enabledCount} enabled items · {sectionCount} sections</small></div>
    </header>

    {message&&<div style={notice}>{message}</div>}

    <nav style={kindTabs}>
      <button type="button" onClick={()=>switchKind('pm')} style={kind==='pm'?activeTab:tab}>PM Inspection</button>
      <button type="button" onClick={()=>switchKind('annual')} style={kind==='annual'?activeTab:tab}>Annual Inspection</button>
    </nav>

    <section style={safetyBanner}>
      <strong>Safe editing</strong>
      <span>Changes below are only a draft until you publish. A published version only applies when a new PM or Annual inspection starts. Existing and completed inspection records do not get rewritten.</span>
    </section>

    <section style={toolbarCard}>
      <div style={{display:'grid',gap:6,minWidth:0}}><label style={label}>Checklist name<input style={input} value={name} onChange={event=>{setName(event.target.value);setDirty(true)}}/></label><small style={helper}>Current: {active?.name||'Loading...'} {active?`· version ${active.version}`:''}</small></div>
      <div style={toolbarActions}><button type="button" style={secondaryButton} onClick={addSection}>+ Add Section</button><button type="button" style={secondaryButton} onClick={()=>addItem()}>+ Add Item</button><button type="button" disabled={saving||!dirty} style={{...primaryButton,opacity:saving||!dirty?.55:1}} onClick={()=>void publish()}>{saving?'Publishing...':'Publish New Version'}</button></div>
    </section>

    <section style={editorCard}>
      <div style={editorHeading}><div><p style={miniLabel}>CHECKLIST QUESTIONS</p><h2 style={h2}>{kind==='annual'?'Annual Inspection':'PM Inspection'}</h2></div><span style={countBadge}>{items.length} total · {enabledCount} enabled</span></div>
      <p style={helper}>Drag a card to reorder it, or use the arrows. Disable keeps an item in this draft but prevents it from appearing to technicians. Remove drops it from the new version entirely.</p>

      <div style={itemList}>{items.map((item,index)=>{
        const newSection=index===0||items[index-1]?.section!==item.section;
        return <div key={`${index}-${item.position}`}>
          {newSection&&<div style={sectionMarker}><strong>{item.section||'Unnamed Section'}</strong><span>section</span></div>}
          <article draggable onDragStart={()=>setDragIndex(index)} onDragEnd={()=>setDragIndex(null)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(dragIndex!=null)move(dragIndex,index);setDragIndex(null)}} style={{...itemCard,opacity:item.enabled?1:.55,borderColor:dragIndex===index?'#f47b20':'#d9e1e8'}}>
            <div style={itemTop}>
              <div style={dragHandle} title="Drag to reorder">⋮⋮</div>
              <div style={itemNumber}>{index+1}</div>
              <label style={{...label,flex:1}}>Section<input style={input} value={item.section} onChange={event=>patch(index,{section:event.target.value})}/></label>
              <div style={moveButtons}><button type="button" disabled={index===0} onClick={()=>move(index,index-1)}>↑</button><button type="button" disabled={index===items.length-1} onClick={()=>move(index,index+1)}>↓</button></div>
              <label style={switchLabel}><input type="checkbox" checked={item.enabled} onChange={event=>patch(index,{enabled:event.target.checked})}/> Enabled</label>
              <button type="button" style={removeButton} onClick={()=>remove(index)}>Remove</button>
            </div>

            <label style={label}>Technician question / instruction<textarea style={{...input,minHeight:74,resize:'vertical'}} value={item.text} onChange={event=>patch(index,{text:event.target.value})} placeholder="What should the technician inspect, check, or service?"/></label>

            <div style={optionsGrid}>
              <fieldset style={optionBox}><legend>Allowed answers</legend><label><input type="checkbox" checked={item.allowPass} onChange={event=>patch(index,{allowPass:event.target.checked})}/> Pass</label><label><input type="checkbox" checked={item.allowFail} onChange={event=>patch(index,{allowFail:event.target.checked})}/> Fail</label><label><input type="checkbox" checked={item.allowNa} onChange={event=>patch(index,{allowNa:event.target.checked})}/> N/A</label></fieldset>
              <fieldset style={optionBox}><legend>Required proof</legend><label><input type="checkbox" checked={item.requireNotes} onChange={event=>patch(index,{requireNotes:event.target.checked})}/> Require note</label><label><input type="checkbox" checked={item.requirePhoto} onChange={event=>patch(index,{requirePhoto:event.target.checked})}/> Require photo</label><label><input type="checkbox" checked={item.requireMeasurement} onChange={event=>patch(index,{requireMeasurement:event.target.checked,measurementLabel:event.target.checked?(item.measurementLabel||'Measurement'):item.measurementLabel})}/> Require measurement</label></fieldset>
              <div style={optionBox}><strong style={{fontSize:12}}>Measurement</strong><input style={input} value={item.measurementLabel} onChange={event=>patch(index,{measurementLabel:event.target.value})} placeholder="Example: Brake stroke"/><input style={input} value={item.measurementUnit} onChange={event=>patch(index,{measurementUnit:event.target.value})} placeholder="Unit: in, psi, °F..."/></div>
            </div>
          </article>
        </div>
      })}</div>

      {!items.length&&<div style={emptyState}><strong>No checklist items in this draft.</strong><span>Add a section or item to begin.</span></div>}
      <div style={bottomActions}><button type="button" style={secondaryButton} onClick={()=>addItem()}>+ Add Item</button><button type="button" disabled={saving||!dirty} style={{...primaryButton,opacity:saving||!dirty?.55:1}} onClick={()=>void publish()}>{saving?'Publishing...':'Publish New Version'}</button></div>
    </section>

    <section style={historyCard}>
      <div><p style={miniLabel}>VERSION HISTORY</p><h2 style={h2}>{kind==='annual'?'Annual':'PM'} checklist versions</h2></div>
      <div style={historyList}>{versions.map(version=><div key={version.id} style={historyRow}><div><strong>Version {version.version}{version.active?' · ACTIVE':''}</strong><span>{version.name}</span></div><div><strong>{version.itemCount} items</strong><span>{formatDate(version.createdAt)}</span></div></div>)}</div>
    </section>
  </main>
}

const page={minHeight:'100vh',padding:'30px clamp(14px,3vw,42px) 70px',background:'#f4f6f8',color:'#182331'} as const;
const header={maxWidth:1180,margin:'0 auto 18px',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:24,flexWrap:'wrap' as const} as const;
const eyebrow={margin:'0 0 7px',fontSize:11,fontWeight:900,letterSpacing:'.16em',color:'#f47b20'} as const;
const title={margin:0,color:'#0d1b2b',fontSize:'clamp(28px,4vw,40px)',lineHeight:1.05} as const;
const subtitle={maxWidth:780,margin:'10px 0 0',color:'#637180',lineHeight:1.5,fontSize:14} as const;
const versionCard={minWidth:185,padding:'14px 16px',border:'1px solid #dce2e7',borderRadius:12,background:'#fff',display:'grid',gap:3,boxShadow:'0 4px 16px #1724350a'} as const;
const kindTabs={maxWidth:1180,margin:'0 auto 14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:6,border:'1px solid #dbe2e8',borderRadius:12,background:'#e9eef2'} as const;
const tab={minHeight:48,border:0,borderRadius:9,background:'transparent',color:'#526273',fontWeight:900,cursor:'pointer'} as const;
const activeTab={...tab,background:'#0d1b2b',color:'#fff',boxShadow:'0 4px 12px #0d1b2b33'} as const;
const safetyBanner={maxWidth:1180,margin:'0 auto 14px',padding:'13px 15px',border:'1px solid #b8d7c5',borderRadius:11,background:'#f0faf4',color:'#24583d',display:'grid',gap:3,fontSize:13} as const;
const notice={maxWidth:1180,margin:'0 auto 14px',padding:'12px 14px',border:'1px solid #f1c66b',borderRadius:10,background:'#fff8e6',color:'#70521a',fontWeight:800,fontSize:13} as const;
const toolbarCard={maxWidth:1180,margin:'0 auto 14px',padding:16,border:'1px solid #dbe2e8',borderRadius:13,background:'#fff',display:'flex',justifyContent:'space-between',alignItems:'end',gap:16,flexWrap:'wrap' as const,boxShadow:'0 4px 16px #17243509'} as const;
const toolbarActions={display:'flex',gap:8,flexWrap:'wrap' as const,alignItems:'center'} as const;
const label={display:'grid',gap:6,color:'#52606d',fontSize:12,fontWeight:850} as const;
const input={width:'100%',minHeight:40,border:'1px solid #cdd6dd',borderRadius:8,padding:'8px 10px',background:'#fff',color:'#182331',outline:'none'} as const;
const helper={color:'#74818d',fontSize:12,lineHeight:1.45} as const;
const primaryButton={minHeight:42,border:0,borderRadius:9,padding:'0 15px',background:'#f47b20',color:'#fff',fontWeight:900,cursor:'pointer',boxShadow:'0 4px 12px #f47b2030'} as const;
const secondaryButton={minHeight:42,border:'1px solid #ccd6de',borderRadius:9,padding:'0 14px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'} as const;
const editorCard={maxWidth:1180,margin:'0 auto 16px',padding:18,border:'1px solid #dbe2e8',borderRadius:14,background:'#fff',boxShadow:'0 5px 20px #1724350a'} as const;
const editorHeading={display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap' as const} as const;
const miniLabel={margin:'0 0 4px',fontSize:10,fontWeight:900,letterSpacing:'.13em',color:'#f47b20'} as const;
const h2={margin:0,color:'#0d1b2b',fontSize:22} as const;
const countBadge={padding:'7px 10px',borderRadius:999,background:'#edf2f5',color:'#526273',fontSize:11,fontWeight:900} as const;
const itemList={marginTop:16,display:'grid',gap:10} as const;
const sectionMarker={margin:'14px 2px 4px',display:'flex',alignItems:'center',gap:8,color:'#17324a'} as const;
const itemCard={padding:14,border:'1px solid #d9e1e8',borderRadius:12,background:'#fbfcfd',display:'grid',gap:12,transition:'.15s ease'} as const;
const itemTop={display:'flex',alignItems:'end',gap:9,flexWrap:'wrap' as const} as const;
const dragHandle={fontSize:22,color:'#95a1ac',cursor:'grab',userSelect:'none' as const} as const;
const itemNumber={width:34,height:34,borderRadius:9,display:'grid',placeItems:'center',background:'#17324a',color:'#fff',fontWeight:950} as const;
const moveButtons={display:'flex',gap:4} as const;
const switchLabel={minHeight:40,display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:850,color:'#52606d'} as const;
const removeButton={minHeight:40,border:'1px solid #e4b7b4',borderRadius:8,padding:'0 10px',background:'#fff7f6',color:'#a43d36',fontWeight:850,cursor:'pointer'} as const;
const optionsGrid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10} as const;
const optionBox={margin:0,minWidth:0,border:'1px solid #dde4e9',borderRadius:10,padding:10,display:'grid',gap:8,color:'#52606d',fontSize:12} as const;
const emptyState={minHeight:140,display:'grid',placeItems:'center',alignContent:'center',gap:5,color:'#7a8792'} as const;
const bottomActions={marginTop:16,display:'flex',justifyContent:'flex-end',gap:8,flexWrap:'wrap' as const} as const;
const historyCard={maxWidth:1180,margin:'0 auto',padding:18,border:'1px solid #dbe2e8',borderRadius:14,background:'#fff'} as const;
const historyList={marginTop:12,display:'grid',gap:7} as const;
const historyRow={padding:'10px 12px',borderRadius:9,background:'#f7f9fb',display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap' as const,fontSize:12} as const;
