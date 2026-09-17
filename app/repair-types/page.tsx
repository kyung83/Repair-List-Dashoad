"use client";

import {useEffect,useState} from "react";

type UnitRule="required"|"optional";
type ChecklistMode="none"|"optional"|"required";
type RepairType={id:number;code:string;name:string;active:boolean;sortOrder:number;unitRule:UnitRule;checklistMode:ChecklistMode;systemKey:string;checklistConfigured:boolean};
type Payload={types:RepairType[];ok?:boolean;error?:string};

type Draft={name:string;active:boolean;sortOrder:number;unitRule:UnitRule;checklistMode:ChecklistMode};

const panel={border:"1px solid #d8e0e7",borderRadius:13,background:"white",padding:15} as const;
const input={width:"100%",boxSizing:"border-box" as const,border:"1px solid #c7d2dc",borderRadius:8,padding:"9px 10px",background:"white",color:"#182331"} as const;
const button={border:0,borderRadius:8,padding:"9px 12px",background:"#102a43",color:"white",fontWeight:900,cursor:"pointer"} as const;
const secondary={...button,background:"#edf2f6",color:"#17324a",border:"1px solid #cbd6df",textDecoration:"none"} as const;
const label={display:"grid",gap:5,fontSize:11,fontWeight:900,color:"#586875"} as const;

function draft(type:RepairType):Draft{return{name:type.name,active:type.active,sortOrder:type.sortOrder,unitRule:type.unitRule,checklistMode:type.checklistMode}}

