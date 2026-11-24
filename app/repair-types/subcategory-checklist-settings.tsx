"use client";
import {useEffect,useState} from "react";
import type {RepairSubcategory} from "@/lib/repair-subcategories";
type Item={position:number;section:string;text:string;enabled:boolean;allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string};
type Checklist={id:number;name:string;version:number;createdAt:string;items:Item[]}|null;

type Mode="inherit"|"none"|"optional"|"required";
type Config={subcategory:{id:number;name:string;repairTypeId:number;checklistMode:Mode;parentName:string;parentMode:"none"|"optional"|"required"};checklist:Checklist;parentChecklist:Checklist;ok?:boolean;error?:string};
const blankItem=(section="General"):Item=>({position:0,section,text:"",enabled:true,allowPass:true,allowFail:true,allowNa:true,requireNotes:false,requirePhoto:false,requireMeasurement:false,measurementLabel:"",measurementUnit:""});
const renumber=(items:Item[])=>items.map((item,index)=>({...item,position:index+1}));


function Editor({item,parentName}:{item:RepairSubcategory;parentName:string}){
 const[data,setData]=useState<Config|null>(null),[mode,setMode]=useState<Mode>("inherit"),[items,setItems]=useState<Item[]>([]),[checklistName,setChecklistName]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 function apply(payload:Config){setData(payload);setMode(payload.subcategory.checklistMode);setItems(payload.checklist?.items.map(i=>({...i}))??[]);setChecklistName(payload.checklist?.name||parentName+" / "+item.name+" Checklist");}
 useEffect(()=>{
  const controller=new AbortController();
  fetch("/api/repair-types?subcategoryId="+item.id,{cache:"no-store",signal:controller.signal}).then(async response=>{const payload=await response.json() as Config;if(!response.ok)throw new Error(payload.error||"Checklist setup could not be loaded.");if(!controller.signal.aborted)apply(payload);}).catch(error=>{if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Checklist setup could not be loaded.");});
  return()=>controller.abort();
 },[item.id]);
 function patchItem(index:number,patch:Partial<Item>){setItems(current=>renumber(current.map((v,i)=>i===index?{...v,...patch}:v)))}
 function addItem(){setItems(current=>renumber([...current,blankItem(current.at(-1)?.section||"General")]))}
 function addSection(){const section=window.prompt("Section name:","General")?.trim();if(section)setItems(current=>renumber([...current,blankItem(section)]))}
 async function post(body:Record<string,unknown>){
  setBusy(true);setMessage("");
  try{const response=await fetch("/api/repair-types",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const payload=await response.json() as Config;if(!response.ok||!payload.ok)throw new Error(payload.error||"Checklist change failed.");apply(payload);setMessage("Saved. Already-started checklists keep their original version.");}
  catch(error){setMessage(error instanceof Error?error.message:"Checklist change failed.");}finally{setBusy(false);}
 }
 async function publishChecklist(){
  if(mode!=="optional"&&mode!=="required")return;
  if(!items.length||!items.some(i=>i.enabled)){setMessage("Add at least one enabled question.");return;}
  if(!window.confirm("Publish this subcategory checklist? Existing started checklists keep their original questions and answers."))return;
  await post({action:"publishChecklist",id:item.repairTypeId,subcategoryId:item.id,checklistMode:mode,name:checklistName,items});
 }
 async function saveMode(){
  if(!data)return;
  if(data.subcategory.parentMode==="required"&&(mode==="none"||mode==="optional")&&!window.confirm("This selection overrides the parent required checklist. Continue?"))return;
  await post({action:"saveSubcategoryChecklistMode",subcategoryId:item.id,checklistMode:mode});
 }
 const own=mode==="required"||mode==="optional";
 return <section style={{...checklistPanel,border:"1px solid #cbd9d3",borderRadius:10,padding:14}}>
  <div><p style={{fontSize:10,fontWeight:950,color:"#2f6f60",margin:0,letterSpacing:".1em"}}>SUBCATEGORY CHECK SHEET</p><h2 style={h2}>{item.name}</h2><p style={sub}>The subcategory is still required. This setting controls only its checklist.</p></div>
  {message&&<div role="status" style={{background:"#fff8e6",padding:10,borderRadius:8,fontSize:12}}>{message}</div>}
  {!data?<p style={sub}>Loading checklist settings…</p>:<>
   <label style={label}>CHECKLIST FOR THIS SUBCATEGORY<select style={input} value={mode} disabled={busy} onChange={event=>setMode(event.target.value as Mode)}><option value="inherit">Use main Repair Type checklist (default)</option><option value="none">No checklist</option><option value="optional">Own checklist — optional</option><option value="required">Own checklist — required</option></select></label>
   <p style={sub}>Parent setting: {data.subcategory.parentMode}. {mode==="inherit"?"This subcategory follows the parent checklist and its future versions.":mode==="none"?"New work in this subcategory will not have a checklist.":"This subcategory uses its own sheet instead of the parent sheet."}</p>
   {data.subcategory.parentMode==="required"&&(mode==="none"||mode==="optional")&&<p style={{...sub,color:"#965a1f"}}>This selection overrides the parent required checklist.</p>}
   <button style={secondary} disabled={busy||mode===data.subcategory.checklistMode||(own&&!data.checklist)} onClick={()=>void saveMode()}>Save checklist setting</button>
   {own&&<><div style={sectionHead}><div><p style={sub}>{data.checklist?"Published version v"+data.checklist.version:"No own checklist published yet. Publish to enable the selected mode."}</p></div><div style={actions}><button style={secondary} disabled={busy} onClick={addSection}>+ Section</button><button style={secondary} disabled={busy} onClick={addItem}>+ Item</button>{data.parentChecklist&&<button style={secondary} disabled={busy} onClick={()=>{if(items.length&&!window.confirm("Replace the draft questions with a copy of the main checklist?"))return;setItems(renumber(data.parentChecklist!.items.map(i=>({...i}))));}}>Copy main checklist</button>}</div></div>
   <label style={label}>CHECKLIST NAME<input style={input} value={checklistName} onChange={event=>setChecklistName(event.target.value)}/></label><div style={itemsStyle}>{items.map((item,index)=><article key={index} style={itemCard}><div style={itemTop}><strong>#{index+1}</strong><input style={input} value={item.section} onChange={event=>patchItem(index,{section:event.target.value})} placeholder="Section"/><label style={check}><input type="checkbox" checked={item.enabled} onChange={event=>patchItem(index,{enabled:event.target.checked})}/> Enabled</label><button style={remove} onClick={()=>setItems(current=>renumber(current.filter((_,i)=>i!==index)))}>Remove</button></div><textarea style={{...input,minHeight:68}} value={item.text} onChange={event=>patchItem(index,{text:event.target.value})} placeholder="What should the technician inspect or verify?"/><div style={optionRow}><label><input type="checkbox" checked={item.allowPass} onChange={event=>patchItem(index,{allowPass:event.target.checked})}/> Pass</label><label><input type="checkbox" checked={item.allowFail} onChange={event=>patchItem(index,{allowFail:event.target.checked})}/> Fail</label><label><input type="checkbox" checked={item.allowNa} onChange={event=>patchItem(index,{allowNa:event.target.checked})}/> N/A</label><label><input type="checkbox" checked={item.requireNotes} onChange={event=>patchItem(index,{requireNotes:event.target.checked})}/> Require note</label><label><input type="checkbox" checked={item.requirePhoto} onChange={event=>patchItem(index,{requirePhoto:event.target.checked})}/> Require photo</label><label><input type="checkbox" checked={item.requireMeasurement} onChange={event=>patchItem(index,{requireMeasurement:event.target.checked})}/> Measurement</label></div>{item.requireMeasurement&&<div style={measure}><input style={input} value={item.measurementLabel} onChange={event=>patchItem(index,{measurementLabel:event.target.value})} placeholder="Measurement label"/><input style={input} value={item.measurementUnit} onChange={event=>patchItem(index,{measurementUnit:event.target.value})} placeholder="Unit, e.g. in, psi"/></div>}</article>)}</div>
   <button style={primary} disabled={busy} onClick={()=>{if(data.subcategory.parentMode==="required"&&mode==="optional"&&!window.confirm("This makes the new checklist optional instead of the parent required checklist. Continue?"))return;void publishChecklist();}}>PUBLISH SUBCATEGORY CHECKLIST VERSION</button></>}
  </>}
 </section>;
}
export default function SubcategoryChecklistSettings({items,parentName}:{items:RepairSubcategory[];parentName:string}){
 const [selected,setSelected]=useState<number|null>(null);
 const item=items.find(s=>s.id===selected);
 if(!items.length)return null;
 return <section style={checklistPanel}><label style={label}>EDIT INDIVIDUAL SUBCATEGORY CHECKLIST<select style={input} value={selected??""} onChange={e=>setSelected(e.target.value?Number(e.target.value):null)}><option value="">Choose a subcategory…</option>{items.map(s=><option key={s.id} value={s.id}>{s.name}{s.active?"":" · DISABLED"}</option>)}</select></label>{item&&<Editor key={item.id} item={item} parentName={parentName}/>}</section>;
}
const sub={margin:"4px 0 0",fontSize:13,color:"#687783",lineHeight:1.45} as const;
const label={display:"grid",gap:5,fontSize:10,fontWeight:950,color:"#5f6f7d",letterSpacing:".05em"} as const;
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c9d4dd",borderRadius:8,padding:"9px 10px",fontSize:13,background:"white",color:"#1b2421"} as const;
const check={display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:850} as const;
const primary={border:0,borderRadius:9,padding:"10px 14px",background:"#173f37",color:"white",fontWeight:950,cursor:"pointer",width:"fit-content"} as const;
const secondary={border:"1px solid #c9d4cf",borderRadius:8,padding:"8px 10px",background:"white",fontWeight:850,cursor:"pointer"} as const;
const info={padding:12,border:"1px solid #b8d7c6",borderRadius:10,background:"#eef8f2",display:"grid",gap:3,fontSize:12} as const;
const checklistPanel={borderTop:"1px solid #e0e6eb",paddingTop:14,display:"grid",gap:12} as const;
const sectionHead={display:"flex",justifyContent:"space-between",gap:12,alignItems:"end",flexWrap:"wrap" as const} as const;
const h2={margin:"4px 0 0",fontSize:22,color:"#17324a"} as const;
const actions={display:"flex",gap:7,flexWrap:"wrap" as const} as const;
const itemsStyle={display:"grid",gap:9} as const;
const itemCard={border:"1px solid #d8e0e7",borderRadius:10,padding:11,display:"grid",gap:8,background:"#fbfcfb"} as const;
const itemTop={display:"grid",gridTemplateColumns:"auto minmax(140px,1fr) auto auto",gap:8,alignItems:"center"} as const;
const optionRow={display:"flex",gap:12,flexWrap:"wrap" as const,fontSize:12,fontWeight:750} as const;
const measure={display:"grid",gridTemplateColumns:"1fr 140px",gap:8} as const;
const remove={border:0,background:"transparent",color:"#a3382d",fontWeight:900,cursor:"pointer"} as const;

