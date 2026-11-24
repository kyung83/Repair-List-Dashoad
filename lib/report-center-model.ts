import type {HistoryLineData} from './report-center-history';
import type {getReportSearchData} from './report-search';
import type {getBreakdownReportData} from './breakdown-reports';
export type RepairData=Awaited<ReturnType<typeof getReportSearchData>>;
export type BreakdownData=Awaited<ReturnType<typeof getBreakdownReportData>>;
export type Repair=RepairData['repairs'][number];
export type Breakdown=BreakdownData['breakdowns'][number];
export type UnitRollup={equipmentId:number;unit:string;repairCount:number;repairCost:number;breakdownCount:number;roadsideCost:number;knownHours:number;knownCount:number;unknownDowntime:number};
const norm=(s:unknown)=>String(s??'').trim().toLowerCase();
export const cleared=(b:Breakdown)=>norm(b.status)==='not_breakdown';
export const roadside=(r:Repair)=>norm(r.source)==='roadside-breakdown';
export const completed=(r:Repair)=>['complete','completed','closed'].includes(norm(r.status));
export const sum=<T>(rows:readonly T[],value:(row:T)=>number)=>rows.reduce((n,row)=>n+(Number(value(row))||0),0);
export function unitRollups(repairs:readonly Repair[],breakdowns:readonly Breakdown[]):UnitRollup[]{
  const map=new Map<number,UnitRollup>();
  function get(equipmentId:number,unit:string){
    const v=map.get(equipmentId)??{equipmentId,unit,repairCount:0,repairCost:0,breakdownCount:0,roadsideCost:0,knownHours:0,knownCount:0,unknownDowntime:0};
    map.set(equipmentId,v);return v;
  }
  for(const r of repairs){if(r.equipmentId==null)continue;const v=get(r.equipmentId,r.unit);v.repairCount++;v.repairCost+=r.totalCost;}
  for(const b of breakdowns){if(cleared(b))continue;const v=get(b.equipmentId,b.unit);v.breakdownCount++;v.roadsideCost+=b.totalCost;if(b.downtimeMinutes==null)v.unknownDowntime++;else{v.knownHours+=b.downtimeMinutes/60;v.knownCount++;}}
  return [...map.values()].sort((a,b)=>b.repairCost-a.repairCost||b.breakdownCount-a.breakdownCount);
}
type Event={id:number;equipmentId:number;unit:string;category:string;date:string;kind:'Repair'|'Breakdown'};
export type Repeat={equipmentId:number;unit:string;category:string;kind:Event['kind'];first:string;last:string;count:number;ids:number[]};
export function repeats(repairs:readonly Repair[],breakdowns:readonly Breakdown[],days:number):Repeat[]{
  const events:Event[]=[];
  for(const r of repairs){
    if(r.id<=0||r.equipmentId==null||roadside(r)||!completed(r)||['shop-duty','cutover-archive'].includes(norm(r.source)))continue;
    events.push({id:r.id,equipmentId:r.equipmentId,unit:r.unit,category:r.repairType,date:r.date,kind:'Repair'});
  }
  for(const b of breakdowns){if(!cleared(b))events.push({id:b.id,equipmentId:b.equipmentId,unit:b.unit,category:b.category,date:b.createdAt.slice(0,10),kind:'Breakdown'});}
  const groups=new Map<string,Event[]>();
  for(const e of events){
    if(!e.category||['uncategorized','historical ro','not recorded'].includes(norm(e.category))||!Number.isFinite(Date.parse(e.date)))continue;
    const key=JSON.stringify([e.equipmentId,norm(e.category),e.kind]);const g=groups.get(key)??[];g.push(e);groups.set(key,g);
  }
  const result:Repeat[]=[];
  for(const rows of groups.values()){
    rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
    let left=0,best:Event[]=[];
    for(let right=0;right<rows.length;right++){
      while(left<right&&Date.parse(rows[right].date)-Date.parse(rows[left].date)>days*86400000)left++;
      if(right-left+1>=best.length)best=rows.slice(left,right+1);
    }
    if(best.length>=2)result.push({equipmentId:best[0].equipmentId,unit:best[0].unit,category:best[0].category,kind:best[0].kind,first:best[0].date,last:best[best.length-1].date,count:best.length,ids:best.map(x=>x.id)});
  }
  return result.sort((a,b)=>b.count-a.count||b.last.localeCompare(a.last));
}
export type Cell=string|number|null;
export type AnalysisRow={key:string;kind:'repair'|'historical'|'breakdown'|'maintenance'|'part'|'expense';id:number;fields:Record<string,Cell>};
export type Dimension={key:string;label:string};
export type Dataset='repairs'|'breakdowns'|'maintenance'|'expenses'|'parts'|'history';
export const dimensions:Record<Dataset,Dimension[]>={
  repairs:[{key:'unit',label:'Unit'},{key:'category',label:'Repair type'},{key:'fleet',label:'Fleet category'},{key:'equipmentType',label:'Equipment type'},{key:'make',label:'Make'},{key:'model',label:'Model'},{key:'modelYear',label:'Model year'},{key:'technician',label:'Assigned technician'},{key:'location',label:'Repair location'},{key:'source',label:'Repair source'},{key:'status',label:'Status'},{key:'month',label:'Month'}],
  breakdowns:[{key:'unit',label:'Unit'},{key:'category',label:'Breakdown category'},{key:'equipmentType',label:'Equipment type'},{key:'make',label:'Make (equipment master)'},{key:'model',label:'Model (equipment master)'},{key:'modelYear',label:'Model year'},{key:'fleet',label:'Fleet category'},{key:'driver',label:'Driver'},{key:'provider',label:'Service provider'},{key:'location',label:'Breakdown location'},{key:'status',label:'Status'},{key:'month',label:'Month'},{key:'costClass',label:'Cost classification'},{key:'tirePositions',label:'Recorded tire position set'}],
  maintenance:[{key:'unit',label:'Unit'},{key:'category',label:'Event type'},{key:'pmType',label:'PM type'},{key:'source',label:'Source'},{key:'fleet',label:'Fleet category'},{key:'equipmentType',label:'Equipment type'},{key:'make',label:'Make'},{key:'model',label:'Model'},{key:'month',label:'Month'}],
  expenses:[{key:'unit',label:'Unit'},{key:'category',label:'Expense category'},{key:'provider',label:'Vendor'},{key:'source',label:'Source'},{key:'fleet',label:'Fleet category'},{key:'equipmentType',label:'Equipment type'},{key:'make',label:'Make'},{key:'model',label:'Model'},{key:'month',label:'Month'}],
  parts:[{key:'partNumber',label:'Part number'},{key:'issue',label:'Part description'}],
  history:[{key:'unit',label:'Unit'},{key:'category',label:'VMRS major category'},{key:'systemCode',label:'VMRS system'},{key:'assemblyCode',label:'VMRS assembly'},{key:'issue',label:'VMRS description'},{key:'roNumber',label:'Repair order'},{key:'fleet',label:'Fleet'},{key:'equipmentType',label:'Equipment type'},{key:'make',label:'Make'},{key:'model',label:'Model'},{key:'modelYear',label:'Model year'},{key:'month',label:'Month'}],
};
export function analysisRows(repairData:RepairData|null,breakdownData:BreakdownData|null,historyData:HistoryLineData|null=null){
  const equipment=new Map((repairData?.equipment??[]).map(r=>[r.id,r]));
  const repairs:AnalysisRow[]=(repairData?.repairs??[]).map(r=>({key:'r'+r.id,kind:r.id<0?'historical':'repair',id:Math.abs(r.id),fields:{unit:r.unit||'Shop / no unit',equipmentId:r.equipmentId,date:r.date,month:r.date.slice(0,7),category:r.repairType,issue:r.repair,status:r.status,technician:r.technician,location:r.location,fleet:r.category,equipmentType:r.equipmentType,make:r.make,model:r.model,modelYear:r.modelYear,source:r.source,partsCost:r.partsCost,laborCost:r.laborCost,outsideCost:r.outsideCost,totalCost:r.totalCost,laborHours:r.laborHours,completed:completed(r)?1:0}}));
  const breakdowns:AnalysisRow[]=(breakdownData?.breakdowns??[]).map(b=>{const e=equipment.get(b.equipmentId);return {key:'b'+b.id,kind:'breakdown',id:b.id,fields:{unit:b.unit,equipmentId:b.equipmentId,date:b.createdAt.slice(0,10),month:b.createdAt.slice(0,7),category:b.category,issue:b.repairNeeded||b.description,description:b.description,status:b.status,driver:b.driverName,provider:b.serviceProvider,location:b.location,equipmentType:b.equipmentType,fleet:e?.category??'',make:e?.make??'',model:e?.model??'',modelYear:e?.modelYear??null,tirePositions:b.tirePositions,partsCost:b.partsCost,laborCost:b.laborCost,outsideCost:b.outsideCost,totalCost:b.totalCost,costClass:cleared(b)?'Not a breakdown':b.stage<5?'Open / cost not final':b.totalCost===0?'No cost':'With cost',downtimeHours:b.downtimeMinutes==null?null:b.downtimeMinutes/60,arrivalHours:b.arrivalMinutes==null?null:b.arrivalMinutes/60,claimHours:b.claimMinutes==null?null:b.claimMinutes/60,repairHours:b.repairMinutes==null?null:b.repairMinutes/60,completed:b.stage>=5?1:0,rollingAt:b.rollingAt,repairId:b.repairId}};});
  function master(id:number){const e=equipment.get(id);return {fleet:e?.category??'',equipmentType:e?.equipmentType??'',make:e?.make??'',model:e?.model??'',modelYear:e?.modelYear??null};}
  const maintenance:AnalysisRow[]=(repairData?.maintenance??[]).map(r=>({key:'m'+r.id,id:r.id,kind:'maintenance',fields:{unit:r.unit,equipmentId:r.equipmentId,date:r.date,month:r.date.slice(0,7),category:r.type,pmType:r.pmType,issue:r.notes,mileage:r.mileage,source:r.source,...master(r.equipmentId)}}));
  const expenses:AnalysisRow[]=(repairData?.expenses??[]).map(r=>({key:'e'+r.id,id:r.id,kind:'expense',fields:{unit:r.unit,equipmentId:r.equipmentId,date:r.date,month:r.date.slice(0,7),category:r.category,provider:r.vendor,issue:r.description,totalCost:r.amount,source:r.source,...master(r.equipmentId)}}));
  const parts:AnalysisRow[]=(repairData?.parts??[]).map((r,i)=>({key:'p'+i,id:i,kind:'part',fields:{partNumber:r.partNumber,issue:r.description,quantity:r.quantity,repairLinks:r.repairCount,unitLinks:r.unitCount,totalCost:r.cost}}));
  const history:AnalysisRow[]=(historyData?.rows??[]).map(r=>({key:'hl'+r.id,id:r.historical_repair_id,kind:'historical',fields:{unit:r.unit,equipmentId:r.equipment_id,date:r.ro_date.slice(0,10),month:r.ro_date.slice(0,7),category:r.major_category,systemCode:r.system_code,assemblyCode:r.assembly_code,issue:r.vmrs_description,roNumber:r.ro_number,fleet:r.fleet,equipmentType:r.equipment_type,make:r.make,model:r.model,modelYear:r.model_year,laborHours:r.labor_hours,laborCost:r.labor_cost,partsCost:r.parts_cost,outsideCost:r.sublet_cost,totalCost:r.total_cost,historicalRepairId:r.historical_repair_id}}));
  return {repairs,breakdowns,maintenance,expenses,parts,history};
}
export type Metric='count'|'totalCost'|'averageCost'|'partsCost'|'laborCost'|'outsideCost'|'laborHours'|'completed'|'downtimeHours'|'averageDowntime'|'averageArrival'|'averageClaim'|'averageRepair'|'unknownDowntime'|'quantity'|'repairLinks'|'unitLinks'|'averageMileage'|'averageLaborHours'|'uniqueUnits'|'uniqueROs';
export function metric(rows:readonly AnalysisRow[],key:Metric):number|null{
  if(key==='count')return rows.length;
  if(key==='uniqueUnits')return new Set(rows.map(r=>r.fields.equipmentId).filter(v=>typeof v==='number'&&v>0)).size;
  if(key==='uniqueROs')return new Set(rows.map(r=>r.fields.historicalRepairId).filter(v=>typeof v==='number'&&v>0)).size;
  if(key==='averageCost')return rows.length?sum(rows,r=>Number(r.fields.totalCost)||0)/rows.length:null;
  if(key==='unknownDowntime')return rows.filter(r=>r.fields.downtimeHours==null).length;
  const average:Partial<Record<Metric,string>>={averageDowntime:'downtimeHours',averageArrival:'arrivalHours',averageClaim:'claimHours',averageRepair:'repairHours',averageMileage:'mileage',averageLaborHours:'laborHours'};
  const field=average[key]??key;
  const known=rows.map(r=>r.fields[field]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
  if(average[key])return known.length?sum(known,x=>x)/known.length:null;
  if(key==='downtimeHours'&&!known.length)return null;
  return sum(known,x=>x);
}
export function groups(rows:readonly AnalysisRow[],dimension:string,second=''){
  const map=new Map<string,{label:string;rows:AnalysisRow[]}>();
  for(const row of rows){const values=[dimension==='__all'?'All selected':String(row.fields[dimension]??'').trim()||'Not recorded'];if(second&&second!==dimension)values.push(String(row.fields[second]??'').trim()||'Not recorded');const key=JSON.stringify(values);const g=map.get(key)??{label:values.join(' / '),rows:[]};g.rows.push(row);map.set(key,g);}
  return [...map.entries()].map(([key,g])=>({key,...g}));
}
export function csvCell(value:unknown){
  let text=String(value??'');
  if(typeof value==='string'&&/^[\s]*[=+\-@\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
