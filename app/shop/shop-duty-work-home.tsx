"use client";

import {useEffect,useMemo,useState} from "react";

type DutyItem={id:number;section:string;text:string;required:boolean;result:"done"|"attention"|"na"|null;comment:string};
export type ActiveShopDuty={
  id:number;templateKey:string;name:string;description:string;cadence:string;assignmentMode:string;
  periodKey:string;dueDate:string;assignedUserId:number;status:string;repairId:string|null;
  suppliesNeeded:string;notes:string;startedAt:string|null;completedAt:string|null;items:DutyItem[];
};
type Props={
  timer:{repairId:string;startedAt:string;title:string;unit:string};
  duty:ActiveShopDuty;
  onRefresh:()=>void|Promise<void>;
};

function timerStartMs(value:string){const normalized=value.includes("T")?value:value.replace(" ","T")+"Z";return Date.parse(normalized)}
function duration(startedAt:string,now:number){const ms=Math.max(0,now-timerStartMs(startedAt)),total=Math.floor(ms/1000),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
function dueLabel(value:string){const date=new Date(value+"T12:00:00");return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}

export default function ShopDutyWorkHome({timer,duty,onRefresh}:Props){
  const[now,setNow]=useState(Date.now());
  const[items,setItems]=useState(duty.items);
  const[supplies,setSupplies]=useState(duty.suppliesNeeded||"");
  const[notes,setNotes]=useState(duty.notes||"");
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState("");

  useEffect(()=>{setItems(duty.items);setSupplies(duty.suppliesNeeded||"");setNotes(duty.notes||"")},[duty]);
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id)},[]);

  const sections=useMemo(()=>{
    const map=new Map<string,DutyItem[]>();
    for(const item of items){const key=item.section||"CHECKLIST";const list=map.get(key)??[];list.push(item);map.set(key,list)}
    return [...map.entries()];
  },[items]);
  const answered=items.filter(item=>item.result).length;
  const requiredMissing=items.filter(item=>item.required&&!item.result).length;

  async function call(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop-duties",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as{ok?:boolean;error?:string;completed?:boolean;paused?:boolean};
      if(!response.ok||!result.ok)throw new Error(result.error||"Shop Duty action failed.");
      return result;
    }catch(error){setMessage(error instanceof Error?error.message:"Shop Duty action failed.");return null}
    finally{setBusy(false)}
  }

  async function choose(item:DutyItem,result:"done"|"attention"|"na"){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop-duties",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"saveItem",assignmentId:duty.id,itemId:item.id,result,comment:item.comment||""})});
      const payload=await response.json() as{ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Checklist item could not be saved.");
      setItems(current=>current.map(row=>row.id===item.id?{...row,result}:row));
    }catch(error){setMessage(error instanceof Error?error.message:"Checklist item could not be saved.");}
    finally{setBusy(false)}
  }

  async function saveNotes(){
    const result=await call({action:"saveNotes",assignmentId:duty.id,suppliesNeeded:supplies,notes});
    if(result)setMessage("Duty notes saved.");
  }

  async function pause(){
    const noteSaved=await call({action:"saveNotes",assignmentId:duty.id,suppliesNeeded:supplies,notes});
    if(!noteSaved)return;
    const result=await call({action:"pause",assignmentId:duty.id});
    if(result){window.dispatchEvent(new Event("shop-jobs-refresh"));await onRefresh();}
  }

  async function complete(){
    const noteSaved=await call({action:"saveNotes",assignmentId:duty.id,suppliesNeeded:supplies,notes});
    if(!noteSaved)return;
    const result=await call({action:"complete",assignmentId:duty.id});
    if(result){window.dispatchEvent(new Event("shop-jobs-refresh"));await onRefresh();}
  }

  return <main style={page}>
    <div style={shell}>
      {message&&<div style={notice}>{message}</div>}

      <section style={hero}>
        <div>
          <p style={eyebrow}>WORKING NOW · SHOP DUTY</p>
          <h1 style={title}>{duty.name}</h1>
          <p style={description}>{duty.description}</p>
          <div style={due}>Due {dueLabel(duty.dueDate)} · {answered}/{items.length} checks answered</div>
        </div>
        <div style={timerStyle}>◷ {duration(timer.startedAt,now)}</div>
      </section>

      <section style={summary}>
        <div style={summaryCell}><span style={summaryLabel}>LABOR TYPE</span><strong style={summaryValue}>INDIRECT LABOR</strong></div>
        <div style={summaryCell}><span style={summaryLabel}>CHECKLIST</span><strong style={summaryValue}>{requiredMissing===0?"READY TO COMPLETE":requiredMissing+" LEFT"}</strong></div>
        <div style={summaryCell}><span style={summaryLabel}>WORK ORDER</span><strong style={summaryValue}>SHOP / NO UNIT</strong></div>
      </section>

      {sections.map(([section,sectionItems])=><section key={section} style={card}>
        <h2 style={sectionTitle}>{section}</h2>
        <div style={checkList}>
          {sectionItems.map(item=><div key={item.id} style={checkRow}>
            <div style={itemText}>{item.text}{item.required&&<span style={required}>REQUIRED</span>}</div>
            <div style={choices}>
              <button type="button" disabled={busy} onClick={()=>void choose(item,"done")} style={item.result==="done"?doneActive:choice}>✓ DONE</button>
              <button type="button" disabled={busy} onClick={()=>void choose(item,"attention")} style={item.result==="attention"?attentionActive:choice}>! ATTENTION</button>
              <button type="button" disabled={busy} onClick={()=>void choose(item,"na")} style={item.result==="na"?naActive:choice}>N/A</button>
            </div>
          </div>)}
        </div>
      </section>)}

      <section style={notesCard}>
        <label style={label}>SUPPLIES NEEDED
          <textarea rows={3} value={supplies} onChange={event=>setSupplies(event.target.value)} placeholder="Anything low, out, or needed…" style={textarea} disabled={busy}/>
        </label>
        <label style={label}>NOTES
          <textarea rows={3} value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Anything management needs to know…" style={textarea} disabled={busy}/>
        </label>
        <button type="button" onClick={()=>void saveNotes()} disabled={busy} style={saveButton}>SAVE NOTES</button>
      </section>

      <section style={actions}>
        <button type="button" onClick={()=>void pause()} disabled={busy} style={pauseButton}>PAUSE DUTY</button>
        <button type="button" onClick={()=>void complete()} disabled={busy||requiredMissing>0} style={{...completeButton,opacity:(busy||requiredMissing>0)?0.55:1}}>
          {requiredMissing>0?`COMPLETE ${requiredMissing} MORE CHECKS`:"COMPLETE DUTY"}
        </button>
      </section>
    </div>
  </main>;
}

