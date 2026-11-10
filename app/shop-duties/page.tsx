"use client";

import {useEffect,useMemo,useState} from "react";

type Mechanic={id:number;displayName:string;role:string;technicianId:number};
type ChecklistItem={id:number;section:string;text:string;sortOrder:number;required:boolean};
type CurrentAssignment={
  id:number;periodKey:string;dueDate:string;assignedUserId:number;assignedName:string;status:string;
  overdue?:boolean;dueToday?:boolean;
};
type DutyTemplate={
  id:number;templateKey:string;name:string;description:string;cadence:"weekly"|"monthly"|"shift";
  assignmentMode:string;dueDay:number|null;shiftId:number|null;active:boolean;sourceLabel:string;
  itemCount:number;selectedUserIds:number[];items:ChecklistItem[];currentAssignment:CurrentAssignment|null;
};
type DutyAlert={
  id:number;templateId:number;templateKey:string;templateName:string;dueDate:string;status:string;
  assignedUserId:number;assignedName:string;
};
type Payload={
  templates:DutyTemplate[];
  mechanics:Mechanic[];
  overdueAssignments:DutyAlert[];
  dueTodayAssignments:DutyAlert[];
  updatedAt:string;
};

function dueLabel(value:string|undefined){
  if(!value)return "Not assigned";
  const date=new Date(value+"T12:00:00");
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
}
function statusLabel(value:string|undefined){
  if(!value)return "NOT ASSIGNED";
  return value.replaceAll("_"," ").toUpperCase();
}
function currentTone(assignment:CurrentAssignment|null){
  if(assignment?.overdue)return {label:"OVERDUE",style:{background:"#ffe7e5",color:"#a12820"}};
  if(assignment?.dueToday)return {label:"DUE TODAY",style:{background:"#fff0da",color:"#9a5609"}};
  if(assignment)return {label:statusLabel(assignment.status),style:{background:"#e8f4fb",color:"#2f6f60"}};
  return {label:"NOT ASSIGNED",style:{background:"#edf1f4",color:"#64717d"}};
}

function ChecklistEditor({
  template,busy,onSave,
}:{
  template:DutyTemplate;
  busy:boolean;
  onSave:(templateId:number,items:ChecklistItem[])=>Promise<void>;
}){
  const[open,setOpen]=useState(false);
  const[items,setItems]=useState<ChecklistItem[]>(template.items??[]);

  useEffect(()=>setItems(template.items??[]),[template.items]);

  function patch(index:number,change:Partial<ChecklistItem>){
    setItems(current=>current.map((item,i)=>i===index?{...item,...change}:item));
  }
  function move(index:number,direction:-1|1){
    const next=index+direction;
    if(next<0||next>=items.length)return;
    setItems(current=>{
      const copy=[...current];
      [copy[index],copy[next]]=[copy[next],copy[index]];
      return copy;
    });
  }
  function remove(index:number){setItems(current=>current.filter((_,i)=>i!==index));}
  function add(){setItems(current=>[...current,{id:0,section:"CHECKLIST",text:"",sortOrder:current.length+1,required:true}]);}

  return <div style={editorWrap}>
    <button type="button" style={secondaryButton} onClick={()=>setOpen(value=>!value)}>
      {open?"CLOSE CHECKLIST EDITOR":"EDIT CHECKLIST"}
    </button>
    {open&&<div style={editor}>
      <div style={editorHead}>
        <div><strong>{template.name}</strong><span>{items.length} checklist lines</span></div>
        <button type="button" style={addButton} onClick={add} disabled={busy}>+ ADD LINE</button>
      </div>
      <div style={editorList}>
        {items.map((item,index)=><div key={item.id||`new-${index}`} style={editorRow}>
          <div style={orderControls}>
            <button type="button" onClick={()=>move(index,-1)} disabled={busy||index===0}>↑</button>
            <button type="button" onClick={()=>move(index,1)} disabled={busy||index===items.length-1}>↓</button>
          </div>
          <input value={item.section} onChange={event=>patch(index,{section:event.target.value})} style={sectionInput} placeholder="Section" disabled={busy}/>
          <textarea value={item.text} onChange={event=>patch(index,{text:event.target.value})} style={itemInput} rows={2} placeholder="Checklist item" disabled={busy}/>
          <label style={requiredToggle}><input type="checkbox" checked={item.required} onChange={event=>patch(index,{required:event.target.checked})} disabled={busy}/> Required</label>
          <button type="button" style={removeButton} onClick={()=>remove(index)} disabled={busy}>REMOVE</button>
        </div>)}
      </div>
      <button type="button" style={primaryButton} disabled={busy||!items.length} onClick={()=>void onSave(template.id,items)}>
        SAVE CHECKLIST
      </button>
    </div>}
  </div>;
}

