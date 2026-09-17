"use client";

import { useEffect, useMemo, useState } from "react";
import s from "./repair-board.module.css";

type Equipment={id:number;unit:string;equipmentType:string;driver:string;location:string};
type Technician={id:number;name:string};
type RepairType={id:number;name:string;unitRule:"required"|"optional";checklistMode:"none"|"optional"|"required";active:boolean;sortOrder:number};
type EquipmentKind="truck"|"trailer"|"other";

type Props={
  equipment:Equipment[];
  technicians:Technician[];
  initialEquipmentId:number|null;
  lockEquipment?:boolean;
  allowTechnicianAssignment?:boolean;
  onClose:()=>void;
  onSaved:()=>Promise<void>|void;
};

type CreateResult={ok?:boolean;error?:string;repairId?:string;equipmentId?:number|null;unit?:string;repairType?:string};

function kind(value:string):EquipmentKind{
  if(/trailer/i.test(value))return "trailer";
  if(/truck|tractor|vehicle/i.test(value))return "truck";
  return "other";
}
function searchable(value:string){return value.trim().toLowerCase()}

export default function RepairBoardAddRepair({equipment,technicians,initialEquipmentId,lockEquipment=false,allowTechnicianAssignment=true,onClose,onSaved}:Props){
  const initial=equipment.find(item=>item.id===initialEquipmentId)??null;
  const[selected,setSelected]=useState<Equipment|null>(initial);
  const[search,setSearch]=useState(initial?.unit??"");
  const[addNew,setAddNew]=useState(false);
  const[newType,setNewType]=useState<EquipmentKind>(initial?kind(initial.equipmentType):"other");
  const[newLocation,setNewLocation]=useState(initial?.location??"");
  const[repairTypes,setRepairTypes]=useState<RepairType[]>([]);
  const[repairTypeId,setRepairTypeId]=useState("");
  const[noUnit,setNoUnit]=useState(false);
  const[issue,setIssue]=useState("");
  const[parts,setParts]=useState("");
  const[priority,setPriority]=useState(2);
  const[technicianId,setTechnicianId]=useState("");
  const[lastSavedUnit,setLastSavedUnit]=useState("");
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState("");

  useEffect(()=>{void fetch("/api/repair-types",{cache:"no-store"}).then(async response=>{const payload=await response.json() as{types?:RepairType[];error?:string};if(!response.ok)throw new Error(payload.error||"Repair types could not be loaded.");setRepairTypes(payload.types??[])}).catch(error=>setMessage(error instanceof Error?error.message:"Repair types could not be loaded."))},[]);
  const selectedRepairType=repairTypes.find(type=>String(type.id)===repairTypeId)??null;
  const canSkipUnit=!lockEquipment&&selectedRepairType?.unitRule==="optional";

  useEffect(()=>{if(!canSkipUnit)setNoUnit(false)},[canSkipUnit]);

  const matches=useMemo(()=>{
    if(lockEquipment||selected||noUnit)return[];
    const needle=searchable(search);
    if(!needle)return[];
    const scored=equipment.map(item=>{
      const unit=searchable(item.unit);
      const haystack=[item.unit,item.location,item.driver,item.equipmentType].join(" ").toLowerCase();
      const score=unit===needle?0:unit.startsWith(needle)?1:haystack.includes(needle)?2:9;
      return{item,score};
    }).filter(entry=>entry.score<9).sort((a,b)=>a.score-b.score||a.item.unit.localeCompare(b.item.unit,undefined,{numeric:true,sensitivity:"base"}));
    return scored.slice(0,12).map(entry=>entry.item);
  },[equipment,lockEquipment,search,selected,noUnit]);

  function chooseEquipment(item:Equipment){setSelected(item);setSearch(item.unit);setNewLocation(item.location);setNewType(kind(item.equipmentType));setAddNew(false);setNoUnit(false);setLastSavedUnit("");setMessage("")}
  function changeUnit(){if(lockEquipment)return;setSelected(null);setSearch("");setAddNew(false);setNewType("other");setNewLocation("");setNoUnit(false);setLastSavedUnit("");setMessage("")}
  function chooseNoUnit(){setSelected(null);setSearch("");setAddNew(false);setNoUnit(true);setLastSavedUnit("");setMessage("")}

  async function createRepair(){
    const repair=issue.trim();
    if(!repairTypeId){setMessage("Choose a repair type.");return}
    if(!repair){setMessage("Enter the repair needed.");return}
    if(!noUnit&&!selected&&!addNew){setMessage("Search for a unit and select it, add a new unit, or choose SHOP / NO UNIT when that repair type allows it.");return}
    if(addNew&&!search.trim()){setMessage("Enter a unit number.");return}
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/repair-types/create-repair",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
          repairTypeId:Number(repairTypeId),
          mode:noUnit?"no-unit":selected?"equipment":"freeform",
          equipmentId:selected?.id??0,
          unit:selected?.unit??search.trim(),
          equipmentType:selected?kind(selected.equipmentType):newType,
          location:selected?.location??newLocation.trim(),
          issue:repair,parts:parts.trim(),priority,
          technicianId:allowTechnicianAssignment&&technicianId?Number(technicianId):0,
        }),
      });
      const result=await response.json() as CreateResult;
      if(!response.ok||!result.ok)throw new Error(result.error||"Repair could not be added.");
      setIssue("");setParts("");
      if(result.equipmentId&&result.unit&&result.unit!=="SHOP / NO UNIT"){
        const sticky:Equipment={id:Number(result.equipmentId),unit:result.unit,equipmentType:selected?.equipmentType??newType,driver:selected?.driver??"",location:selected?.location??newLocation.trim()};
        setSelected(sticky);setSearch(result.unit);setAddNew(false);setLastSavedUnit(result.unit);setMessage(`${result.repairType||"Repair"} added to Unit ${result.unit}. Add another repair below or close when you are done.`);
      }else{
        setSelected(null);setSearch("");setAddNew(false);setNoUnit(true);setLastSavedUnit("SHOP / NO UNIT");setMessage(`${result.repairType||"Repair"} added as SHOP / NO UNIT.`);
      }
      await onSaved();
    }catch(error){setMessage(error instanceof Error?error.message:"Repair could not be added.")}finally{setBusy(false)}
  }

  return <section className={s.addPanel}>
    <h3>{lastSavedUnit?`Add another repair — ${lastSavedUnit==="SHOP / NO UNIT"?lastSavedUnit:`Unit ${lastSavedUnit}`}`:"Add Repair"}</h3>
    {message&&<div style={{gridColumn:"1 / -1",padding:"9px 11px",borderRadius:8,background:"#fff8e6",border:"1px solid #f2c66d",fontSize:12,fontWeight:700}}>{message}</div>}
    <div>
      <label style={{gridColumn:"1 / -1"}}>Repair Type<select className={s.fieldSelect} value={repairTypeId} onChange={event=>{setRepairTypeId(event.target.value);setMessage("")}}><option value="">Choose repair type…</option>{repairTypes.map(type=><option key={type.id} value={type.id}>{type.name}{type.checklistMode==="required"?" · CHECKLIST":""}</option>)}</select></label>

      {canSkipUnit&&!selected&&!lockEquipment&&<div style={{gridColumn:"1 / -1"}}><button type="button" className={noUnit?s.addButton:s.secondaryAction} onClick={chooseNoUnit}>SHOP / NO UNIT</button><span style={{marginLeft:8,fontSize:11,color:"#667482"}}>Use this when the work should not be charged to a truck or trailer.</span></div>}

      {noUnit?<div style={{gridColumn:"1 / -1",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:"11px 12px",border:"1px solid #d5b27e",borderRadius:9,background:"#fff8ed"}}><div><strong>SHOP / NO UNIT</strong><div style={{fontSize:11,color:"#74604a",marginTop:2}}>Labor will be recorded without charging a fleet unit.</div></div><button type="button" className={s.metaButton} onClick={changeUnit}>Use a unit instead</button></div>:selected?<div style={{gridColumn:"1 / -1",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:"11px 12px",border:"1px solid #ccd5dd",borderRadius:9,background:"#f7f9fb"}}><div><strong>Unit {selected.unit}</strong><div style={{fontSize:11,color:"#667482",marginTop:2}}>{selected.equipmentType||"Equipment"}{selected.location?` · ${selected.location}`:""}</div></div>{!lockEquipment&&<button type="button" className={s.metaButton} onClick={changeUnit}>Change unit</button>}</div>:<>
        <label style={{gridColumn:"1 / -1"}}>Unit search<input className={s.fieldSelect} value={search} onChange={event=>{setSearch(event.target.value);setAddNew(false);setLastSavedUnit("");setMessage("")}} placeholder="Search unit #, location, driver…" autoFocus/></label>
        {matches.length>0&&<div style={{gridColumn:"1 / -1",display:"flex",gap:7,flexWrap:"wrap"}}>{matches.map(item=><button type="button" key={item.id} className={s.metaButton} onClick={()=>chooseEquipment(item)}>Unit {item.unit}{item.location?` · ${item.location}`:""}</button>)}</div>}
        {search.trim()&&matches.length===0&&<div style={{gridColumn:"1 / -1"}}><button type="button" className={s.secondaryAction} onClick={()=>{setSelected(null);setAddNew(true);setNewType("other");setMessage("")}}>No match — add “{search.trim()}” as new</button></div>}
      </>}

      {!noUnit&&!selected&&addNew&&<><label>Type<select className={s.fieldSelect} value={newType} onChange={event=>setNewType(event.target.value as EquipmentKind)}><option value="truck">Truck</option><option value="trailer">Trailer</option><option value="other">Other</option></select></label><label>Location<input className={s.fieldSelect} value={newLocation} onChange={event=>setNewLocation(event.target.value)} placeholder="Optional"/></label></>}
      <label>Repair<input className={s.fieldSelect} value={issue} onChange={event=>setIssue(event.target.value)} placeholder={selectedRepairType?.name==="INDIRECT LABOR-OTHER"?"What work is being done?":"What needs repaired?"}/></label>
      <label>Parts<input className={s.fieldSelect} value={parts} onChange={event=>setParts(event.target.value)} placeholder="Optional"/></label>
      <label>Priority<select className={s.fieldSelect} value={priority} onChange={event=>setPriority(Number(event.target.value))}><option value={1}>P1</option><option value={2}>P2</option><option value={3}>P3</option></select></label>
      {allowTechnicianAssignment&&<label>Tech<select className={s.fieldSelect} value={technicianId} onChange={event=>setTechnicianId(event.target.value)}><option value="">Unassigned</option>{technicians.map(technician=><option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label>}
    </div>
    <footer><button type="button" className={s.darkButton} onClick={onClose}>Close</button><button type="button" className={s.addButton} disabled={busy} onClick={()=>void createRepair()}>{busy?"Saving…":lastSavedUnit?"+ Add another repair":"Add Repair"}</button></footer>
  </section>;
}
