"use client";

import { useEffect, useMemo, useState } from "react";
import s from "./repair-corrections.module.css";

type Repair = {
  id:string;
  source:string;
  unit:string;
  issue:string;
  status:string;
  technicianId:number|null;
  assignedTo:string;
  laborHours:number;
  equipmentId:number|null;
};
type Equipment = { id:number; unit:string; equipmentType:string; driver:string; location:string };
type Data = { canManage:boolean; repairs:Repair[]; equipment:Equipment[] };
type Draft = { title:string; equipmentId:string };

export default function RepairCorrectionsPage(){
  const [data,setData]=useState<Data|null>(null);
  const [drafts,setDrafts]=useState<Record<string,Draft>>({});
  const [search,setSearch]=useState("");
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  async function load(){
    const response=await fetch("/api/repair-board",{cache:"no-store"});
    const payload=await response.json() as Data&{error?:string};
    if(!response.ok)throw new Error(payload.error||"Repair corrections could not be loaded.");
    setData(payload);
    setDrafts(Object.fromEntries((payload.repairs||[]).filter(row=>row.source==="repair").map(row=>[
      row.id,{title:row.issue,equipmentId:String(row.equipmentId??"")}
    ])));
  }

  useEffect(()=>{void load().catch(error=>setMessage(error instanceof Error?error.message:"Repair corrections could not be loaded."));},[]);

  const repairs=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return (data?.repairs||[])
      .filter(row=>row.source==="repair")
      .filter(row=>!q||[row.unit,row.issue,row.status,row.assignedTo].join(" ").toLowerCase().includes(q))
      .sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true,sensitivity:"base"})||a.issue.localeCompare(b.issue));
  },[data,search]);

  async function post(row:Repair,action:string,body:Record<string,unknown>){
    setBusy(`${action}-${row.id}`);setMessage("");
    try{
      const response=await fetch("/api/repair-board",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action,repairId:row.id,...body}),
      });
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Repair correction could not be saved.");
      setMessage(action==="deleteRepair"?"Mistaken repair deleted.":"Repair corrected.");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"Repair correction could not be saved.");}
    finally{setBusy("");}
  }

  async function save(row:Repair){
    const draft=drafts[row.id]??{title:row.issue,equipmentId:String(row.equipmentId??"")};
    if(!draft.title.trim()){setMessage("Repair description cannot be blank.");return;}
    if(!draft.equipmentId){setMessage("Choose the correct unit.");return;}
    await post(row,"editRepair",{title:draft.title.trim(),equipmentId:Number(draft.equipmentId)});
  }

  async function remove(row:Repair){
    const reason=prompt(`Why are you deleting this repair from Unit ${row.unit}?`,`Entered by mistake`);
    if(reason===null)return;
    if(!reason.trim()){setMessage("Enter a reason before deleting a repair.");return;}
    if(!confirm(`Delete “${row.issue}” from Unit ${row.unit}?\n\nThis is only allowed when no labor, parts, photos, part requests, invoice, or maintenance history is attached.`))return;
    await post(row,"deleteRepair",{reason:reason.trim()});
  }

  if(!data)return <main className={s.page}><div className={s.card}>{message||"Loading repair corrections…"}</div></main>;
  if(!data.canManage)return <main className={s.page}><div className={s.card}><h1>Repair Corrections</h1><p>Manager or administrator access is required.</p></div></main>;

  return <main className={s.page}>
    <div className={s.header}>
      <div><p>MANAGER / ADMIN</p><h1>Repair Corrections</h1><span>Fix a repair description, move a manually entered repair to the correct unit, or remove a mistaken empty repair.</span></div>
      <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search unit, repair, technician…" />
    </div>

    <div className={s.notice}>
      <strong>Safe-delete rule:</strong> Delete is for mistaken entries only. If labor, parts, photos, a part request, an invoice, or maintenance history already exists, the system will refuse the delete so history cannot disappear. You can still correct the unit or repair wording.
    </div>
    {message&&<div className={s.message}>{message}</div>}

    <div className={s.table}>
      <div className={s.tableHead}><span>Current</span><span>Correct unit</span><span>Repair description</span><span>Work</span><span>Actions</span></div>
      {repairs.map(row=>{
        const draft=drafts[row.id]??{title:row.issue,equipmentId:String(row.equipmentId??"")};
        const changed=draft.title.trim()!==row.issue||Number(draft.equipmentId)!==Number(row.equipmentId??0);
        return <div className={s.row} key={row.id}>
          <div><strong>Unit {row.unit}</strong><small>{row.assignedTo||"Unassigned"} · {row.status}</small></div>
          <select value={draft.equipmentId} onChange={event=>setDrafts(current=>({...current,[row.id]:{...draft,equipmentId:event.target.value}}))}>
            <option value="">Choose unit…</option>
            {data.equipment.map(unit=><option key={unit.id} value={unit.id}>{unit.unit}</option>)}
          </select>
          <input value={draft.title} onChange={event=>setDrafts(current=>({...current,[row.id]:{...draft,title:event.target.value}}))} />
          <div><strong>{Number(row.laborHours||0).toFixed(2)} hr</strong><small>{row.id}</small></div>
          <div className={s.actions}>
            <button className={s.save} disabled={Boolean(busy)||!changed} onClick={()=>void save(row)}>{busy===`editRepair-${row.id}`?"Saving…":"Save Changes"}</button>
            <button className={s.delete} disabled={Boolean(busy)} onClick={()=>void remove(row)}>{busy===`deleteRepair-${row.id}`?"Deleting…":"Delete Mistake"}</button>
          </div>
        </div>;
      })}
      {!repairs.length&&<div className={s.empty}>No manually entered open repairs match this search.</div>}
    </div>
  </main>;
}