export default function ShopDutiesSetupPage(){
  const[data,setData]=useState<Payload|null>(null);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  const[assignmentChoice,setAssignmentChoice]=useState<Record<string,string>>({});

  async function load(){
    const response=await fetch("/api/shop-duties/setup",{cache:"no-store"});
    if(response.status===401){window.location.assign("/login?returnTo=/shop-duties");return;}
    const result=await response.json() as Payload&{error?:string};
    if(!response.ok)throw new Error(result.error||"Shop Duties setup could not be loaded.");
    setData(result);
    setAssignmentChoice(current=>{
      const next={...current};
      for(const template of result.templates){
        if(template.currentAssignment?.assignedUserId&&!next[template.templateKey]){
          next[template.templateKey]=String(template.currentAssignment.assignedUserId);
        }
      }
      return next;
    });
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Shop Duties setup could not be loaded."));},[]);

  const mechanics=useMemo(()=>data?.mechanics.filter(person=>person.role==="mechanic")??[],[data]);
  const templates=useMemo(()=>{
    const map=new Map<string,DutyTemplate>();
    for(const template of data?.templates??[])map.set(template.templateKey,template);
    return map;
  },[data]);

  async function assign(template:DutyTemplate){
    const selected=Number(assignmentChoice[template.templateKey]??0);
    if(!selected){setMessage("Choose the mechanic first.");return;}
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop-duties/setup",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"assignCurrent",templateId:template.id,assignedUserId:selected}),
      });
      const result=await response.json() as{ok?:boolean;error?:string;assignedName?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Shop Duty could not be assigned.");
      setMessage(template.templateKey==="shift-shop-inspection"
        ? "Shop Check assigned to "+(result.assignedName||"the selected mechanic")+"."
        : template.name+" assigned to "+(result.assignedName||"the selected mechanic")+".");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Shop Duty could not be assigned.");}
    finally{setBusy(false);}
  }

  async function saveChecklist(templateId:number,items:ChecklistItem[]){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop-duties/setup",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"saveChecklist",templateId,items}),
      });
      const result=await response.json() as{ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Checklist could not be saved.");
      setMessage("Checklist updated.");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Checklist could not be saved.");}
    finally{setBusy(false);}
  }

  function dutyCard(template:DutyTemplate|null,kind:"bathroom"|"shop"|"monthly"){
    if(!template)return null;
    const current=template.currentAssignment;
    const tone=currentTone(current);
    const started=current?.status==="in_progress";
    const completed=current?.status==="completed";
    const assignmentLocked=started||(completed&&kind!=="shop");
    const assignmentLabel=kind==="bathroom"
      ? (current?"CHANGE THIS WEEK'S PERSON":"ASSIGN THIS WEEK")
      : kind==="shop"
        ? (current?.status==="pending"?"CHANGE SHOP CHECK ASSIGNMENT":"ASSIGN SHOP CHECK")
        : (current?.status==="pending"?"CHANGE THIS MONTH'S PERSON":"ASSIGN THIS MONTH");

    const description=kind==="bathroom"
      ? "Normally rotates through all active mechanics weekly, but you can override this week's person before the duty is started."
      : kind==="shop"
        ? "You assign the Shop Check yourself. It is not tied to a shift or automatic mechanic rotation."
        : "You choose the mechanic yourself each month. There is no automatic monthly rotation.";

    return <section style={{...card,borderColor:current?.overdue?"#e69a93":"#d7ded9"}}>
      <div style={cardHead}>
        <div><span style={kind==="bathroom"?orangeTag:kind==="shop"?blueTag:greenTag}>{kind==="bathroom"?"WEEKLY BATHROOM":kind==="shop"?"SHOP CHECK":"MONTHLY"}</span><h2 style={title}>{template.name}</h2></div>
        <span style={{...pill,...tone.style}}>{tone.label}</span>
      </div>
      <p style={descriptionStyle}>{description}</p>

      <div style={facts}>
        <div style={fact}><span>Assigned to</span><strong>{current?.assignedName||"Nobody yet"}</strong></div>
        <div style={fact}><span>Due</span><strong>{dueLabel(current?.dueDate)}</strong></div>
        <div style={fact}><span>Status</span><strong>{statusLabel(current?.status)}</strong></div>
        <div style={fact}><span>Checklist</span><strong>{template.itemCount} items</strong></div>
      </div>

      {current?.overdue&&<div style={overdueBox}><strong>OVERDUE</strong><span>{current.assignedName} has not completed this duty. It also appears on the manager Today screen.</span></div>}
      {current?.dueToday&&!current.overdue&&<div style={dueBox}><strong>DUE TODAY</strong><span>{current.assignedName} still has this duty open.</span></div>}

      <label style={label}>MECHANIC
        <select
          value={assignmentChoice[template.templateKey]??""}
          onChange={event=>setAssignmentChoice(currentChoices=>({...currentChoices,[template.templateKey]:event.target.value}))}
          style={input}
          disabled={busy||assignmentLocked}
        >
          <option value="">Choose mechanic…</option>
          {mechanics.map(person=><option key={person.id} value={person.id}>{person.displayName}</option>)}
        </select>
      </label>
      <button type="button" style={primaryButton} disabled={busy||assignmentLocked||!assignmentChoice[template.templateKey]} onClick={()=>void assign(template)}>
        {started?"IN PROGRESS — CANNOT REASSIGN":completed&&kind!=="shop"?"COMPLETED":completed&&kind==="shop"?"ASSIGN NEXT SHOP CHECK":assignmentLabel}
      </button>
      <small style={help}>You can change the assignee while it is still pending. Once the mechanic starts it, the assignment locks until completion.</small>

      <ChecklistEditor template={template} busy={busy} onSave={saveChecklist}/>
    </section>;
  }

  const bathroom=templates.get("bathroom-weekly")??null;
  const shop=templates.get("shift-shop-inspection")??null;
  const monthly=templates.get("monthly-facility")??null;

  return <main style={page}>
    <header style={header}>
      <div><p style={eyebrow}>MAINTENANCE SETUP</p><h1 style={h1}>Shop Duties</h1><p style={subtitle}>Assign duties, change who has them, edit the checklists, and see immediately when something was missed.</p></div>
      <a href="/setup-center" style={back}>← Setup Home</a>
    </header>

    {message&&<div style={notice}>{message}</div>}

    {!!data?.overdueAssignments.length&&<section style={alertPanel}>
      <div><strong>{data.overdueAssignments.length} SHOP DUT{data.overdueAssignments.length===1?"Y IS":"IES ARE"} OVERDUE</strong><span>These remain visible here and on Today until completed.</span></div>
      {data.overdueAssignments.map(item=><div key={item.id} style={alertRow}><b>{item.templateName}</b><span>{item.assignedName} · due {dueLabel(item.dueDate)} · {statusLabel(item.status)}</span></div>)}
    </section>}

    {!data&&!message&&<div style={loading}>Loading Shop Duties…</div>}
    {data&&<div style={grid}>
      {dutyCard(bathroom,"bathroom")}
      {dutyCard(shop,"shop")}
      {dutyCard(monthly,"monthly")}
    </div>}
  </main>;
}

