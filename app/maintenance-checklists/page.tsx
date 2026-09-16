"use client";

import {useEffect,useMemo,useState} from 'react';

type EventType='pm'|'annual';
type TemplateItem={position:number;section:string;text:string;enabled:boolean;allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string};
type Template={id:number;eventType:EventType;templateKey:string;name:string;version:number;active:boolean;createdAt:string;items:TemplateItem[]};
type Version={id:number;name:string;version:number;active:boolean;createdAt:string;itemCount:number};
type KindData={active:Template;versions:Version[]};
type SetupData={pm:KindData;annual:KindData;updatedAt:string};

const blankItem=(section='New Section'):TemplateItem=>({position:0,section,text:'',enabled:true,allowPass:true,allowFail:true,allowNa:true,requireNotes:false,requirePhoto:false,requireMeasurement:false,measurementLabel:'',measurementUnit:''});
const renumber=(items:TemplateItem[])=>items.map((item,index)=>({...item,position:index+1}));
const formatDate=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString()};

export default function MaintenanceChecklistEditorPage(){
  const[data,setData]=useState<SetupData|null>(null),[kind,setKind]=useState<EventType>('pm'),[name,setName]=useState(''),[items,setItems]=useState<TemplateItem[]>([]),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[dragIndex,setDragIndex]=useState<number|null>(null);

  function applyTemplate(nextKind:EventType,payload:SetupData){const template=payload[nextKind].active;setName(template.name);setItems(renumber(template.items.map(item=>({...item}))));setDirty(false)}
  async function load(){const response=await fetch('/api/maintenance-checklist-templates',{cache:'no-store'}),payload=await response.json() as SetupData&{error?:string};if(!response.ok)throw new Error(payload.error||'Checklist editor could not be loaded.');setData(payload);applyTemplate(kind,payload)}
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Checklist editor could not be loaded.'))},[]);

  function switchKind(next:EventType){if(next===kind)return;if(dirty&&!window.confirm('Discard the unpublished checklist changes?'))return;setKind(next);setMessage('');if(data)applyTemplate(next,data)}
  function patch(index:number,patchValue:Partial<TemplateItem>){setItems(current=>renumber(current.map((item,itemIndex)=>itemIndex===index?{...item,...patchValue}:item)));setDirty(true)}
  function addItem(section?:string){const nextSection=section||items.at(-1)?.section||'New Section';setItems(current=>renumber([...current,blankItem(nextSection)]));setDirty(true)}
  function addSection(){const section=window.prompt('Name the new checklist section:','New Section')?.trim();if(section)addItem(section)}
  function move(index:number,target:number){if(target<0||target>=items.length||index===target)return;setItems(current=>{const next=[...current];const[picked]=next.splice(index,1);next.splice(target,0,picked);return renumber(next)});setDirty(true)}
  function remove(index:number){const item=items[index];if(!window.confirm(`Remove item ${index+1}${item?.text?`: ${item.text}`:''} from the new version?`))return;setItems(current=>renumber(current.filter((_,itemIndex)=>itemIndex!==index)));setDirty(true)}

  async function publish(){
    if(!items.length)return setMessage('Add at least one checklist item first.');
    if(items.some(item=>!item.section.trim()||!item.text.trim()))return setMessage('Every checklist item needs a section and question before publishing.');
    if(!items.some(item=>item.enabled))return setMessage('At least one checklist item must be enabled.');
    if(!window.confirm(`Publish this as a new ${kind==='annual'?'Annual':'PM'} checklist version? Inspections already started will keep their existing questions.`))return;
    setSaving(true);setMessage('');
    try{const response=await fetch('/api/maintenance-checklist-templates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'publish',eventType:kind,name,items})}),payload=await response.json() as SetupData&{ok?:boolean;error?:string};if(!response.ok||!payload.ok)throw new Error(payload.error||'Checklist version could not be published.');setData(payload);applyTemplate(kind,payload);setMessage(`${kind==='annual'?'Annual':'PM'} checklist version ${payload[kind].active.version} published. New inspections will use it.`)}catch(error){setMessage(error instanceof Error?error.message:'Checklist version could not be published.')}finally{setSaving(false)}
  }

  const active=data?.[kind].active,versions=data?.[kind].versions??[],enabledCount=items.filter(item=>item.enabled).length,sectionCount=useMemo(()=>new Set(items.filter(item=>item.enabled).map(item=>item.section.trim()).filter(Boolean)).size,[items]);
  const publishDisabled=saving||!dirty;

  return <main style={styles.page}>
    <header style={styles.header}><div><p style={styles.eyebrow}>MAINTENANCE SETUP</p><h1 style={styles.title}>PM & Annual Checklist Editor</h1><p style={styles.subtitle}>Build the exact inspection your technicians see. Publishing creates a new version; PMs or Annuals already started keep the version they started with.</p></div><div style={styles.version}><span>ACTIVE VERSION</span><strong>v{active?.version??'—'}</strong><small>{enabledCount} enabled · {sectionCount} sections</small></div></header>
    {message&&<div style={styles.notice}>{message}</div>}
    <nav style={styles.tabs}><button onClick={()=>switchKind('pm')} style={kind==='pm'?styles.activeTab:styles.tab}>PM Inspection</button><button onClick={()=>switchKind('annual')} style={kind==='annual'?styles.activeTab:styles.tab}>Annual Inspection</button></nav>
    <section style={styles.safe}><strong>Safe editing</strong><span>Changes stay as a draft until Publish. New versions only affect inspections started afterward; in-progress and completed inspections keep their original questions.</span></section>

    <section style={styles.toolbar}><label style={styles.label}>Checklist name<input style={styles.input} value={name} onChange={event=>{setName(event.target.value);setDirty(true)}}/></label><div style={styles.actions}><button style={styles.secondary} onClick={addSection}>+ Add Section</button><button style={styles.secondary} onClick={()=>addItem()}>+ Add Item</button><button disabled={publishDisabled} style={{...styles.primary,opacity:publishDisabled?.55:1}} onClick={()=>void publish()}>{saving?'Publishing...':'Publish New Version'}</button></div></section>

    <section style={styles.panel}>
      <div style={styles.panelHead}><div><p style={styles.eyebrow}>CHECKLIST QUESTIONS</p><h2 style={styles.h2}>{kind==='annual'?'Annual Inspection':'PM Inspection'}</h2></div><span style={styles.badge}>{items.length} total · {enabledCount} enabled</span></div>
      <p style={styles.help}>Drag cards to reorder, or use ↑ ↓. Disable hides an item from new inspections without deleting it from this draft. Remove drops it from the new version.</p>
      <div style={styles.list}>{items.map((item,index)=>{const sectionBreak=index===0||items[index-1]?.section!==item.section;return <div key={`${item.position}-${index}`}>{sectionBreak&&<div style={styles.section}><strong>{item.section||'Unnamed Section'}</strong><span>SECTION</span></div>}<article draggable onDragStart={()=>setDragIndex(index)} onDragEnd={()=>setDragIndex(null)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(dragIndex!=null)move(dragIndex,index);setDragIndex(null)}} style={{...styles.item,opacity:item.enabled?1:.55,borderColor:dragIndex===index?'#f47b20':'#d9e1e8'}}>
        <div style={styles.itemTop}><span style={styles.drag}>⋮⋮</span><span style={styles.number}>{index+1}</span><label style={{...styles.label,flex:1}}>Section<input style={styles.input} value={item.section} onChange={event=>patch(index,{section:event.target.value})}/></label><span style={styles.move}><button disabled={index===0} onClick={()=>move(index,index-1)}>↑</button><button disabled={index===items.length-1} onClick={()=>move(index,index+1)}>↓</button></span><label style={styles.check}><input type="checkbox" checked={item.enabled} onChange={event=>patch(index,{enabled:event.target.checked})}/> Enabled</label><button style={styles.remove} onClick={()=>remove(index)}>Remove</button></div>
        <label style={styles.label}>Technician question / instruction<textarea style={{...styles.input,minHeight:76,resize:'vertical'}} value={item.text} onChange={event=>patch(index,{text:event.target.value})} placeholder="What should the technician inspect, check, or service?"/></label>
        <div style={styles.options}><fieldset style={styles.option}><legend>Allowed answers</legend><label><input type="checkbox" checked={item.allowPass} onChange={event=>patch(index,{allowPass:event.target.checked})}/> Pass</label><label><input type="checkbox" checked={item.allowFail} onChange={event=>patch(index,{allowFail:event.target.checked})}/> Fail</label><label><input type="checkbox" checked={item.allowNa} onChange={event=>patch(index,{allowNa:event.target.checked})}/> N/A</label></fieldset><fieldset style={styles.option}><legend>Required proof</legend><label><input type="checkbox" checked={item.requireNotes} onChange={event=>patch(index,{requireNotes:event.target.checked})}/> Require note</label><label><input type="checkbox" checked={item.requirePhoto} onChange={event=>patch(index,{requirePhoto:event.target.checked})}/> Require photo</label><label><input type="checkbox" checked={item.requireMeasurement} onChange={event=>patch(index,{requireMeasurement:event.target.checked,measurementLabel:event.target.checked?(item.measurementLabel||'Measurement'):item.measurementLabel})}/> Require measurement</label></fieldset><div style={styles.option}><strong>Measurement</strong><input style={styles.input} value={item.measurementLabel} onChange={event=>patch(index,{measurementLabel:event.target.value})} placeholder="Example: Brake stroke"/><input style={styles.input} value={item.measurementUnit} onChange={event=>patch(index,{measurementUnit:event.target.value})} placeholder="Unit: in, psi, °F..."/></div></div>
      </article></div>})}</div>
      {!items.length&&<div style={styles.empty}><strong>No checklist items.</strong><span>Add a section or item to begin.</span></div>}
      <div style={{...styles.actions,justifyContent:'flex-end',marginTop:16}}><button style={styles.secondary} onClick={()=>addItem()}>+ Add Item</button><button disabled={publishDisabled} style={{...styles.primary,opacity:publishDisabled?.55:1}} onClick={()=>void publish()}>{saving?'Publishing...':'Publish New Version'}</button></div>
    </section>

    <section style={styles.panel}><p style={styles.eyebrow}>VERSION HISTORY</p><h2 style={styles.h2}>{kind==='annual'?'Annual':'PM'} checklist versions</h2><div style={{...styles.list,marginTop:12}}>{versions.map(version=><div key={version.id} style={styles.history}><div><strong>Version {version.version}{version.active?' · ACTIVE':''}</strong><span>{version.name}</span></div><div><strong>{version.itemCount} items</strong><span>{formatDate(version.createdAt)}</span></div></div>)}</div></section>
  </main>
}

const styles={
  page:{minHeight:'100vh',padding:'30px clamp(14px,3vw,42px) 70px',background:'#f4f6f8',color:'#182331'},
  header:{maxWidth:1180,margin:'0 auto 18px',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:24,flexWrap:'wrap' as const},
  eyebrow:{margin:'0 0 6px',fontSize:10,fontWeight:900,letterSpacing:'.15em',color:'#f47b20'},title:{margin:0,color:'#0d1b2b',fontSize:'clamp(28px,4vw,40px)',lineHeight:1.05},subtitle:{maxWidth:780,margin:'10px 0 0',color:'#637180',lineHeight:1.5,fontSize:14},h2:{margin:0,color:'#0d1b2b',fontSize:22},
  version:{minWidth:190,padding:'14px 16px',border:'1px solid #dce2e7',borderRadius:12,background:'#fff',display:'grid',gap:3},notice:{maxWidth:1180,margin:'0 auto 14px',padding:'12px 14px',border:'1px solid #f1c66b',borderRadius:10,background:'#fff8e6',color:'#70521a',fontWeight:800,fontSize:13},
  tabs:{maxWidth:1180,margin:'0 auto 14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:6,border:'1px solid #dbe2e8',borderRadius:12,background:'#e9eef2'},tab:{minHeight:48,border:0,borderRadius:9,background:'transparent',color:'#526273',fontWeight:900,cursor:'pointer'},activeTab:{minHeight:48,border:0,borderRadius:9,background:'#0d1b2b',color:'#fff',fontWeight:900,cursor:'pointer'},
  safe:{maxWidth:1180,margin:'0 auto 14px',padding:'13px 15px',border:'1px solid #b8d7c5',borderRadius:11,background:'#f0faf4',color:'#24583d',display:'grid',gap:3,fontSize:13},toolbar:{maxWidth:1180,margin:'0 auto 14px',padding:16,border:'1px solid #dbe2e8',borderRadius:13,background:'#fff',display:'flex',justifyContent:'space-between',alignItems:'end',gap:16,flexWrap:'wrap' as const},actions:{display:'flex',gap:8,flexWrap:'wrap' as const,alignItems:'center'},
  label:{display:'grid',gap:6,color:'#52606d',fontSize:12,fontWeight:850},input:{width:'100%',minHeight:40,border:'1px solid #cdd6dd',borderRadius:8,padding:'8px 10px',background:'#fff',color:'#182331',outline:'none'},primary:{minHeight:42,border:0,borderRadius:9,padding:'0 15px',background:'#f47b20',color:'#fff',fontWeight:900,cursor:'pointer'},secondary:{minHeight:42,border:'1px solid #ccd6de',borderRadius:9,padding:'0 14px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'},
  panel:{maxWidth:1180,margin:'0 auto 16px',padding:18,border:'1px solid #dbe2e8',borderRadius:14,background:'#fff'},panelHead:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap' as const},badge:{padding:'7px 10px',borderRadius:999,background:'#edf2f5',color:'#526273',fontSize:11,fontWeight:900},help:{color:'#74818d',fontSize:12,lineHeight:1.45},list:{display:'grid',gap:10},section:{margin:'14px 2px 4px',display:'flex',alignItems:'center',gap:8,color:'#17324a'},
  item:{padding:14,border:'1px solid #d9e1e8',borderRadius:12,background:'#fbfcfd',display:'grid',gap:12},itemTop:{display:'flex',alignItems:'end',gap:9,flexWrap:'wrap' as const},drag:{fontSize:22,color:'#95a1ac',cursor:'grab'},number:{width:34,height:34,borderRadius:9,display:'grid',placeItems:'center',background:'#17324a',color:'#fff',fontWeight:950},move:{display:'flex',gap:4},check:{minHeight:40,display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:850,color:'#52606d'},remove:{minHeight:40,border:'1px solid #e4b7b4',borderRadius:8,padding:'0 10px',background:'#fff7f6',color:'#a43d36',fontWeight:850},
  options:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10},option:{margin:0,minWidth:0,border:'1px solid #dde4e9',borderRadius:10,padding:10,display:'grid',gap:8,color:'#52606d',fontSize:12},empty:{minHeight:140,display:'grid',placeItems:'center',alignContent:'center',gap:5,color:'#7a8792'},history:{padding:'10px 12px',borderRadius:9,background:'#f7f9fb',display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap' as const,fontSize:12}
} as const;
