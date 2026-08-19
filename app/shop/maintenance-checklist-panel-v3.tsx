"use client";

import {useEffect,useState} from 'react';
import MaintenanceChecklistPanelV2 from './maintenance-checklist-panel-v2';
import PmSheetDetails from './pm-sheet-details';
import TechnicianRepairTools from './technician-repair-tools-v2';
import TechnicianRepairReview from './technician-repair-review';
import type {ChecklistData,Part} from './maintenance-types';

type Props={repairId:string;canWork:boolean;parts?:Part[]};

export default function MaintenanceChecklistPanelV3(props:Props){
  const[checklist,setChecklist]=useState<ChecklistData|null>(null);

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try{
        const r=await fetch(`/api/maintenance-checklist?repairId=${encodeURIComponent(props.repairId)}`,{cache:'no-store'});
        const p=await r.json() as ChecklistData;
        if(!cancelled&&r.ok)setChecklist(p);
      }catch{}
    }
    void load();
    const id=window.setInterval(()=>void load(),3000);
    return()=>{cancelled=true;window.clearInterval(id)};
  },[props.repairId]);

  const showTires=Boolean(
    checklist?.started&&
    checklist.eventType==='pm'&&
    checklist.status==='in_progress'&&
    Number(checklist.pendingCount??checklist.items.filter(i=>i.result==='pending').length)>0
  );

  return <>
    <TechnicianRepairTools repairId={props.repairId} canWork={props.canWork}/>
    {showTires&&<PmSheetDetails repairId={props.repairId} canWork={props.canWork} tiresOnly/>}
    <MaintenanceChecklistPanelV2 {...props}/>
    <TechnicianRepairReview repairId={props.repairId} canWork={props.canWork} checklist={checklist}/>
  </>;
}