const page={minHeight:"100vh",background:"#f4f6f4",padding:"34px 32px 100px",color:"#1b2421"} as const;
const header={display:"flex",justifyContent:"space-between",alignItems:"end",gap:18,flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#2f6f60",fontSize:11,fontWeight:950,letterSpacing:".14em"} as const;
const h1={margin:"6px 0 4px",fontSize:34,color:"#173f37"} as const;
const subtitle={margin:0,maxWidth:760,color:"#68746f",fontSize:13,lineHeight:1.5} as const;
const back={padding:"9px 12px",border:"1px solid #cdd6de",borderRadius:9,background:"white",color:"#30463f",fontWeight:850,textDecoration:"none",fontSize:12} as const;
const notice={marginTop:16,padding:12,border:"1px solid #efc16c",borderRadius:9,background:"#fff8e6",fontWeight:800} as const;
const loading={marginTop:18,padding:22,border:"1px solid #d7ded9",borderRadius:12,background:"white",color:"#68746f"} as const;
const grid={marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(350px,1fr))",gap:16,alignItems:"start"} as const;
const card={padding:18,border:"1px solid #d7ded9",borderRadius:14,background:"white",boxShadow:"0 5px 22px rgba(19,37,55,.05)",display:"grid",gap:13} as const;
const cardHead={display:"flex",justifyContent:"space-between",gap:12,alignItems:"start"} as const;
const title={margin:"5px 0 0",fontSize:20,color:"#173f37"} as const;
const descriptionStyle={margin:0,color:"#68746f",fontSize:12,lineHeight:1.5} as const;
const orangeTag={fontSize:9,fontWeight:950,letterSpacing:".1em",color:"#2f6f60"} as const;
const blueTag={fontSize:9,fontWeight:950,letterSpacing:".1em",color:"#466a60"} as const;
const greenTag={fontSize:9,fontWeight:950,letterSpacing:".1em",color:"#2f6f60"} as const;
const pill={padding:"5px 8px",borderRadius:999,fontSize:9,fontWeight:950,whiteSpace:"nowrap" as const} as const;
const facts={display:"grid",gridTemplateColumns:"1fr 1fr",gap:8} as const;
const fact={padding:10,borderRadius:9,background:"#f6f8fa",display:"grid",gap:3,fontSize:10,color:"#68746f"} as const;
const label={display:"grid",gap:6,fontSize:10,fontWeight:950,color:"#53645d",letterSpacing:".04em"} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #bdc9d4",borderRadius:8,background:"white",color:"#1b2421",fontSize:13} as const;
const primaryButton={border:0,borderRadius:9,padding:"11px 13px",background:"#173f37",color:"white",fontWeight:950,cursor:"pointer"} as const;
const secondaryButton={border:"1px solid #b8c6c0",borderRadius:9,padding:"10px 12px",background:"white",color:"#30463f",fontWeight:900,cursor:"pointer"} as const;
const help={color:"#74818c",fontSize:10,lineHeight:1.4} as const;
const overdueBox={display:"grid",gap:3,padding:11,border:"1px solid #e5a09a",borderRadius:9,background:"#fff0ef",color:"#9e2d25",fontSize:11} as const;
const dueBox={display:"grid",gap:3,padding:11,border:"1px solid #ecc783",borderRadius:9,background:"#fff8e9",color:"#91530b",fontSize:11} as const;
const alertPanel={marginTop:16,padding:14,border:"2px solid #dc6e65",borderRadius:12,background:"#fff0ef",color:"#8f2821",display:"grid",gap:8} as const;
const alertRow={display:"flex",justifyContent:"space-between",gap:12,paddingTop:8,borderTop:"1px solid #edc3bf",fontSize:11} as const;
const editorWrap={display:"grid",gap:9,borderTop:"1px solid #e7ecef",paddingTop:12} as const;
const editor={display:"grid",gap:10,padding:12,border:"1px solid #d8e0e7",borderRadius:10,background:"#f8fafb"} as const;
const editorHead={display:"flex",justifyContent:"space-between",alignItems:"center",gap:10} as const;
const editorList={display:"grid",gap:8} as const;
const editorRow={display:"grid",gridTemplateColumns:"auto 120px minmax(180px,1fr) auto auto",gap:7,alignItems:"center",padding:8,border:"1px solid #dde4e9",borderRadius:8,background:"white"} as const;
const orderControls={display:"grid",gap:3} as const;
const sectionInput={width:"100%",boxSizing:"border-box" as const,padding:"7px 8px",border:"1px solid #c3ced7",borderRadius:7,fontSize:11} as const;
const itemInput={width:"100%",boxSizing:"border-box" as const,padding:"7px 8px",border:"1px solid #c3ced7",borderRadius:7,fontSize:12,resize:"vertical" as const} as const;
const requiredToggle={display:"flex",gap:5,alignItems:"center",fontSize:10,fontWeight:850,color:"#53645d"} as const;
const removeButton={border:"1px solid #d99b96",borderRadius:7,padding:"7px 8px",background:"white",color:"#a23028",fontWeight:900,fontSize:9} as const;
const addButton={border:"1px solid #9db9af",borderRadius:7,padding:"7px 9px",background:"white",color:"#2f6f60",fontWeight:900,fontSize:9} as const;
