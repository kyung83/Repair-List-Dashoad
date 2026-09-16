"use client";

import {useEffect,useMemo,useState,type CSSProperties} from 'react';

type EventType='pm'|'annual';
type AppliesTo='truck'|'trailer';
type TemplateItem={position:number;section:string;text:string;enabled:boolean;allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string};
type Version={id:number;name:string;version:number;active:boolean;createdAt:string;itemCount:number};
type Template={id:number;eventType:EventType;templateKey:string;name:string;version:number;active:boolean;createdAt:string;items:TemplateItem[];versions:Version[]};
type KindData={templates:Template[];assignments:Record<AppliesTo,string>};
type SetupData={pm:KindData;annual:KindData;updatedAt:string};

const blankItem=(section='General'):TemplateItem=>({position:0,section,text:'',enabled:true,allowPass:true,allowFail:true,allowNa:true,requireNotes:false,requirePhoto:false,requireMeasurement:false,measurementLabel:'',measurementUnit:''});
const renumber=(items:TemplateItem[])=>items.map((item,index)=>({...item,position:index+1}));
const cloneItems=(items:TemplateItem[])=>renumber(items.map(item=>({...item})));
const formatDate=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString()};

export default function MaintenanceChecklistEditorClient(){
  const[data,setData]=useState<SetupData|null>(null);
  const[kind,setKind]=useState<EventType>('pm');
  const[target,setTarget]=useState<AppliesTo>('truck');
  const[selectedKey,setSelectedKey]=useState<string|null>(null);
  const[name,setName]=useState('');
  const[items,setItems]=useState<TemplateItem[]>([]);
  const[dirty,setDirty]=useState(false);
  const[saving,setSaving]=useState(false);
  const[message,setMessage]=useState('');
  const[dragIndex,setDragIndex]=useState<number|null>(null);

  function templateFor(payload:SetupData,nextKind:EventType,key:string|null){return key?payload[nextKind].templates.find(template=>template.templateKey===key)??null:null}
  function assignedKey(payload:SetupData,nextKind:EventType,nextTarget:AppliesTo){return payload[nextKind].assignments[nextTarget]||payload[nextKind].templates[0]?.templateKey||null}
  function applyTemplate(payload:SetupData,nextKind:EventType,key:string|null){const template=templateFor(payload,nextKind,key);setSelectedKey(template?.templateKey??null);setName(template?.name??'');setItems(template?cloneItems(template.items):[]);setDirty(false)}
  function applyAssigned(payload:SetupData,nextKind:EventType,nextTarget:AppliesTo){applyTemplate(payload,nextKind,assignedKey(payload,nextKind,nextTarget))}

  async function load(){const response=await fetch('/api/maintenance-checklist-templates',{cache:'no-store'});const payload=await response.json() as SetupData&{error?:string};if(!response.ok)throw new Error(payload.error||'Checklist editor could not be loaded.');setData(payload);applyAssigned(payload,kind,target)}
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:'Checklist editor could not be loaded.'))},[]);

  function confirmDiscard(){return !dirty||window.confirm('Discard the unpublished checklist changes?')}
  function switchKind(next:EventType){if(next===kind)return;if(!confirmDiscard())return;setKind(next);setMessage('');if(data)applyAssigned(data,next,target)}
  function switchTarget(next:AppliesTo){if(next===target)return;if(!confirmDiscard())return;setTarget(next);setMessage('');if(data)applyAssigned(data,kind,next)}
  function selectExisting(key:string){if(!data||!confirmDiscard())return;applyTemplate(data,kind,key);setMessage('')}
  function patch(index:number,patchValue:Partial<TemplateItem>){setItems(current=>renumber(current.map((item,itemIndex)=>itemIndex===index?{...item,...patchValue}:item)));setDirty(true)}
  function addItem(section?:string){const nextSection=section||items.at(-1)?.section||'General';setItems(current=>renumber([...current,blankItem(nextSection)]));setDirty(true)}
  function addSection(){const section=window.prompt('Name the new checklist section:','New Section')?.trim();if(section)addItem(section)}
  function move(index:number,targetIndex:number){if(targetIndex<0||targetIndex>=items.length||index===targetIndex)return;setItems(current=>{const next=[...current];const[picked]=next.splice(index,1);next.splice(targetIndex,0,picked);return renumber(next)});setDirty(true)}
  function remove(index:number){if(!window.confirm('Remove this item from the draft?'))return;setItems(current=>renumber(current.filter((_,itemIndex)=>itemIndex!==index)));setDirty(true)}
  function startBlank(){if(!confirmDiscard())return;setSelectedKey(null);setName(`New ${kind==='annual'?'Annual':'PM'} Template`);setItems([blankItem('General')]);setDirty(true);setMessage('New blank template. Publishing it will also assign it to the selected equipment type.')}
  function copyCurrent(){const template=data&&selectedKey?templateFor(data,kind,selectedKey):null;if(!template)return;if(!confirmDiscard())return;setSelectedKey(null);setName(`${template.name} Copy`);setItems(cloneItems(template.items));setDirty(true);setMessage('Copied into a new template draft. Change the name or questions, then publish.')}

  async function save(){
    if(!items.length)return setMessage('Add at least one checklist item first.');
    if(items.some(item=>!item.section.trim()||!item.text.trim()))return setMessage('Every checklist item needs a section and question before publishing.');
    if(!items.some(item=>item.enabled))return setMessage('At least one checklist item must be enabled.');
    if(items.some(item=>item.enabled&&!item.allowPass&&!item.allowFail&&!item.allowNa))return setMessage('Every enabled item must allow Pass, Fail, or N/A.');
    if(items.some(item=>item.enabled&&item.requireMeasurement&&!item.measurementLabel.trim()))return setMessage('Every required measurement needs a label.');
    const creating=!selectedKey;
    const verb=creating?'Create this template':'Publish a new version';
    if(!window.confirm(`${verb}? PMs or Annuals already started will keep their existing questions.`))return;
    setSaving(true);setMessage('');
    try{
      const response=await fetch('/api/maintenance-checklist-templates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(creating?{action:'create',eventType:kind,name,items,assignTo:target}:{action:'publish',eventType:kind,templateKey:selectedKey,name,items})});
      const payload=await response.json() as SetupData&{ok?:boolean;error?:string;selectedTemplateKey?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Checklist template could not be saved.');
      setData(payload);const key=payload.selectedTemplateKey||selectedKey||assignedKey(payload,kind,target);applyTemplate(payload,kind,key);setMessage(creating?`Template created and assigned to ${target==='trailer'?'trailers':'trucks'}.`:'New template version published. New inspections will use it wherever this template is assigned.');
    }catch(error){setMessage(error instanceof Error?error.message:'Checklist template could not be saved.')}finally{setSaving(false)}
  }

  const kindData=data?.[kind];
  const templates=kindData?.templates??[];
  const currentTemplate=selectedKey?templates.find(template=>template.templateKey===selectedKey)??null:null;
  const assigned=kindData?.assignments[target]??null;
  const isAssigned=Boolean(selectedKey&&assigned===selectedKey);
  const enabledCount=items.filter(item=>item.enabled).length;
  const sectionCount=useMemo(()=>new Set(items.filter(item=>item.enabled).map(item=>item.section.trim()).filter(Boolean)).size,[items]);
  const versions=currentTemplate?.versions??[];

  async function assignSelected(){
    if(!selectedKey)return setMessage('Publish the new template before assigning it.');
    if(dirty)return setMessage('Publish or discard the draft changes before changing the assignment.');
    setSaving(true);setMessage('');
    try{const response=await fetch('/api/maintenance-checklist-templates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'assign',eventType:kind,appliesTo:target,templateKey:selectedKey})});const payload=await response.json() as SetupData&{ok?:boolean;error?:string};if(!response.ok||!payload.ok)throw new Error(payload.error||'Checklist assignment could not be saved.');setData(payload);setMessage(`${currentTemplate?.name||'Template'} is now the ${kind.toUpperCase()} checklist for ${target==='trailer'?'trailers':'trucks'}. Existing inspections are unchanged.`)}catch(error){setMessage(error instanceof Error?error.message:'Checklist assignment could not be saved.')}finally{setSaving(false)}
  }

  return <main style={styles.page}>
    <header style={styles.header}><div><p style={styles.eyebrow}>MAINTENANCE SETUP</p><h1 style={styles.title}>PM & Annual Template Builder</h1><p style={styles.subtitle}>Create reusable checklists from scratch or copy an existing one. Assign different templates to trucks and trailers. In-progress inspections always keep the version they started with.</p></div><div style={styles.stat}><span>SELECTED</span><strong>{currentTemplate?`v${currentTemplate.version}`:'NEW'}</strong><small>{enabledCount} enabled · {sectionCount} sections</small></div></header>
    {message&&<div style={styles.notice}>{message}</div>}

    <section style={styles.choicePanel}>
      <div><p style={styles.eyebrow}>INSPECTION TYPE</p><div style={styles.segment}><button type="button" onClick={()=>switchKind('pm')} style={kind==='pm'?styles.segmentActive:styles.segmentButton}>PM</button><button type="button" onClick={()=>switchKind('annual')} style={kind==='annual'?styles.segmentActive:styles.segmentButton}>Annual</button></div></div>
      <div><p style={styles.eyebrow}>APPLIES TO</p><div style={styles.segment}><button type="button" onClick={()=>switchTarget('truck')} style={target==='truck'?styles.segmentActive:styles.segmentButton}>Trucks</button><button type="button" onClick={()=>switchTarget('trailer')} style={target==='trailer'?styles.segmentActive:styles.segmentButton}>Trailers</button></div></div>
    </section>

    <section style={styles.safe}><strong>Automatic selection for technicians</strong><span>When a technician starts this work, the system uses the template assigned to that unit type. They do not have to choose a checklist.</span></section>

    <section style={styles.panel}>
      <div style={styles.panelHead}><div><p style={styles.eyebrow}>TEMPLATE LIBRARY</p><h2 style={styles.h2}>{kind==='annual'?'Annual':'PM'} templates</h2></div><div style={styles.actions}><button type="button" style={styles.secondary} onClick={startBlank}>+ New Blank Template</button><button type="button" style={styles.secondary} disabled={!currentTemplate} onClick={copyCurrent}>Copy Selected</button></div></div>
      <div style={styles.library}>{templates.map(template=>{const truck=kindData?.assignments.truck===template.templateKey;const trailer=kindData?.assignments.trailer===template.templateKey;const selected=template.templateKey===selectedKey;return <button type="button" key={template.templateKey} onClick={()=>selectExisting(template.templateKey)} style={{...styles.templateCard,...(selected?styles.templateSelected:{})}}><span style={styles.templateName}>{template.name}</span><span style={styles.templateMeta}>v{template.version} · {template.items.filter(item=>item.enabled).length} items</span><span style={styles.tags}>{truck&&<b style={styles.tag}>TRUCKS</b>}{trailer&&<b style={styles.tag}>TRAILERS</b>}{template.templateKey==='default'&&<b style={styles.defaultTag}>ORIGINAL</b>}</span></button>})}</div>
      {!templates.length&&<p style={styles.help}>No templates are available yet.</p>}
      <div style={styles.assignment}><div><strong>{target==='trailer'?'Trailer':'Truck'} assignment</strong><span>{isAssigned?'This selected template is currently assigned.':'The selected template is not currently assigned to this equipment type.'}</span></div><button type="button" style={isAssigned?styles.assignedButton:styles.primary} disabled={!selectedKey||dirty||saving||isAssigned} onClick={()=>void assignSelected()}>{isAssigned?'Assigned':'Use Selected Template'}</button></div>
    </section>

    <section style={styles.toolbar}><label style={{...styles.label,flex:'1 1 320px'}}>Template name<input style={styles.input} value={name} onChange={event=>{setName(event.target.value);setDirty(true)}} placeholder="Example: Trailer PM - Standard"/></label><div style={styles.actions}><button type="button" style={styles.secondary} onClick={addSection}>+ Add Section</button><button type="button" style={styles.secondary} onClick={()=>addItem()}>+ Add Item</button><button type="button" disabled={saving||(!dirty&&Boolean(selectedKey))} style={{...styles.primary,opacity:(saving||(!dirty&&Boolean(selectedKey)))?0.55:1}} onClick={()=>void save()}>{saving?'Saving...':selectedKey?'Publish New Version':'Create Template'}</button></div></section>

    <section style={styles.panel}>
      <div style={styles.panelHead}><div><p style={styles.eyebrow}>CHECKLIST QUESTIONS</p><h2 style={styles.h2}>{name||'New Template'}</h2></div><span style={styles.badge}>{items.length} total · {enabledCount} enabled</span></div>
      <p style={styles.help}>Drag cards or use the arrows to reorder. Disabled items stay in this draft but will not appear on new inspections.</p>
      <div style={styles.list}>{items.map((item,index)=>{const sectionBreak=index===0||items[index-1]?.section!==item.section;return <div key={`${index}-${item.position}`}>{sectionBreak&&<div style={styles.sectionLabel}><strong>{item.section||'Unnamed Section'}</strong><span>SECTION</span></div>}<article draggable onDragStart={()=>setDragIndex(index)} onDragEnd={()=>setDragIndex(null)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(dragIndex!==null)move(dragIndex,index);setDragIndex(null)}} style={{...styles.item,opacity:item.enabled?1:.55,borderColor:dragIndex===index?'#f47b20':'#d9e1e8'}}>
        <div style={styles.itemTop}><span style={styles.drag}>⋮⋮</span><span style={styles.number}>{index+1}</span><label style={{...styles.label,flex:'1 1 220px'}}>Section<input style={styles.input} value={item.section} onChange={event=>patch(index,{section:event.target.value})}/></label><span style={styles.move}><button type="button" disabled={index===0} onClick={()=>move(index,index-1)}>↑</button><button type="button" disabled={index===items.length-1} onClick={()=>move(index,index+1)}>↓</button></span><label style={styles.inlineCheck}><input type="checkbox" checked={item.enabled} onChange={event=>patch(index,{enabled:event.target.checked})}/> Enabled</label><button type="button" style={styles.remove} onClick={()=>remove(index)}>Remove</button></div>
        <label style={styles.label}>Technician question / instruction<textarea style={{...styles.input,minHeight:76,resize:'vertical'}} value={item.text} onChange={event=>patch(index,{text:event.target.value})} placeholder="What should the technician inspect, check, or service?"/></label>
        <div style={styles.options}><fieldset style={styles.option}><legend>Allowed answers</legend><label><input type="checkbox" checked={item.allowPass} onChange={event=>patch(index,{allowPass:event.target.checked})}/> Pass</label><label><input type="checkbox" checked={item.allowFail} onChange={event=>patch(index,{allowFail:event.target.checked})}/> Fail</label><label><input type="checkbox" checked={item.allowNa} onChange={event=>patch(index,{allowNa:event.target.checked})}/> N/A</label></fieldset><fieldset style={styles.option}><legend>Required proof</legend><label><input type="checkbox" checked={item.requireNotes} onChange={event=>patch(index,{requireNotes:event.target.checked})}/> Note</label><label><input type="checkbox" checked={item.requirePhoto} onChange={event=>patch(index,{requirePhoto:event.target.checked})}/> Photo</label><label><input type="checkbox" checked={item.requireMeasurement} onChange={event=>patch(index,{requireMeasurement:event.target.checked,measurementLabel:event.target.checked?(item.measurementLabel||'Measurement'):item.measurementLabel})}/> Measurement</label></fieldset><div style={styles.option}><strong>Measurement</strong><input style={styles.input} value={item.measurementLabel} onChange={event=>patch(index,{measurementLabel:event.target.value})} placeholder="Example: Brake stroke"/><input style={styles.input} value={item.measurementUnit} onChange={event=>patch(index,{measurementUnit:event.target.value})} placeholder="Unit: in, psi, °F..."/></div></div>
      </article></div>})}</div>
      {!items.length&&<div style={styles.empty}><strong>No checklist items.</strong><span>Add an item or start a blank template.</span></div>}
      <div style={{...styles.actions,justifyContent:'flex-end',marginTop:16}}><button type="button" style={styles.secondary} onClick={()=>addItem()}>+ Add Item</button><button type="button" disabled={saving||(!dirty&&Boolean(selectedKey))} style={{...styles.primary,opacity:(saving||(!dirty&&Boolean(selectedKey)))?0.55:1}} onClick={()=>void save()}>{saving?'Saving...':selectedKey?'Publish New Version':'Create Template'}</button></div>
    </section>

    {currentTemplate&&<section style={styles.panel}><p style={styles.eyebrow}>VERSION HISTORY</p><h2 style={styles.h2}>{currentTemplate.name}</h2><div style={styles.historyList}>{versions.map(version=><div key={version.id} style={styles.history}><div><strong>Version {version.version}{version.active?' · ACTIVE':''}</strong><span>{version.name}</span></div><div><strong>{version.itemCount} items</strong><span>{formatDate(version.createdAt)}</span></div></div>)}</div></section>}
  </main>
}

const styles:Record<string,CSSProperties>={
  page:{minHeight:'100vh',padding:'30px clamp(14px,3vw,42px) 70px',background:'#f4f6f8',color:'#182331'},header:{maxWidth:1180,margin:'0 auto 18px',display:'flex',justifyContent:'space-between',gap:24,flexWrap:'wrap'},eyebrow:{margin:'0 0 6px',fontSize:10,fontWeight:900,letterSpacing:'.15em',color:'#f47b20'},title:{margin:0,color:'#0d1b2b',fontSize:'clamp(28px,4vw,40px)',lineHeight:1.05},subtitle:{maxWidth:780,margin:'10px 0 0',color:'#637180',lineHeight:1.5,fontSize:14},h2:{margin:0,color:'#0d1b2b',fontSize:22},stat:{minWidth:190,padding:'14px 16px',border:'1px solid #dce2e7',borderRadius:12,background:'#fff',display:'grid',gap:3},notice:{maxWidth:1180,margin:'0 auto 14px',padding:'12px 14px',border:'1px solid #f1c66b',borderRadius:10,background:'#fff8e6',color:'#70521a',fontWeight:800,fontSize:13},choicePanel:{maxWidth:1180,margin:'0 auto 14px',padding:16,border:'1px solid #dbe2e8',borderRadius:13,background:'#fff',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16},segment:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,padding:5,borderRadius:10,background:'#e9eef2'},segmentButton:{minHeight:44,border:0,borderRadius:8,background:'transparent',fontWeight:900,color:'#526273',cursor:'pointer'},segmentActive:{minHeight:44,border:0,borderRadius:8,background:'#0d1b2b',fontWeight:900,color:'#fff',cursor:'pointer'},safe:{maxWidth:1180,margin:'0 auto 14px',padding:'13px 15px',border:'1px solid #b8d7c5',borderRadius:11,background:'#f0faf4',color:'#24583d',display:'grid',gap:3,fontSize:13},panel:{maxWidth:1180,margin:'0 auto 16px',padding:18,border:'1px solid #dbe2e8',borderRadius:14,background:'#fff'},panelHead:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'},actions:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'},primary:{minHeight:42,border:0,borderRadius:9,padding:'0 15px',background:'#f47b20',color:'#fff',fontWeight:900,cursor:'pointer'},secondary:{minHeight:42,border:'1px solid #ccd6de',borderRadius:9,padding:'0 14px',background:'#fff',color:'#17324a',fontWeight:850,cursor:'pointer'},assignedButton:{minHeight:42,border:'1px solid #a9ccb8',borderRadius:9,padding:'0 14px',background:'#eef8f2',color:'#24583d',fontWeight:900},library:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginTop:14},templateCard:{textAlign:'left',padding:14,border:'1px solid #d9e1e8',borderRadius:11,background:'#fbfcfd',display:'grid',gap:6,cursor:'pointer'},templateSelected:{borderColor:'#f47b20',boxShadow:'0 0 0 2px rgba(244,123,32,.12)'},templateName:{fontWeight:900,color:'#17324a'},templateMeta:{fontSize:12,color:'#6c7985'},tags:{display:'flex',gap:5,flexWrap:'wrap'},tag:{fontSize:9,padding:'4px 6px',borderRadius:999,background:'#17324a',color:'#fff'},defaultTag:{fontSize:9,padding:'4px 6px',borderRadius:999,background:'#edf2f5',color:'#526273'},assignment:{marginTop:14,padding:13,border:'1px solid #dbe2e8',borderRadius:10,background:'#f7f9fb',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'},toolbar:{maxWidth:1180,margin:'0 auto 14px',padding:16,border:'1px solid #dbe2e8',borderRadius:13,background:'#fff',display:'flex',justifyContent:'space-between',alignItems:'end',gap:16,flexWrap:'wrap'},label:{display:'grid',gap:6,color:'#52606d',fontSize:12,fontWeight:850},input:{width:'100%',minHeight:40,border:'1px solid #cdd6dd',borderRadius:8,padding:'8px 10px',background:'#fff',color:'#182331',outline:'none',boxSizing:'border-box'},badge:{padding:'7px 10px',borderRadius:999,background:'#edf2f5',color:'#526273',fontSize:11,fontWeight:900},help:{color:'#74818d',fontSize:12,lineHeight:1.45},list:{display:'grid',gap:10},sectionLabel:{margin:'14px 2px 4px',display:'flex',alignItems:'center',gap:8,color:'#17324a'},item:{padding:14,border:'1px solid #d9e1e8',borderRadius:12,background:'#fbfcfd',display:'grid',gap:12},itemTop:{display:'flex',alignItems:'end',gap:9,flexWrap:'wrap'},drag:{fontSize:22,color:'#95a1ac',cursor:'grab'},number:{width:34,height:34,borderRadius:9,display:'grid',placeItems:'center',background:'#17324a',color:'#fff',fontWeight:900},move:{display:'flex',gap:4},inlineCheck:{minHeight:40,display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:850,color:'#52606d'},remove:{minHeight:40,border:'1px solid #e4b7b4',borderRadius:8,padding:'0 10px',background:'#fff7f6',color:'#a43d36',fontWeight:850},options:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10},option:{margin:0,padding:11,border:'1px solid #dde4e9',borderRadius:9,display:'grid',gap:7,color:'#52606d',fontSize:12},empty:{padding:24,border:'1px dashed #cdd6dd',borderRadius:10,display:'grid',gap:4,textAlign:'center',color:'#6b7884'},historyList:{display:'grid',gap:8,marginTop:12},history:{padding:12,border:'1px solid #e0e6eb',borderRadius:9,display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap'},
};
