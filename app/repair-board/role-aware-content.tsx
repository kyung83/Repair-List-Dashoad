"use client";

import { useEffect, useState } from "react";
import RepairBoardDashboard from "./dashboard-v2";
import PlanningCenter from "./planning-center";
import RepairBoardSelfAssignPanel from "./self-assign-panel";
import RepairCardOutsideVendor from "./repair-card-outside-vendor";
import RepairBoardUnassign from "./repair-board-unassign";
import RepairBoardAddRepair from "./add-repair-form";
import s from "./repair-board.module.css";

type Role="viewer"|"mechanic"|"dispatch"|"manager"|"admin";
type User={role:Role};
type Equipment={id:number;unit:string;equipmentType:string;driver:string;location:string};
type BoardData={equipment?:Equipment[];error?:string};

export default function RepairBoardRoleAwareContent(){
  const[role,setRole]=useState<Role|null>(null);
  const[equipment,setEquipment]=useState<Equipment[]>([]);
  const[adding,setAdding]=useState(false);
  const[message,setMessage]=useState("");
  const[managerView,setManagerView]=useState<"planning"|"classic">("planning");

  useEffect(()=>{
    let cancelled=false;
    void fetch('/api/auth/me',{cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error('User clearance could not be loaded.');
        return (await response.json() as{user:User}).user;
      })
      .then(async user=>{
        if(cancelled)return;
        setRole(user.role);
        if(user.role!=='dispatch')return;
        const response=await fetch('/api/repair-board',{cache:'no-store'});
        const payload=await response.json() as BoardData;
        if(!response.ok)throw new Error(payload.error||'Repair Board could not be loaded.');
        if(!cancelled)setEquipment(payload.equipment??[]);
      })
      .catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:'Repair Board could not be loaded.');});
    return()=>{cancelled=true;};
  },[]);

  if(role===null){
    return <main className={s.page}><div className={s.shell}><div style={{padding:24,fontWeight:800,color:'#526171'}}>{message||'Loading Repair Board…'}</div></div></main>;
  }

  if(role==='dispatch'){
    return <>
      <style>{`
        .${s.page} { background: #fff; }
        .${s.stack}>section:nth-child(2) { order: -1; }
        .${s.openRow} select[aria-label^="Assign Unit"] { display: none !important; }
        .${s.detailGrid} > div:nth-child(2) > b:first-child { display: none !important; }
        .${s.detailGrid} > div:nth-child(2) > select.${s.fieldSelect}:first-of-type { display: none !important; }
      `}</style>
      <div style={{background:'#fff',padding:'18px 34px 0'}}>
        <div style={{maxWidth:1600,margin:'0 auto',display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap',padding:'14px 16px',border:'1px solid #d8e0e6',borderRadius:12,background:'#f7f9fa'}}>
          <div><strong style={{display:'block',color:'#172033'}}>Dispatch Repair Board</strong><span style={{display:'block',marginTop:3,fontSize:13,color:'#667482'}}>View current work, add unassigned shop repairs, or submit a roadside breakdown when a driver needs help.</span></div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <a href="/report-breakdown" className={s.secondaryAction} style={{textDecoration:'none'}}>Submit Breakdown</a>
            <a href="/breakdowns" className={s.secondaryAction} style={{textDecoration:'none'}}>Active Breakdowns</a>
            <button type="button" className={s.addButton} onClick={()=>setAdding(true)}>+ Add Repair</button>
          </div>
        </div>
        {message&&<div style={{maxWidth:1600,margin:'10px auto 0',padding:'10px 12px',border:'1px solid #f2c66d',borderRadius:9,background:'#fff8e6'}}>{message}</div>}
        {adding&&<div style={{maxWidth:1100,margin:'12px auto 0'}}><RepairBoardAddRepair equipment={equipment} technicians={[]} initialEquipmentId={null} allowTechnicianAssignment={false} onClose={()=>{setAdding(false);window.location.reload();}} onSaved={()=>undefined}/></div>}
      </div>
      <RepairBoardDashboard />
    </>;
  }

  if(role==='manager'||role==='admin'){
    return <>
      <div style={{background:'#f5f8fb',padding:'10px 22px 0'}}>
        <div style={{maxWidth:1780,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',padding:'9px 11px',border:'1px solid #d8e2eb',borderRadius:10,background:'#fff'}}>
          <div><strong style={{display:'block',fontSize:12,color:'#21384d'}}>Repair Board View</strong><span style={{display:'block',marginTop:2,fontSize:9,color:'#758493'}}>Planning Center is the manager workflow. Classic Board remains available only as a rollout fallback.</span></div>
          <div style={{display:'flex',gap:6}}>
            <button type="button" onClick={()=>setManagerView('planning')} style={{minHeight:34,padding:'0 11px',borderRadius:8,border:managerView==='planning'?'1px solid #176fe6':'1px solid #cbd7e1',background:managerView==='planning'?'#176fe6':'#fff',color:managerView==='planning'?'#fff':'#30475b',fontSize:10,fontWeight:900,cursor:'pointer'}}>Planning Center</button>
            <button type="button" onClick={()=>setManagerView('classic')} style={{minHeight:34,padding:'0 11px',borderRadius:8,border:managerView==='classic'?'1px solid #263b50':'1px solid #cbd7e1',background:managerView==='classic'?'#263b50':'#fff',color:managerView==='classic'?'#fff':'#30475b',fontSize:10,fontWeight:900,cursor:'pointer'}}>Classic Board</button>
          </div>
        </div>
      </div>
      {managerView==='planning'
        ? <PlanningCenter/>
        : <><RepairBoardSelfAssignPanel/><RepairBoardDashboard/><RepairCardOutsideVendor/><RepairBoardUnassign/></>}
    </>;
  }

  return <>
    <style>{`
      .${s.page} { background: #fff; }
      .${s.stack}>section:nth-child(2) { order: -1; }
      .${s.openRow} select[aria-label^="Assign Unit"] { display: none !important; }
      .${s.detailGrid} > div:nth-child(2) > b:first-child { display: none !important; }
      .${s.detailGrid} > div:nth-child(2) > select.${s.fieldSelect}:first-of-type { display: none !important; }
    `}</style>
    <RepairBoardSelfAssignPanel />
    <RepairBoardDashboard />
    <RepairCardOutsideVendor />
  </>;
}
