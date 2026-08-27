import { completeRepair, savePart, saveRepair, usePartOnRepair } from './dashboard-db';
import { addRepairLabor, getShopLaborRate } from './billing';

type RepairRow = {
  id:number;
  equipment_id:number|null;
  unit:string;
  title:string;
  status:string;
  parts_text:string|null;
  driver:string|null;
  location:string|null;
  technician_id:number|null;
  technician_name:string|null;
  geotab_defect_id:string|null;
  labor_hours:number|null;
  labor_rate:number|null;
  outside_cost:number|null;
  completed_at:string|null;
  reviewed_at:string|null;
  reviewed_by_user_id:number|null;
  review_note:string|null;
  reviewer_name:string|null;
  updated_at:string;
};
type TechnicianRow = { id:number; name:string; email:string|null; phone:string|null };
type PartRow = { id:number; part_number:string; description:string; quantity_on_hand:number; unit_cost:number|null; location:string|null };
type UsageRow = { id:number; repair_id:number; part_id:number; part_number:string; description:string; quantity:number; unit_cost:number|null };
type DvirRow = { geotab_defect_id:string; asset_unit:string; driver:string|null; defect:string };
type LaborRow = { id:number; repair_id:number; technician_id:number|null; technician_name:string|null; labor_date:string; hours:number; rate:number; notes:string|null; started_at:string|null; ended_at:string|null };
type LaborEventRow = { id:number; repair_id:number; user_id:number|null; technician_id:number|null; action:string; detail:string; created_at:string };
type TechnicianNoteRow = { id:number; repair_id:number; technician_id:number|null; technician_name:string|null; detail:string; created_at:string };
type TimerSegment = { startedAt:string; endedAt:string; hours:number|null };