export default function RepairTypesPage(){
  const[types,setTypes]=useState<RepairType[]>([]),[drafts,setDrafts]=useState<Record<number,Draft>>({});
  const[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  const[newName,setNewName]=useState(""),[newUnitRule,setNewUnitRule]=useState<UnitRule>("required"),[newChecklist,setNewChecklist]=useState<ChecklistMode>("none");

  function accept(payload:Payload){setTypes(payload.types);setDrafts(Object.fromEntries(payload.types.map(type=>[type.id,draft(type)])))}
  async function load(){const response=await fetch("/api/repair-types?all=1",{cache:"no-store"});const payload=await response.json() as Payload;if(!response.ok)throw new Error(payload.error||"Repair types could not be loaded.");accept(payload)}
  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Repair types could not be loaded."))},[]);

  async function post(key:string,body:Record<string,unknown>,success:string){
    setBusy(key);setMessage("");
    try{const response=await fetch("/api/repair-types",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const payload=await response.json() as Payload;if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair type could not be saved.");accept(payload);setMessage(success);return true}catch(error){setMessage(error instanceof Error?error.message:"Repair type could not be saved.");return false}finally{setBusy("")}
  }

  async function create(){
    const name=newName.trim();if(!name){setMessage("Enter a repair type name.");return}
    if(await post("create",{action:"create",name,unitRule:newUnitRule,checklistMode:newChecklist},`${name} added.`)){setNewName("");setNewUnitRule("required");setNewChecklist("none")}
  }

  function patch(id:number,value:Partial<Draft>){setDrafts(current=>({...current,[id]:{...current[id],...value}}))}
  async function save(type:RepairType){const value=drafts[type.id]??draft(type);await post(`save-${type.id}`,{action:"update",id:type.id,...value},`${value.name} saved.`)}

  return <main style={{minHeight:"100vh",background:"#f3f5f7",padding:"30px clamp(12px,3vw,34px) 90px",color:"#182331"}}>
    <header style={{maxWidth:1150,margin:"0 auto",display:"flex",justifyContent:"space-between",gap:18,alignItems:"flex-end",flexWrap:"wrap"}}>
      <div><p style={{margin:0,color:"#f47b20",fontSize:11,fontWeight:950,letterSpacing:".14em"}}>SETUP</p><h1 style={{margin:"6px 0 0",fontSize:34,color:"#102a43"}}>Repair Types</h1><p style={{margin:"7px 0 0",maxWidth:820,color:"#64748b",fontSize:13,lineHeight:1.5}}>This is the master category list used on shop repairs, work-order review and reporting. PM and Annual remain their dedicated maintenance workflows.</p></div>
      <a href="/maintenance-checklists" style={secondary}>PM & Annual Checklists</a>
    </header>

    {message&&<div style={{maxWidth:1150,margin:"14px auto 0",padding:"10px 12px",border:"1px solid #f2c66d",borderRadius:9,background:"#fff8e6",fontSize:12,fontWeight:800}}>{message}</div>}

    <section style={{...panel,maxWidth:1150,margin:"16px auto 0"}}>
      <strong style={{fontSize:16,color:"#102a43"}}>+ Add Repair Type</strong>
      <div style={{display:"grid",gridTemplateColumns:"minmax(260px,2fr) minmax(160px,1fr) minmax(180px,1fr) auto",gap:9,marginTop:10,alignItems:"end"}}>
        <label style={label}>NAME<input value={newName} onChange={event=>setNewName(event.target.value)} placeholder="New repair type" style={input}/></label>
        <label style={label}>UNIT<select value={newUnitRule} onChange={event=>setNewUnitRule(event.target.value as UnitRule)} style={input}><option value="required">Unit required</option><option value="optional">Unit optional</option></select></label>
        <label style={label}>CHECKLIST<select value={newChecklist} onChange={event=>setNewChecklist(event.target.value as ChecklistMode)} style={input}><option value="none">No checklist</option><option value="optional">Checklist optional</option><option value="required">Checklist required</option></select></label>
        <button type="button" disabled={Boolean(busy)} onClick={()=>void create()} style={button}>ADD TYPE</button>
      </div>
    </section>

    <section style={{maxWidth:1150,margin:"14px auto 0",display:"grid",gap:9}}>
      {types.map(type=>{const value=drafts[type.id]??draft(type);const lockedNew=type.systemKey==="new-equipment-check",lockedIndirect=type.systemKey==="indirect-labor";return <article key={type.id} style={{...panel,opacity:value.active?1:.62}}>
        <div style={{display:"grid",gridTemplateColumns:"minmax(250px,2fr) 100px minmax(160px,1fr) minmax(170px,1fr) auto",gap:9,alignItems:"end"}}>
          <label style={label}>REPAIR TYPE<input value={value.name} onChange={event=>patch(type.id,{name:event.target.value})} style={input}/></label>
          <label style={label}>ORDER<input type="number" value={value.sortOrder} onChange={event=>patch(type.id,{sortOrder:Number(event.target.value)})} style={input}/></label>
          <label style={label}>UNIT RULE<select value={value.unitRule} disabled={lockedNew||lockedIndirect} onChange={event=>patch(type.id,{unitRule:event.target.value as UnitRule})} style={input}><option value="required">Unit required</option><option value="optional">Unit optional</option></select></label>
          <label style={label}>CHECKLIST<select value={value.checklistMode} disabled={lockedNew||lockedIndirect} onChange={event=>patch(type.id,{checklistMode:event.target.value as ChecklistMode})} style={input}><option value="none">No checklist</option><option value="optional">Optional checklist</option><option value="required">Required checklist</option></select></label>
          <button type="button" disabled={Boolean(busy)} onClick={()=>void save(type)} style={button}>{busy===`save-${type.id}`?"SAVING…":"SAVE"}</button>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap",marginTop:10,paddingTop:10,borderTop:"1px solid #edf1f4"}}>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,fontWeight:850}}><input type="checkbox" checked={value.active} onChange={event=>patch(type.id,{active:event.target.checked})}/> Active</label>
            {type.systemKey&&<span style={{padding:"4px 7px",borderRadius:999,background:"#eef3f7",fontSize:10,fontWeight:900}}>SYSTEM WORKFLOW</span>}
            {value.checklistMode!=="none"&&<span style={{padding:"4px 7px",borderRadius:999,background:type.checklistConfigured?"#e9f7ef":"#fff1df",color:type.checklistConfigured?"#176440":"#8a5200",fontSize:10,fontWeight:900}}>{type.checklistConfigured?"CHECKLIST READY":"CHECKLIST NEEDS SETUP"}</span>}
            {lockedNew&&<span style={{fontSize:11,color:"#6b7784"}}>New Equipment Check always requires a unit and completed checklist.</span>}
            {lockedIndirect&&<span style={{fontSize:11,color:"#6b7784"}}>Indirect Labor always allows SHOP / NO UNIT and does not require a checklist.</span>}
          </div>
          {value.checklistMode!=="none"&&<a href={`/repair-types/checklist?repairTypeId=${type.id}`} style={secondary}>{type.checklistConfigured?"EDIT CHECKLIST":"BUILD CHECKLIST"}</a>}
        </div>
      </article>})}
    </section>
  </main>;
}
