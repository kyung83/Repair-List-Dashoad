"use client";

import {useEffect,useMemo,useState} from "react";

type Item={position:number;section:string;text:string;enabled:boolean;allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string};
type Checklist={id:number;name:string;version:number;createdAt:string;items:Item[]}|null;
type RepairType={id:number;name:string;unitRule:"required"|"optional";checklistMode:"none"|"optional"|"required";active:boolean;sortOrder:number;checklist:Checklist};
type Data={types:RepairType[];canManage:boolean;updatedAt:string};
const blankItem=(section="General"):Item=>({position:0,section,text:"",enabled:true,allowPass:true,allowFail:true,allowNa:true,requireNotes:false,requirePhoto:false,requireMeasurement:false,measurementLabel:"",measurementUnit:""});
const renumber=(items:Item[])=>items.map((item,index)=>({...item,position:index+1}));

export default function RepairTypesPage(){
 const[data,setData]=useState<Data|null>(null),[selectedId,setSelectedId]=useState<number|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const[name,setName]=useState(""),[unitRule,setUnitRule]=useState<"required"|"optional">("required"),[checklistMode,setChecklistMode]=useState<"none"|"optional"|"required">("none"),[active,setActive]=useState(true),[sortOrder,setSortOrder]=useState(0),[items,setItems]=useState<Item[]>([]),[checklistName,setChecklistName]=useState("");
 const selected=useMemo(()=>data?.types.find(type=>type.id===selectedId)??null,[data,selectedId]);
 async function load(){const response=await fetch("/api/repair-types",{cache:"no-store"});const payload=await response.json() as Data&{error?:string};if(!response.ok)throw new Error(payload.error||"Repair types could not be loaded.");setData(payload);if(selectedId===null&&payload.types[0])choose(payload.types[0])}
 function choose(type:RepairType){setSelectedId(type.id);setName(type.name);setUnitRule(type.unitRule);setChecklistMode(type.checklistMode);setActive(type.active);setSortOrder(type.sortOrder);setItems(type.checklist?type.checklist.items.map(item=>({...item})):[]);setChecklistName(type.checklist?.name||`${type.name} Checklist`);setMessage("")}
 useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Repair types could not be loaded."))},[]);
 function patchItem(index:number,patch:Partial<Item>){setItems(current=>renumber(current.map((item,i)=>i===index?{...item,...patch}:item)))}
 async function post(body:Record<string,unknown>){setBusy(true);setMessage("");try{const response=await fetch("/api/repair-types",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const payload=await response.json() as Data&{ok?:boolean;error?:string};if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair type change failed.");setData(payload);const next=selectedId?payload.types.find(type=>type.id===selectedId):null;if(next)choose(next);return true}catch(error){setMessage(error instanceof Error?error.message:"Repair type change failed.");return false}finally{setBusy(false)}}
 async function saveType(){if(!selected)return;const ok=await post({action:"update",id:selected.id,name,unitRule,checklistMode,active,sortOrder});if(ok)setMessage("Repair type saved.")}
 async function addType(){const value=window.prompt("New repair type name:")?.trim();if(!value)return;const ok=await post({action:"create",name:value,unitRule:"required",checklistMode:"none"});if(ok){setMessage("Repair type added. Select it below to edit.")}}
 async function publishChecklist(){if(!selected)return;if(checklistMode==="none"){setMessage("Change Checklist to Optional or Required first, then save the repair type.");return}if(!items.length){setMessage("Add at least one checklist item first.");return}if(!window.confirm("Publish this checklist version? Inspections already started will keep their existing questions."))return;const ok=await post({action:"publishChecklist",id:selected.id,name:checklistName,items});if(ok)setMessage("Checklist published. New work orders will use this version.")}
 function addItem(){setItems(current=>renumber([...current,blankItem(current.at(-1)?.section||"General")]))}
 function addSection(){const section=window.prompt("Section name:","General")?.trim();if(section)setItems(current=>renumber([...current,blankItem(section)]))}
 return <main style={page}>
  <header style={header}><div><p style={eyebrow}>SETUP</p><h1 style={title}>Repair Types</h1><p style={sub}>These are the categories mechanics, work orders, review, and reporting use. You can add, rename, reorder, or disable them later.</p></div><button style={primary} onClick={()=>void addType()} disabled={busy}>+ ADD REPAIR TYPE</button></header>
  {message&&<div style={notice}>{message}</div>}
  <div style={layout}>
   <aside style={list}>{(data?.types??[]).map(type=><button key={type.id} onClick={()=>choose(type)} style={{...typeButton,...(type.id===selectedId?selectedButton:{})}}><strong>{type.sortOrder}. {type.name}</strong><span>{type.unitRule==="optional"?"Unit optional":"Unit required"}{type.checklistMode!=="none"?` · ${type.checklistMode} checklist`:""}{!type.active?" · DISABLED":""}</span></button>)}</aside>
   <section style={panel}>{selected?<>
    <div style={grid}><label style={label}>REPAIR TYPE<input style={input} value={name} onChange={event=>setName(event.target.value)}/></label><label style={label}>ORDER<input style={input} type="number" value={sortOrder} onChange={event=>setSortOrder(Number(event.target.value))}/></label><label style={label}>UNIT<select style={input} value={unitRule} onChange={event=>setUnitRule(event.target.value as "required"|"optional")}><option value="required">Required</option><option value="optional">Optional</option></select></label><label style={label}>CHECKLIST<select style={input} value={checklistMode} onChange={event=>setChecklistMode(event.target.value as "none"|"optional"|"required")}><option value="none">No checklist</option><option value="optional">Checklist available</option><option value="required">Checklist required</option></select></label><label style={check}><input type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)}/> Active</label></div>
    <button style={primary} onClick={()=>void saveType()} disabled={busy}>SAVE REPAIR TYPE</button>
    {name.toUpperCase()==="INDIRECT LABOR-OTHER"&&<div style={info}><strong>Shop / No Unit labor</strong><span>Unit is optional. Mechanics can start this from My Jobs and the labor will not be charged to a truck or trailer.</span></div>}
    {checklistMode!=="none"&&<section style={checklistPanel}><div style={sectionHead}><div><p style={eyebrow}>CHECK SHEET</p><h2 style={h2}>{name}</h2><p style={sub}>{selected.checklist?`Current version v${selected.checklist.version}. Publishing creates a new version.`:"No checklist published yet."}</p></div><div style={actions}><button style={secondary} onClick={addSection}>+ Section</button><button style={secondary} onClick={addItem}>+ Item</button></div></div><label style={label}>CHECKLIST NAME<input style={input} value={checklistName} onChange={event=>setChecklistName(event.target.value)}/></label><div style={itemsStyle}>{items.map((item,index)=><article key={index} style={itemCard}><div style={itemTop}><strong>#{index+1}</strong><input style={input} value={item.section} onChange={event=>patchItem(index,{section:event.target.value})} placeholder="Section"/><label style={check}><input type="checkbox" checked={item.enabled} onChange={event=>patchItem(index,{enabled:event.target.checked})}/> Enabled</label><button style={remove} onClick={()=>setItems(current=>renumber(current.filter((_,i)=>i!==index)))}>Remove</button></div><textarea style={{...input,minHeight:68}} value={item.text} onChange={event=>patchItem(index,{text:event.target.value})} placeholder="What should the technician inspect or verify?"/><div style={optionRow}><label><input type="checkbox" checked={item.allowPass} onChange={event=>patchItem(index,{allowPass:event.target.checked})}/> Pass</label><label><input type="checkbox" checked={item.allowFail} onChange={event=>patchItem(index,{allowFail:event.target.checked})}/> Fail</label><label><input type="checkbox" checked={item.allowNa} onChange={event=>patchItem(index,{allowNa:event.target.checked})}/> N/A</label><label><input type="checkbox" checked={item.requireNotes} onChange={event=>patchItem(index,{requireNotes:event.target.checked})}/> Require note</label><label><input type="checkbox" checked={item.requirePhoto} onChange={event=>patchItem(index,{requirePhoto:event.target.checked})}/> Require photo</label><label><input type="checkbox" checked={item.requireMeasurement} onChange={event=>patchItem(index,{requireMeasurement:event.target.checked})}/> Measurement</label></div>{item.requireMeasurement&&<div style={measure}><input style={input} value={item.measurementLabel} onChange={event=>patchItem(index,{measurementLabel:event.target.value})} placeholder="Measurement label"/><input style={input} value={item.measurementUnit} onChange={event=>patchItem(index,{measurementUnit:event.target.value})} placeholder="Unit, e.g. in, psi"/></div>}</article>)}</div><button style={primary} onClick={()=>void publishChecklist()} disabled={busy}>PUBLISH CHECKLIST VERSION</button></section>}
   </>:<div>Select a repair type.</div>}</section>
  </div>
 </main>
}

const page={minHeight:"100vh",background:"#f3f5f7",padding:"28px clamp(12px,3vw,34px) 80px",color:"#172a3b"} as const;
const header={maxWidth:1300,margin:"0 auto",display:"flex",justifyContent:"space-between",gap:16,alignItems:"end",flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,fontSize:10,fontWeight:950,letterSpacing:".13em",color:"#f47b20"} as const;
const title={margin:"5px 0",fontSize:34,color:"#102a43"} as const;
const sub={margin:"4px 0 0",fontSize:13,color:"#687783",lineHeight:1.45} as const;
const notice={maxWidth:1300,margin:"14px auto 0",padding:11,border:"1px solid #f2c66d",borderRadius:9,background:"#fff8e6",fontWeight:800,fontSize:13} as const;
const layout={maxWidth:1300,margin:"16px auto 0",display:"grid",gridTemplateColumns:"minmax(250px,340px) minmax(0,1fr)",gap:14} as const;
const list={display:"grid",gap:7,alignContent:"start"} as const;
const typeButton={border:"1px solid #d3dde5",borderRadius:10,background:"white",padding:"11px 12px",textAlign:"left" as const,display:"grid",gap:3,cursor:"pointer",color:"#1c2f40"} as const;
const selectedButton={borderColor:"#176fe6",boxShadow:"0 0 0 2px #176fe622"} as const;
const panel={border:"1px solid #d8e0e7",borderRadius:13,background:"white",padding:16,display:"grid",gap:14} as const;
const grid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,alignItems:"end"} as const;
const label={display:"grid",gap:5,fontSize:10,fontWeight:950,color:"#5f6f7d",letterSpacing:".05em"} as const;
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c9d4dd",borderRadius:8,padding:"9px 10px",fontSize:13,background:"white",color:"#172a3b"} as const;
const check={display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:850} as const;
const primary={border:0,borderRadius:9,padding:"10px 14px",background:"#102a43",color:"white",fontWeight:950,cursor:"pointer",width:"fit-content"} as const;
const secondary={border:"1px solid #cbd5dd",borderRadius:8,padding:"8px 10px",background:"white",fontWeight:850,cursor:"pointer"} as const;
const info={padding:12,border:"1px solid #b8d7c6",borderRadius:10,background:"#eef8f2",display:"grid",gap:3,fontSize:12} as const;
const checklistPanel={borderTop:"1px solid #e0e6eb",paddingTop:14,display:"grid",gap:12} as const;
const sectionHead={display:"flex",justifyContent:"space-between",gap:12,alignItems:"end",flexWrap:"wrap" as const} as const;
const h2={margin:"4px 0 0",fontSize:22,color:"#17324a"} as const;
const actions={display:"flex",gap:7,flexWrap:"wrap" as const} as const;
const itemsStyle={display:"grid",gap:9} as const;
const itemCard={border:"1px solid #d8e0e7",borderRadius:10,padding:11,display:"grid",gap:8,background:"#fbfcfd"} as const;
const itemTop={display:"grid",gridTemplateColumns:"auto minmax(140px,1fr) auto auto",gap:8,alignItems:"center"} as const;
const optionRow={display:"flex",gap:12,flexWrap:"wrap" as const,fontSize:12,fontWeight:750} as const;
const measure={display:"grid",gridTemplateColumns:"1fr 140px",gap:8} as const;
const remove={border:0,background:"transparent",color:"#a3382d",fontWeight:900,cursor:"pointer"} as const;
