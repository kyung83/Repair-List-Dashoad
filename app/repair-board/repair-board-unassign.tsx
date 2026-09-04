'use client';

import {useEffect} from 'react';

type Repair={
  id:string;
  unit:string;
  issue:string;
  parts?:string;
  source:string;
  equipmentType?:string;
  technicianId:number|null;
  activeTimer?:unknown;
};
type BoardPayload={repairs?:Repair[];error?:string};
type RepairBoardResult={ok?:boolean;error?:string};
type PlanningSelection={unit:string;panel:string};

const UNASSIGN_VALUE='__unassign_technician__';
const PLANNING_PANELS=[
  'Truck Repairs / DVIR',
  'Trailer Repairs / DVIR',
  'Other Equipment Repairs / DVIR',
  'PMs',
  'Truck Annuals',
  'Trailer Annuals',
  'Trailer Services',
  'Glass',
] as const;

function normalize(value:string){return value.replace(/\s+/g,' ').trim().toLowerCase();}
function pm(source:string){return source==='pm'||source==='pm-repair';}
function annual(source:string){return source==='annual'||source==='annual-repair';}
function kind(value:string){return /trailer/i.test(value)?'trailer':/truck|tractor|vehicle/i.test(value)?'truck':'other';}
function glass(row:Repair){return !pm(row.source)&&!annual(row.source)&&/\b(glass|windshield|windscreen|window|backlite|side glass)\b/i.test(`${row.issue||''} ${row.parts||''}`);}

function planningSelection(label:string):PlanningSelection|null{
  if(!label.startsWith('Select Unit '))return null;
  const value=label.slice('Select Unit '.length);
  for(const panel of PLANNING_PANELS){
    const suffix=` ${panel}`;
    if(value.endsWith(suffix))return{unit:value.slice(0,-suffix.length).trim(),panel};
  }
  return null;
}

function rowMatchesPlanningPanel(row:Repair,panel:string){
  const type=kind(row.equipmentType||'');
  const isPm=pm(row.source),isAnnual=annual(row.source),isGlass=glass(row);
  if(panel==='Truck Repairs / DVIR')return !isPm&&!isAnnual&&!isGlass&&type==='truck';
  if(panel==='Trailer Repairs / DVIR')return !isPm&&!isAnnual&&!isGlass&&type==='trailer';
  if(panel==='Other Equipment Repairs / DVIR')return !isPm&&!isAnnual&&!isGlass&&type==='other';
  if(panel==='PMs')return isPm&&type!=='trailer';
  if(panel==='Truck Annuals')return isAnnual&&type!=='trailer';
  if(panel==='Trailer Annuals')return isAnnual&&type==='trailer';
  if(panel==='Trailer Services')return isPm&&type==='trailer';
  if(panel==='Glass')return isGlass;
  return false;
}

async function loadRepairs(){
  const response=await fetch('/api/repair-board',{cache:'no-store'});
  const payload=await response.json() as BoardPayload;
  if(!response.ok)throw new Error(payload.error||'Repair Board could not be loaded.');
  return payload.repairs||[];
}

async function unassignRepair(row:Repair){
  if(!row.id.startsWith('repair-'))return false;
  if(row.technicianId===null)return false;
  if(row.activeTimer)throw new Error(`Unit ${row.unit} has active labor running. Stop the timer before unassigning this job.`);
  const response=await fetch('/api/repair-board',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({repairId:row.id,action:'assignTechnician',technicianId:0}),
  });
  const result=await response.json() as RepairBoardResult;
  if(!response.ok||!result.ok)throw new Error(result.error||`Unit ${row.unit} could not be unassigned.`);
  return true;
}

export default function RepairBoardUnassign(){
  useEffect(()=>{
    let disposed=false;

    async function unassignDetail(repairId:string){
      try{
        const rows=await loadRepairs();
        const row=rows.find(item=>item.id===repairId);
        if(!row){window.alert('That repair is no longer open. Refresh the board.');return;}
        if(row.technicianId===null){window.alert(`Unit ${row.unit} is already unassigned.`);return;}
        await unassignRepair(row);
        window.location.reload();
      }catch(error){window.alert(error instanceof Error?error.message:'The job could not be unassigned.');}
    }

    async function unassignSelected(){
      try{
        const rows=await loadRepairs();
        const checkboxes=Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label^="Select Unit "]:checked'));
        const selections=checkboxes.map(box=>planningSelection(box.getAttribute('aria-label')||'')).filter((value):value is PlanningSelection=>Boolean(value));
        const targets=new Map<string,Repair>();
        for(const selection of selections){
          rows
            .filter(row=>normalize(row.unit)===normalize(selection.unit)&&rowMatchesPlanningPanel(row,selection.panel))
            .filter(row=>row.id.startsWith('repair-')&&row.technicianId!==null)
            .forEach(row=>targets.set(row.id,row));
        }
        const selected=[...targets.values()];
        if(!selected.length){window.alert('None of the checked work is currently assigned to a technician.');return;}
        const running=selected.find(row=>Boolean(row.activeTimer));
        if(running){window.alert(`Unit ${running.unit} has active labor running. Stop the timer before unassigning selected work.`);return;}
        let changed=0;
        for(const row of selected){if(await unassignRepair(row))changed+=1;}
        if(changed)window.location.reload();
      }catch(error){window.alert(error instanceof Error?error.message:'The selected work could not be unassigned.');}
    }

    const attach=()=>{
      if(disposed)return;
      for(const select of Array.from(document.querySelectorAll<HTMLSelectElement>('select'))){
        if(select.querySelector(`option[value="${UNASSIGN_VALUE}"]`))continue;
        const aria=select.getAttribute('aria-label')||'';
        const optionText=Array.from(select.options).map(option=>option.textContent||'').join(' | ');
        const planningDetail=/^Technician for\s+repair-\d+/.test(aria);
        const planningBulk=Boolean(select.closest<HTMLElement>('[class*="bulk"]')&&/Choose technician/i.test(optionText));
        if(!planningDetail&&!planningBulk)continue;

        const option=document.createElement('option');
        option.value=UNASSIGN_VALUE;
        option.textContent=planningBulk?'Unassign Selected':'Unassigned';
        select.appendChild(option);
        select.dataset.unassignControl='1';
        select.dataset.unassignMode=planningBulk?'bulk':'detail';
        if(planningDetail)select.dataset.unassignRepair=aria.replace(/^Technician for\s+/,'').trim();

        const listener=()=>{
          if(select.value!==UNASSIGN_VALUE)return;
          const mode=select.dataset.unassignMode;
          const repairId=select.dataset.unassignRepair||'';
          select.value='';
          select.dispatchEvent(new Event('change',{bubbles:true}));
          if(mode==='bulk')void unassignSelected();
          else if(repairId)void unassignDetail(repairId);
        };
        select.addEventListener('change',listener);
        (select as HTMLSelectElement&{_unassignListener?:()=>void})._unassignListener=listener;
      }
    };

    attach();
    const observer=new MutationObserver(attach);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{
      disposed=true;
      observer.disconnect();
      document.querySelectorAll<HTMLSelectElement>('select[data-unassign-control="1"]').forEach(select=>{
        const listener=(select as HTMLSelectElement&{_unassignListener?:()=>void})._unassignListener;
        if(listener)select.removeEventListener('change',listener);
        select.querySelector(`option[value="${UNASSIGN_VALUE}"]`)?.remove();
        delete select.dataset.unassignControl;
        delete select.dataset.unassignMode;
        delete select.dataset.unassignRepair;
      });
    };
  },[]);

  return null;
}
