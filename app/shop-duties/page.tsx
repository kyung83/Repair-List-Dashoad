"use client";

import {useEffect,useMemo,useState} from "react";

type Mechanic={id:number;displayName:string;role:string;technicianId:number};
type Shift={id:number;name:string;startTime:string;endTime:string;daysOfWeek:number[]};
type CurrentAssignment={id:number;periodKey:string;dueDate:string;assignedUserId:number;assignedName:string;status:string};
type DutyTemplate={
  id:number;templateKey:string;name:string;description:string;cadence:"weekly"|"monthly"|"shift";
  assignmentMode:string;dueDay:number|null;shiftId:number|null;active:boolean;sourceLabel:string;
  itemCount:number;selectedUserIds:number[];currentAssignment:CurrentAssignment|null;
};
type Payload={templates:DutyTemplate[];mechanics:Mechanic[];shifts:Shift[];updatedAt:string};

function dueLabel(value:string|undefined){
  if(!value)return "Not assigned";
  const date=new Date(value+"T12:00:00");
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
}
function statusLabel(value:string|undefined){
  if(!value)return "NOT ASSIGNED";
  return value.replaceAll("_"," ").toUpperCase();
}

export default function ShopDutiesSetupPage(){
  const[data,setData]=useState<Payload|null>(null);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  const[shopSelected,setShopSelected]=useState<number[]>([]);
  const[shopShiftId,setShopShiftId]=useState("");
  const[shopActive,setShopActive]=useState(false);
  const[monthlyUserId,setMonthlyUserId]=useState("");

  async function load(){
    const response=await fetch("/api/shop-duties/setup",{cache:"no-store"});
    if(response.status===401){window.location.assign("/login?returnTo=/shop-duties");return;}
    const result=await response.json() as Payload&{error?:string};
    if(!response.ok)throw new Error(result.error||"Shop Duties setup could not be loaded.");
    setData(result);
    const shop=result.templates.find(template=>template.templateKey==="shift-shop-inspection");
    if(shop){
      setShopSelected(shop.selectedUserIds??[]);
      setShopShiftId(shop.shiftId?String(shop.shiftId):"");
      setShopActive(Boolean(shop.active));
    }
    const monthly=result.templates.find(template=>template.templateKey==="monthly-facility");
    setMonthlyUserId(monthly?.currentAssignment?.assignedUserId?String(monthly.currentAssignment.assignedUserId):"");
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Shop Duties setup could not be loaded."));},[]);

  const bathroom=data?.templates.find(template=>template.templateKey==="bathroom-weekly")??null;
  const shop=data?.templates.find(template=>template.templateKey==="shift-shop-inspection")??null;
  const monthly=data?.templates.find(template=>template.templateKey==="monthly-facility")??null;
  const mechanics=useMemo(()=>data?.mechanics.filter(person=>person.role==="mechanic")??[],[data]);

  function toggleShopMechanic(id:number){
    setShopSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  }

  async function saveShopCheck(){
    if(!shop)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop-duties/setup",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          action:"updateTemplate",templateId:shop.id,cadence:"shift",assignmentMode:"selected_rotation",
          dueDay:null,shiftId:shopShiftId?Number(shopShiftId):null,active:shopActive,selectedUserIds:shopSelected,
        }),
      });
      const result=await response.json() as{ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Shop Check settings could not be saved.");
      setMessage("Shop Check assignments saved.");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Shop Check settings could not be saved.");}
    finally{setBusy(false);}
  }

  async function assignMonthly(){
    if(!monthly||!monthlyUserId){setMessage("Choose the mechanic for this month.");return;}
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/shop-duties/setup",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"assignCurrent",templateId:monthly.id,assignedUserId:Number(monthlyUserId)}),
      });
      const result=await response.json() as{ok?:boolean;error?:string;assignedName?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"Monthly duty could not be assigned.");
      setMessage("Once-a-Month duty assigned to "+(result.assignedName||"the selected mechanic")+".");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Monthly duty could not be assigned.");}
    finally{setBusy(false);}
  }

  return <main style={page}>
    <header style={header}>
      <div><p style={eyebrow}>MAINTENANCE SETUP</p><h1 style={h1}>Shop Duties</h1><p style={subtitle}>Assign recurring shop responsibilities without turning them into normal truck repairs. Duty time is recorded as indirect labor.</p></div>
      <a href="/setup-center" style={back}>← Setup Home</a>
    </header>

    {message&&<div style={notice}>{message}</div>}
    {!data&&!message&&<div style={loading}>Loading Shop Duties…</div>}

    {data&&<div style={grid}>
      <section style={card}>
        <div style={cardHead}><div><span style={orangeTag}>WEEKLY</span><h2 style={title}>Bathroom Cleaning & Check</h2></div><span style={activePill}>ACTIVE</span></div>
        <p style={description}>Automatically rotates through every active mechanic. No manager assignment is needed each week.</p>
        <div style={facts}>
          <div><span>Rotation</span><strong>All mechanics · round robin</strong></div>
          <div><span>Checklist</span><strong>{bathroom?.itemCount??0} items</strong></div>
          <div><span>This week</span><strong>{bathroom?.currentAssignment?.assignedName||"Waiting for assignment"}</strong></div>
          <div><span>Due</span><strong>{dueLabel(bathroom?.currentAssignment?.dueDate)}</strong></div>
        </div>
        {bathroom?.currentAssignment&&<div style={assignmentBar}><b>{bathroom.currentAssignment.assignedName}</b><span>{statusLabel(bathroom.currentAssignment.status)}</span></div>}
      </section>

      <section style={card}>
        <div style={cardHead}><div><span style={blueTag}>SHOP CHECK</span><h2 style={title}>Shift Change Shop Inspection</h2></div><span style={shopActive?activePill:inactivePill}>{shopActive?"ACTIVE":"OFF"}</span></div>
        <p style={description}>Choose exactly which mechanics can receive the Shop Check. The system rotates the checklist only through those selected mechanics on the configured shift.</p>

        <label style={label}>SHIFT
          <select value={shopShiftId} onChange={event=>setShopShiftId(event.target.value)} style={input} disabled={busy}>
            <option value="">Choose maintenance shift…</option>
            {data.shifts.map(shift=><option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}
          </select>
        </label>

        <div style={label}>MECHANICS WHO CAN RECEIVE SHOP CHECK
          <div style={peopleGrid}>
            {mechanics.map(person=><label key={person.id} style={personRow}>
              <input type="checkbox" checked={shopSelected.includes(person.id)} onChange={()=>toggleShopMechanic(person.id)} disabled={busy}/>
              <span>{person.displayName}</span>
            </label>)}
          </div>
        </div>

        <label style={toggleRow}><input type="checkbox" checked={shopActive} onChange={event=>setShopActive(event.target.checked)} disabled={busy}/><span><strong>Turn on Shop Check assignments</strong><small>Leave off until the selected mechanics and shift are correct.</small></span></label>
        <button type="button" onClick={()=>void saveShopCheck()} disabled={busy} style={primaryButton}>SAVE SHOP CHECK SETTINGS</button>
        {shop?.currentAssignment&&<div style={assignmentBar}><b>Current: {shop.currentAssignment.assignedName}</b><span>{statusLabel(shop.currentAssignment.status)} · due {dueLabel(shop.currentAssignment.dueDate)}</span></div>}
      </section>

      <section style={card}>
        <div style={cardHead}><div><span style={greenTag}>MONTHLY</span><h2 style={title}>Once-a-Month Facility List</h2></div><span style={activePill}>MANUAL ASSIGN</span></div>
        <p style={description}>No automatic rotation. Each month you choose the mechanic yourself. The selected mechanic gets the full monthly checklist in their Shop Duties area.</p>
        <div style={facts}>
          <div><span>Checklist</span><strong>{monthly?.itemCount??0} items</strong></div>
          <div><span>Current month</span><strong>{monthly?.currentAssignment?.assignedName||"Not assigned yet"}</strong></div>
          <div><span>Status</span><strong>{statusLabel(monthly?.currentAssignment?.status)}</strong></div>
          <div><span>Due</span><strong>{dueLabel(monthly?.currentAssignment?.dueDate)}</strong></div>
        </div>
        <label style={label}>ASSIGN THIS MONTH TO
          <select value={monthlyUserId} onChange={event=>setMonthlyUserId(event.target.value)} style={input} disabled={busy}>
            <option value="">Choose mechanic…</option>
            {mechanics.map(person=><option key={person.id} value={person.id}>{person.displayName}</option>)}
          </select>
        </label>
        <button type="button" onClick={()=>void assignMonthly()} disabled={busy||!monthlyUserId} style={primaryButton}>
          {monthly?.currentAssignment?.status==="pending"?"CHANGE THIS MONTH'S ASSIGNMENT":"ASSIGN THIS MONTH"}
        </button>
        {monthly?.currentAssignment&&<div style={assignmentBar}><b>{monthly.currentAssignment.assignedName}</b><span>{statusLabel(monthly.currentAssignment.status)} · due {dueLabel(monthly.currentAssignment.dueDate)}</span></div>}
      </section>
    </div>}
  </main>;
}