const page={minHeight:"100vh",background:"#f4f6f4",padding:"18px clamp(10px,2vw,20px) 70px",color:"#1b2421"} as const;
const shell={maxWidth:900,margin:"0 auto",display:"grid",gap:12} as const;
const notice={padding:"10px 12px",border:"1px solid #f2c66d",borderRadius:10,background:"#fff8e6",fontSize:13,fontWeight:800} as const;
const hero={display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",padding:19,borderRadius:16,background:"linear-gradient(135deg,#173f37,#173f37)",color:"white",boxShadow:"0 9px 26px #173f372b"} as const;
const eyebrow={margin:"0 0 5px",fontSize:11,fontWeight:950,letterSpacing:".14em",color:"#c9ded6"} as const;
const title={margin:0,fontSize:29,lineHeight:1.08} as const;
const description={margin:"7px 0 0",maxWidth:620,fontSize:13,lineHeight:1.45,color:"#e0ebe7"} as const;
const due={marginTop:10,fontSize:11,fontWeight:850,color:"#dcebe5"} as const;
const timerStyle={fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",fontSize:24,fontWeight:950,whiteSpace:"nowrap" as const} as const;
const summary={display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8} as const;
const summaryCell={padding:11,border:"1px solid #d8e0e7",borderRadius:11,background:"white"} as const;
const summaryLabel={display:"block",fontSize:9,fontWeight:950,letterSpacing:".08em",color:"#74818d"} as const;
const summaryValue={display:"block",marginTop:4,fontSize:13,color:"#173f37"} as const;
const card={padding:15,borderRadius:14,background:"white",border:"1px solid #d8e0e7",boxShadow:"0 4px 15px #1b242109"} as const;
const sectionTitle={margin:"0 0 10px",fontSize:16,color:"#102a53"} as const;
const checkList={display:"grid",gap:8} as const;
const checkRow={display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:12,alignItems:"center",padding:"10px 0",borderTop:"1px solid #edf0f2"} as const;
const itemText={fontSize:13,lineHeight:1.4,fontWeight:750,color:"#243748"} as const;
const required={display:"inline-block",marginLeft:7,padding:"2px 5px",borderRadius:999,background:"#eef2f5",fontSize:8,fontWeight:950,color:"#62717e",verticalAlign:"middle"} as const;
const choices={display:"flex",gap:5,flexWrap:"wrap" as const,justifyContent:"flex-end"} as const;
const choice={border:"1px solid #cad4dc",borderRadius:8,padding:"7px 9px",background:"white",color:"#53616d",fontSize:9,fontWeight:950,cursor:"pointer"} as const;
const doneActive={...choice,background:"#e9f7ef",borderColor:"#79bd96",color:"#176440"} as const;
const attentionActive={...choice,background:"#fff2df",borderColor:"#efb461",color:"#9a5205"} as const;
const naActive={...choice,background:"#edf2f6",borderColor:"#9dacb8",color:"#40505d"} as const;
const notesCard={...card,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10} as const;
const label={display:"grid",gap:5,fontSize:10,fontWeight:950,color:"#53645d",letterSpacing:".04em"} as const;
const textarea={width:"100%",boxSizing:"border-box" as const,padding:"10px",border:"1px solid #bdc9d4",borderRadius:8,resize:"vertical" as const,fontSize:13,color:"#182331"} as const;
const saveButton={gridColumn:"1 / -1",justifySelf:"end",border:"1px solid #8ea1b1",borderRadius:8,padding:"9px 12px",background:"white",color:"#253440",fontWeight:900,cursor:"pointer"} as const;
const actions={display:"grid",gridTemplateColumns:"1fr 2fr",gap:10} as const;
const pauseButton={border:"1px solid #7b8a96",borderRadius:11,padding:"13px",background:"white",color:"#253440",fontWeight:950,cursor:"pointer"} as const;
const completeButton={border:0,borderRadius:11,padding:"13px",background:"#19945d",color:"white",fontWeight:950,cursor:"pointer"} as const;