function repairNumber(value:unknown){const match=String(value??'').match(/^repair-(\d+)$/);if(!match)throw new Error('Repair row not found');return Number(match[1]);}
function finiteNumber(value:unknown,fallback=0){const number=Number(value);return Number.isFinite(number)?number:fallback;}
function completeStatus(value:unknown){return String(value??'').toLowerCase().includes('complete');}
function timestamp(value:string|null|undefined){return String(value??'').trim();}
function detroitDate(value:string){
  const normalized=value.includes('T')?value:value.replace(' ','T')+'Z';
  const date=new Date(normalized);
  if(Number.isNaN(date.getTime()))return value.slice(0,10)||'unknown-date';
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const values=new Map(parts.map((part)=>[part.type,part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}
function laborSegmentKey(repairId:number,technicianId:number|null){return `${repairId}|${technicianId??'none'}`;}
function laborActorKey(row:LaborEventRow){return `${row.repair_id}|${row.technician_id??'none'}|${row.user_id??'none'}`;}
function hoursFromStopDetail(detail:string){const match=detail.match(/saved at\s+([0-9]+(?:\.[0-9]+)?)\s+hours/i);return match?Number(match[1]):null;}

export async function getWorkOrderData(db:D1Database){
 const [repairsResult,techniciansResult,partsResult,usageResult,dvirResult,laborResult,laborEventResult,noteResult,defaultLaborRate]=await Promise.all([
  db.prepare(`
    SELECT r.id,r.equipment_id,COALESCE(e.unit,'') AS unit,r.title,r.status,r.parts_text,r.driver,r.location,
           r.technician_id,t.name AS technician_name,r.geotab_defect_id,r.labor_hours,r.labor_rate,r.outside_cost,
           r.completed_at,r.reviewed_at,r.reviewed_by_user_id,r.review_note,r.updated_at,
           COALESCE(NULLIF(au.display_name,''),NULLIF(au.username,''),'') AS reviewer_name
    FROM repairs r
    LEFT JOIN equipment e ON e.id=r.equipment_id
    LEFT JOIN technicians t ON t.id=r.technician_id
    LEFT JOIN app_users au ON au.id=r.reviewed_by_user_id
    WHERE COALESCE(r.source,'') NOT IN ('outside-work','roadside-breakdown')
    ORDER BY CASE WHEN lower(r.status) LIKE '%complete%' THEN 1 ELSE 0 END,r.updated_at DESC
  `).all<RepairRow>(),
  db.prepare(`SELECT id,name,email,phone FROM technicians WHERE active=1 ORDER BY name`).all<TechnicianRow>(),
  db.prepare(`SELECT id,part_number,description,quantity_on_hand,unit_cost,location FROM parts WHERE active=1 ORDER BY description,part_number`).all<PartRow>(),
  db.prepare(`
    SELECT rp.id,rp.repair_id,rp.part_id,p.part_number,p.description,rp.quantity,rp.unit_cost AS unit_cost
    FROM repair_parts rp
    JOIN parts p ON p.id=rp.part_id
    ORDER BY rp.created_at,rp.id
  `).all<UsageRow>(),
  db.prepare(`SELECT geotab_defect_id,asset_unit,driver,defect FROM dvir_defects WHERE repaired=0 ORDER BY updated_at DESC`).all<DvirRow>(),
  db.prepare(`
    SELECT l.id,l.repair_id,l.technician_id,t.name AS technician_name,l.labor_date,l.hours,l.rate,l.notes,
           l.started_at,l.ended_at
    FROM repair_labor_entries l
    LEFT JOIN technicians t ON t.id=l.technician_id
    ORDER BY l.labor_date,l.id
  `).all<LaborRow>(),
  db.prepare(`
    SELECT id,repair_id,user_id,technician_id,action,COALESCE(detail,'') AS detail,created_at
    FROM repair_job_events
    WHERE action IN ('labor_started','labor_stopped')
    ORDER BY created_at,id
  `).all<LaborEventRow>(),
  db.prepare(`
    SELECT e.id,e.repair_id,e.technician_id,t.name AS technician_name,COALESCE(e.detail,'') AS detail,e.created_at
    FROM repair_job_events e
    LEFT JOIN technicians t ON t.id=e.technician_id
    WHERE e.action='technician_note'
    ORDER BY e.created_at,e.id
  `).all<TechnicianNoteRow>(),
  getShopLaborRate(db),
 ]);

 const usageByRepair=new Map<number,UsageRow[]>();
 for(const row of usageResult.results){const list=usageByRepair.get(row.repair_id)??[];list.push(row);usageByRepair.set(row.repair_id,list);}
 const laborByRepair=new Map<number,LaborRow[]>();
 for(const row of laborResult.results){const list=laborByRepair.get(row.repair_id)??[];list.push(row);laborByRepair.set(row.repair_id,list);}
 const notesByRepair=new Map<number,TechnicianNoteRow[]>();
 for(const row of noteResult.results){const list=notesByRepair.get(row.repair_id)??[];list.push(row);notesByRepair.set(row.repair_id,list);}

 const openTimerStarts=new Map<string,string>();
 const timerSegments=new Map<string,TimerSegment[]>();
 for(const event of laborEventResult.results){
  const actorKey=laborActorKey(event);
  if(event.action==='labor_started'){
    openTimerStarts.set(actorKey,event.created_at);
    continue;
  }
  if(event.action!=='labor_stopped')continue;
  const startedAt=openTimerStarts.get(actorKey);
  if(!startedAt)continue;
  const key=laborSegmentKey(event.repair_id,event.technician_id);
  const list=timerSegments.get(key)??[];
  list.push({startedAt,endedAt:event.created_at,hours:hoursFromStopDetail(event.detail)});
  timerSegments.set(key,list);
  openTimerStarts.delete(actorKey);
 }
 const usedTimerSegments=new Map<string,Set<number>>();
 function takeTimerSegment(repairId:number,technicianId:number|null,hours:number){
  const key=laborSegmentKey(repairId,technicianId);
  const list=timerSegments.get(key)??[];
  const used=usedTimerSegments.get(key)??new Set<number>();
  let index=list.findIndex((segment,i)=>!used.has(i)&&segment.hours!==null&&Math.abs(Number(segment.hours)-hours)<=0.011);
  if(index<0)index=list.findIndex((segment,i)=>!used.has(i)&&segment.hours===null);
  if(index<0)return null;
  used.add(index);usedTimerSegments.set(key,used);return list[index];
 }

 const repairs=repairsResult.results.map(row=>{
  const laborEntries=(laborByRepair.get(row.id)??[]).map(l=>{
    const segment=takeTimerSegment(row.id,l.technician_id,Number(l.hours));
    return {
      id:l.id,technicianId:l.technician_id,technician:l.technician_name??'Shop labor',laborDate:l.labor_date,
      hours:Number(l.hours),rate:Number(l.rate),amount:Number(l.hours)*Number(l.rate),notes:l.notes??'',
      startedAt:timestamp(l.started_at)||segment?.startedAt||'',endedAt:timestamp(l.ended_at)||segment?.endedAt||''
    };
  });
  const recordedLaborHours=laborEntries.reduce((sum,item)=>sum+item.hours,0);
  const recordedLaborCost=laborEntries.reduce((sum,item)=>sum+item.amount,0);
  const fallbackLaborHours=Number(row.labor_hours??0);
  const fallbackLaborRate=Number(row.labor_rate??defaultLaborRate);
  const laborHours=laborEntries.length?recordedLaborHours:fallbackLaborHours;
  const laborCost=laborEntries.length?recordedLaborCost:fallbackLaborHours*fallbackLaborRate;
  const usedParts=(usageByRepair.get(row.id)??[]).map(u=>{
    const costRecorded=u.unit_cost!==null&&u.unit_cost!==undefined;
    const unitCost=costRecorded?Number(u.unit_cost):0;
    const quantity=Number(u.quantity);
    return {usageId:u.id,partId:u.part_id,partNumber:u.part_number,description:u.description,quantity,unitCost,lineCost:quantity*unitCost,costRecorded};
  });
  const partCost=usedParts.reduce((sum,item)=>sum+item.lineCost,0);
  const missingPartCostLines=usedParts.filter((item)=>!item.costRecorded).length;
  const outsideCost=Number(row.outside_cost??0);
  const technicianNotes=(notesByRepair.get(row.id)??[]).map(note=>({
    id:note.id,technicianId:note.technician_id,technician:note.technician_name??'Technician',detail:note.detail,createdAt:note.created_at
  }));
  return {
    id:`repair-${row.id}`,numericId:row.id,equipmentId:row.equipment_id,unit:row.unit,issue:row.title,status:row.status,
    partsText:row.parts_text??'',assignedTo:row.technician_name??row.driver??'',technicianId:row.technician_id,
    location:row.location??'',relatedGeotabDefectId:row.geotab_defect_id??'',laborHours,laborRate:fallbackLaborRate,laborCost,
    outsideCost,partCost,missingPartCostLines,totalCost:laborCost+partCost+outsideCost,usedParts,laborEntries,technicianNotes,
    completedAt:timestamp(row.completed_at),reviewedAt:timestamp(row.reviewed_at),reviewedBy:row.reviewer_name??'',reviewNote:row.review_note??'',updatedAt:row.updated_at,
  };
 });

 type RepairView=(typeof repairs)[number];
 const packageMap=new Map<string,RepairView[]>();
 for(const repair of repairs){
  if(!completeStatus(repair.status))continue;
  const completionDate=detroitDate(repair.completedAt||repair.updatedAt);
  const equipmentKey=repair.equipmentId===null?repair.unit:`equipment-${repair.equipmentId}`;
  const technicianKey=repair.technicianId===null?repair.assignedTo:`technician-${repair.technicianId}`;
  const key=`${equipmentKey}|${technicianKey}|${completionDate}`;
  const list=packageMap.get(key)??[];list.push(repair);packageMap.set(key,list);
 }

 const reviewPackages=[...packageMap.entries()].map(([key,group])=>{
  const repairIds=group.map(item=>item.id);
  const notes=group.flatMap(item=>item.technicianNotes.map(note=>({...note,repairId:item.id,repairIssue:item.issue})))
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const laborEntries=group.flatMap(item=>item.laborEntries.map(entry=>({...entry,repairId:item.id,repairIssue:item.issue})));
  const usedParts=group.flatMap(item=>item.usedParts.map(part=>({...part,repairId:item.id,repairIssue:item.issue})));
  const completionDate=detroitDate(group[0]?.completedAt||group[0]?.updatedAt||'');
  const completedAt=group.map(item=>item.completedAt||item.updatedAt).sort().at(-1)??'';
  const reviewed=group.every(item=>Boolean(item.reviewedAt));
  const reviewedAt=reviewed?(group.map(item=>item.reviewedAt).filter(Boolean).sort().at(-1)??''):'';
  const reviewedBy=reviewed?(group.map(item=>item.reviewedBy).find(Boolean)??''):'';
  const reviewNote=reviewed?(group.map(item=>item.reviewNote).find(Boolean)??''):'';
  const laborCost=group.reduce((sum,item)=>sum+item.laborCost,0);
  const partCost=group.reduce((sum,item)=>sum+item.partCost,0);
  const outsideCost=group.reduce((sum,item)=>sum+item.outsideCost,0);
  const missingPartCostLines=group.reduce((sum,item)=>sum+item.missingPartCostLines,0);
  return {
    id:`work-${key.replace(/[^a-z0-9_-]+/gi,'-')}`,
    repairIds,unit:group[0]?.unit??'',equipmentId:group[0]?.equipmentId??null,technician:group[0]?.assignedTo??'',
    technicianId:group[0]?.technicianId??null,completionDate,completedAt,reviewed,reviewedAt,reviewedBy,reviewNote,
    repairs:group,technicianNotes:notes,laborEntries,usedParts,missingPartCostLines,
    laborHours:group.reduce((sum,item)=>sum+item.laborHours,0),laborCost,partCost,outsideCost,totalCost:laborCost+partCost+outsideCost,
  };
 }).sort((a,b)=>Number(a.reviewed)-Number(b.reviewed)||b.completedAt.localeCompare(a.completedAt));

 return {
  defaultLaborRate,
  repairs,
  reviewPackages,
  summary:{
    needsReview:reviewPackages.filter(item=>!item.reviewed).length,
    reviewed:reviewPackages.filter(item=>item.reviewed).length,
    openRepairs:repairs.filter(item=>!completeStatus(item.status)).length,
    completedRepairs:repairs.filter(item=>completeStatus(item.status)).length,
    completedValue:reviewPackages.reduce((sum,item)=>sum+item.totalCost,0),
  },
  technicians:techniciansResult.results.map(r=>({id:r.id,name:r.name,email:r.email??'',phone:r.phone??''})),
  parts:partsResult.results.map(r=>({id:r.id,partNumber:r.part_number,description:r.description,quantityOnHand:Number(r.quantity_on_hand),unitCost:r.unit_cost==null?null:Number(r.unit_cost),location:r.location??''})),
  dvir:dvirResult.results.map(r=>({defectId:r.geotab_defect_id,asset:r.asset_unit,driver:r.driver??'',defect:r.defect})),
  updatedAt:new Date().toISOString(),
 };
}

export async function saveTechnician(db:D1Database,body:Record<string,unknown>){const name=String(body.name??'').trim();if(!name)throw new Error('Technician name is required');const id=finiteNumber(body.id,0);const email=String(body.email??'').trim();const phone=String(body.phone??'').trim();if(id>0){await db.prepare(`UPDATE technicians SET name=?,email=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(name,email,phone,id).run();return{ok:true,id};}const result=await db.prepare(`INSERT INTO technicians (name,email,phone) VALUES (?,?,?)`).bind(name,email,phone).run();return{ok:true,id:result.meta.last_row_id};}
export async function assignTechnician(db:D1Database,body:Record<string,unknown>){const repairId=repairNumber(body.repairId);const technicianId=finiteNumber(body.technicianId,0);if(!technicianId){await db.prepare(`UPDATE repairs SET technician_id=NULL,driver='',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(repairId).run();return{ok:true,repairId:`repair-${repairId}`,technicianId:null};}const technician=await db.prepare(`SELECT id,name FROM technicians WHERE id=? AND active=1`).bind(technicianId).first<{id:number;name:string}>();if(!technician)throw new Error('Technician not found');await db.prepare(`UPDATE repairs SET technician_id=?,driver=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(technician.id,technician.name,repairId).run();return{ok:true,repairId:`repair-${repairId}`,technicianId:technician.id};}
async function refreshRepairPartsText(db:D1Database,repairId:number){const rows=await db.prepare(`SELECT p.part_number,SUM(rp.quantity) AS quantity FROM repair_parts rp JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=? GROUP BY p.id,p.part_number ORDER BY p.part_number`).bind(repairId).all<{part_number:string;quantity:number}>();const text=rows.results.map(row=>`${row.part_number} x${Number(row.quantity)}`).join(', ');await db.prepare(`UPDATE repairs SET parts_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(text,repairId).run();}
export async function addPartToWorkOrder(db:D1Database,body:Record<string,unknown>){const repairId=repairNumber(body.repairId);const result=await usePartOnRepair(db,body);await refreshRepairPartsText(db,repairId);return result;}
export async function handleWorkOrderAction(db:D1Database,body:Record<string,unknown>){const action=String(body.action??'');if(action==='saveRepair')return saveRepair(db,body);if(action==='completeRepair')return completeRepair(db,body.id??body.repairId);if(action==='saveTechnician')return saveTechnician(db,body);if(action==='assignTechnician')return assignTechnician(db,body);if(action==='savePart')return savePart(db,body);if(action==='usePart')return addPartToWorkOrder(db,body);if(action==='addLabor')return addRepairLabor(db,body);throw new Error('Unknown work-order action');}