const page={minHeight:"100vh",background:"#f3f5f7",padding:"34px 32px 100px",color:"#182331"} as const;
const header={display:"flex",justifyContent:"space-between",alignItems:"end",gap:18,flexWrap:"wrap" as const} as const;
const eyebrow={margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"} as const;
const h1={margin:"6px 0 4px",fontSize:34,color:"#0d1b2b"} as const;
const subtitle={margin:0,maxWidth:760,color:"#667482",fontSize:13,lineHeight:1.5} as const;
const back={padding:"9px 12px",border:"1px solid #cdd6de",borderRadius:9,background:"white",color:"#2b4053",fontWeight:850,textDecoration:"none",fontSize:12} as const;
const notice={marginTop:16,padding:12,border:"1px solid #efc16c",borderRadius:9,background:"#fff8e6",fontWeight:800} as const;
const loading={marginTop:18,padding:22,border:"1px solid #dce2e7",borderRadius:12,background:"white",color:"#667482"} as const;
const grid={marginTop:18,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(330px,1fr))",gap:16,alignItems:"start"} as const;
const card={padding:18,border:"1px solid #dce2e7",borderRadius:14,background:"white",boxShadow:"0 5px 22px rgba(19,37,55,.05)",display:"grid",gap:13} as const;
const cardHead={display:"flex",justifyContent:"space-between",gap:12,alignItems:"start"} as const;
const title={margin:"5px 0 0",fontSize:20,color:"#102a43"} as const;
const description={margin:0,color:"#697784",fontSize:12,lineHeight:1.5} as const;
const orangeTag={fontSize:9,fontWeight:950,letterSpacing:".1em",color:"#b85a0c"} as const;
const blueTag={fontSize:9,fontWeight:950,letterSpacing:".1em",color:"#2365a5"} as const;
const greenTag={fontSize:9,fontWeight:950,letterSpacing:".1em",color:"#18724a"} as const;
const activePill={padding:"5px 8px",borderRadius:999,background:"#e9f7ef",color:"#176440",fontSize:9,fontWeight:950,whiteSpace:"nowrap" as const} as const;
const inactivePill={...activePill,background:"#edf1f4",color:"#64717d"} as const;
const facts={display:"grid",gridTemplateColumns:"1fr 1fr",gap:8} as const;
const fact={padding:10,borderRadius:9,background:"#f6f8fa"} as const;
Object.assign(facts,{});
const label={display:"grid",gap:6,fontSize:10,fontWeight:950,color:"#506271",letterSpacing:".04em"} as const;
const input={width:"100%",boxSizing:"border-box" as const,padding:"10px 11px",border:"1px solid #bdc9d4",borderRadius:8,background:"white",color:"#182331",fontSize:13} as const;
const peopleGrid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:7} as const;
const personRow={display:"flex",alignItems:"center",gap:8,padding:"9px 10px",border:"1px solid #e1e6ea",borderRadius:8,background:"#fbfcfd",fontSize:12,fontWeight:800,letterSpacing:0,color:"#263b4d"} as const;
const toggleRow={display:"flex",alignItems:"flex-start",gap:9,padding:11,border:"1px solid #d7e0e7",borderRadius:9,background:"#f8fafb",fontSize:12,color:"#253a4b"} as const;
const primaryButton={border:0,borderRadius:9,padding:"11px 13px",background:"#102a43",color:"white",fontWeight:950,cursor:"pointer"} as const;
const assignmentBar={display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",padding:"9px 10px",borderRadius:9,background:"#eef5fb",color:"#294a65",fontSize:11} as const;
