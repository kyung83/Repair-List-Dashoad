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
  const[inspectionOpen,setInspectionOpen]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    setInspectionOpen(false);
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

  const maintenanceLabel=checklist?.eventType==='annual'?'Annual Inspection':'PM Inspection';
  const maintenanceProgress=checklist?`${checklist.items.filter(item=>item.result!=='pending').length}/${checklist.items.length} answered`:'';

  return <>
    <TechnicianRepairTools repairId={props.repairId} canWork={props.canWork}/>
    {checklist&&<section style={maintenanceLauncher}>
      <button type="button" onClick={()=>setInspectionOpen(open=>!open)} style={maintenanceLauncherButton} aria-expanded={inspectionOpen}>
        <span style={maintenanceLauncherIcon}>▣</span>
        <span style={{minWidth:0,textAlign:'left',display:'grid',gap:3}}>
          <strong style={{fontSize:15,color:'#17324a'}}>{maintenanceLabel}</strong>
          <span style={{fontSize:12,color:'#617180'}}>{inspectionOpen?'Current PM / Annual layout is open below.':'Open the PM / Annual checklist exactly as it is today.'}{maintenanceProgress?` · ${maintenanceProgress}`:''}</span>
        </span>
        <span style={maintenanceLauncherArrow}>{inspectionOpen?'▲':'›'}</span>
      </button>
    </section>}
    {inspectionOpen&&showTires&&<PmSheetDetails repairId={props.repairId} canWork={props.canWork} tiresOnly/>}
    {inspectionOpen&&<MaintenanceChecklistPanelV2 {...props}/>} 
    <TechnicianRepairReview repairId={props.repairId} canWork={props.canWork} checklist={checklist}/>
  </>;
}

const maintenanceLauncher={marginTop:16,border:'1px solid #d7dee5',borderRadius:12,background:'#fffaf5',overflow:'hidden'} as const;
const maintenanceLauncherButton={width:'100%',border:0,background:'transparent',padding:'14px 15px',display:'grid',gridTemplateColumns:'34px minmax(0,1fr) auto',gap:11,alignItems:'center',cursor:'pointer'} as const;
const maintenanceLauncherIcon={width:34,height:34,borderRadius:9,display:'grid',placeItems:'center',background:'#edf4fb',color:'#17324a',fontSize:19,fontWeight:950} as const;
const maintenanceLauncherArrow={fontSize:24,lineHeight:1,color:'#17324a',fontWeight:950} as const;
