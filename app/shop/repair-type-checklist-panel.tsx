"use client";

import {useEffect,useMemo,useState} from "react";

type Photo={id:number;fileName:string;url:string};
type Item={id:number|null;number:number;section:string;text:string;result:"pending"|"pass"|"fail"|"na";notes:string;allowPass:boolean;allowFail:boolean;allowNa:boolean;requireNotes:boolean;requirePhoto:boolean;requireMeasurement:boolean;measurementLabel:string;measurementUnit:string;measurementValue:string;correctiveRepair:{id:string}|null;photos:Photo[]};
type Data={repairId:string;unit:string;repairType:{id:number;name:string;checklistMode:"optional"|"required"};started:boolean;status:string;templateVersion?:number;pendingCount?:number;failedCount?:number;items:Item[];error?:string};

type Props={repairId:string;canWork:boolean};

export default function RepairTypeChecklistPanel({repairId,canWork}:Props){
 const[data,setData]=useState<Data|null>(null),[unavailable,setUnavailable]=useState(false),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[notes,setNotes]=useState<Record<number,string>>({}),[measurements,setMeasurements]=useState<Record<number,string>>({});
 function accept(payload:Data){setData(payload);setNotes(Object.fromEntries(payload.items.map(item=>[item.number,item.notes||""])));setMeasurements(Object.fromEntries(payload.items.map(item=>[item.number,item.measurementValue||""])))}
 async function load(){try{const response=await fetch(`/api/repair-type-checklist?repairId=${encodeURIComponent(repairId)}`,{cache:"no-store"});const payload=await response.json() as Data;if(!response.ok){if((payload.error||"").includes("does not use a checklist")){setUnavailable(true);setData(null);return}throw new Error(payload.error||"Checklist could not be loaded.")}setUnavailable(false);accept(payload)}catch(error){setMessage(error instanceof Error?error.message:"Checklist could not be loaded.")}}
 useEffect(()=>{setData(null);setUnavailable(false);setOpen(false);setMessage("");void load()},[repairId]);
 useEffect(()=>{const refresh=(event:Event)=>{const detail=(event as CustomEvent<{repairId?:string}>).detail;if(!detail?.repairId||detail.repairId===repairId){setMessage("");void load()}};window.addEventListener("repair-type-changed",refresh);return()=>window.removeEventListener("repair-type-changed",refresh)},[repairId]);
 async function post(body:Record<string,unknown>){setBusy(true);setMessage("");try{const response=await fetch("/api/repair-type-checklist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,repairId})});const payload=await response.json() as Data&{ok?:boolean;error?:string};if(!response.ok||!payload.ok)throw new Error(payload.error||"Checklist change failed.");accept(payload);if(body.action==="startChecklist")window.dispatchEvent(new CustomEvent("repair-type-checklist-started",{detail:{repairId}}));return payload}catch(error){setMessage(error instanceof Error?error.message:"Checklist change failed.");return null}finally{setBusy(false)}}
 async function setItem(item:Item,result:Item["result"]){const payload=await post({action:"setItem",itemNumber:item.number,result,notes:notes[item.number]??"",measurementValue:measurements[item.number]??""});if(payload)setMessage(result==="fail"?"Failed item saved and a repair was created. Fix it, then change this item to Pass.":"Saved.")}
 async function upload(item:Item,file:File|null){if(!file)return;setBusy(true);setMessage("");try{const form=new FormData();form.set("action","uploadPhoto");form.set("repairId",repairId);form.set("itemNumber",String(item.number));form.set("photo",file);const response=await fetch("/api/repair-type-checklist",{method:"POST",body:form});const payload=await response.json() as Data&{ok?:boolean;error?:string};if(!response.ok||!payload.ok)throw new Error(payload.error||"Photo upload failed.");accept(payload);setMessage("Photo saved.")}catch(error){setMessage(error instanceof Error?error.message:"Photo upload failed.")}finally{setBusy(false)}}
 const answered=useMemo(()=>data?.items.filter(item=>item.result!=="pending").length??0,[data]),failed=data?.items.filter(item=>item.result==="fail")??[];
 if(unavailable||!data)return null;
 return <section style={panel}>
   <button type="button" style={launcher} onClick={()=>setOpen(value=>!value)}><span style={icon}>▣</span><span style={{display:"grid",gap:3,textAlign:"left"}}><strong>{data.repairType.name} CHECKLIST</strong><small>{answered}/{data.items.length} answered{failed.length?` · ${failed.length} failed`:""}</small></span><b style={openButton}>{open?"CLOSE":"OPEN"}</b></button>
   {open&&<div style={body}>
     {message&&<div style={notice}>{message}</div>}
     {!data.started?<div style={startBox}><strong>Ready to begin?</strong><span>This locks in checklist version v{data.templateVersion??1} for this work order.</span>{canWork&&<button style={primary} disabled={busy} onClick={()=>void post({action:"startChecklist"})}>START CHECKLIST</button>}</div>:<>
       <div style={progress}><strong>{answered} of {data.items.length} complete</strong><span>{data.pendingCount??0} remaining</span></div>
       <div style={items}>{data.items.map(item=><article key={item.number} style={{...itemCard,...(item.result==="fail"?failedCard:{})}}><div style={itemHead}><span style={number}>{item.number}</span><div><strong>{item.text}</strong><small>{item.section}</small></div><span style={resultBadge}>{item.result.toUpperCase()}</span></div>
         <textarea style={input} rows={2} value={notes[item.number]??""} onChange={event=>setNotes(current=>({...current,[item.number]:event.target.value}))} placeholder={item.requireNotes||item.result==="fail"?"Note required":"Optional note"} disabled={!canWork||busy}/>
         {item.requireMeasurement&&<label style={label}>{item.measurementLabel}{item.measurementUnit?` (${item.measurementUnit})`:""}<input style={input} value={measurements[item.number]??""} onChange={event=>setMeasurements(current=>({...current,[item.number]:event.target.value}))} disabled={!canWork||busy}/></label>}
         <div style={answerRow}>{item.allowPass&&<button style={pass} disabled={!canWork||busy} onClick={()=>void setItem(item,"pass")}>PASS</button>}{item.allowFail&&<button style={fail} disabled={!canWork||busy} onClick={()=>void setItem(item,"fail")}>FAIL</button>}{item.allowNa&&<button style={na} disabled={!canWork||busy} onClick={()=>void setItem(item,"na")}>N/A</button>}{item.result!=="pending"&&<button style={reset} disabled={!canWork||busy} onClick={()=>void setItem(item,"pending")}>RESET</button>}</div>
         {item.requirePhoto&&<div style={photoRow}><label style={photoButton}>+ PHOTO<input type="file" accept="image/*" capture="environment" hidden onChange={event=>{const file=event.target.files?.[0]??null;void upload(item,file);event.target.value=""}} disabled={!canWork||busy}/></label>{item.photos.map(photo=><span key={photo.id} style={photoChip}><a href={photo.url} target="_blank" rel="noreferrer">{photo.fileName}</a><button disabled={!canWork||busy} onClick={()=>void post({action:"removePhoto",photoId:photo.id})}>×</button></span>)}</div>}
         {item.correctiveRepair&&<div style={repairNotice}>Repair created: <strong>{item.correctiveRepair.id}</strong>. Complete the repair, then mark this checklist item Pass.</div>}
       </article>)}</div>
       {data.pendingCount===0&&failed.length===0&&<div style={ready}>✓ Checklist complete. You can now use <strong>REPAIRED</strong> to close this work order.</div>}
     </>}
   </div>}
 </section>
}

const panel={border:"1px solid #cfd9e2",borderRadius:14,background:"white",overflow:"hidden",boxShadow:"0 4px 14px #13283d0a"} as const;
const launcher={width:"100%",border:0,background:"transparent",padding:14,display:"grid",gridTemplateColumns:"38px minmax(0,1fr) auto",alignItems:"center",gap:10,cursor:"pointer",color:"#17324a"} as const;
const icon={width:38,height:38,borderRadius:10,display:"grid",placeItems:"center",background:"#fff0e5",color:"#e96313",fontSize:20,fontWeight:950} as const;
const openButton={padding:"8px 10px",borderRadius:8,background:"#e96313",color:"white",fontSize:11} as const;
const body={borderTop:"1px solid #e0e6eb",padding:14,display:"grid",gap:12} as const;
const notice={padding:10,borderRadius:8,background:"#fff8e6",border:"1px solid #f2c66d",fontSize:12,fontWeight:800} as const;
const startBox={display:"grid",gap:8,padding:12,borderRadius:10,background:"#f7f9fb"} as const;
const primary={border:0,borderRadius:8,padding:"10px 13px",background:"#173a5d",color:"white",fontWeight:950,cursor:"pointer",width:"fit-content"} as const;
const progress={display:"flex",justifyContent:"space-between",gap:10,fontSize:12,color:"#5c6d7a"} as const;
const items={display:"grid",gap:10} as const;
const itemCard={border:"1px solid #d8e0e7",borderRadius:10,padding:11,display:"grid",gap:8} as const;
const failedCard={borderColor:"#e6a49b",background:"#fff8f7"} as const;
const itemHead={display:"grid",gridTemplateColumns:"30px minmax(0,1fr) auto",gap:8,alignItems:"start"} as const;
const number={width:28,height:28,borderRadius:999,display:"grid",placeItems:"center",background:"#edf2f6",fontWeight:950} as const;
const resultBadge={fontSize:10,fontWeight:950,padding:"5px 7px",borderRadius:999,background:"#eef2f5"} as const;
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c8d3dc",borderRadius:8,padding:"9px 10px",fontSize:13} as const;
const label={display:"grid",gap:5,fontSize:11,fontWeight:900,color:"#566674"} as const;
const answerRow={display:"flex",gap:7,flexWrap:"wrap" as const} as const;
const pass={border:0,borderRadius:8,padding:"9px 12px",background:"#188657",color:"white",fontWeight:950,cursor:"pointer"} as const;
const fail={...pass,background:"#bd3d32"} as const;
const na={...pass,background:"#667889"} as const;
const reset={border:"1px solid #c7d1da",borderRadius:8,padding:"8px 10px",background:"white",fontWeight:850,cursor:"pointer"} as const;
const photoRow={display:"flex",gap:7,alignItems:"center",flexWrap:"wrap" as const} as const;
const photoButton={...reset,display:"inline-block"} as const;
const photoChip={display:"flex",gap:5,alignItems:"center",padding:"5px 7px",borderRadius:8,background:"#eef4f8",fontSize:11} as const;
const repairNotice={padding:8,borderRadius:8,background:"#fff3e8",color:"#7b3e11",fontSize:12} as const;
const ready={padding:10,borderRadius:9,background:"#eaf7ef",border:"1px solid #b7dbc5",color:"#155f3d",fontSize:13} as const;
