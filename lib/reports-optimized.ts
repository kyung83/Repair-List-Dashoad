type EquipmentRow = {
  id:number; unit:string; category:string; equipment_type:string; current_mileage:number|null;
  model_year:number|null; make:string|null; model:string|null; purchase_date:string|null;
  purchase_price:number|null; in_service_date:string|null; acquisition_mileage:number|null;
  expected_residual_value:number|null; retired_date:string|null;
};

type RepairRow = {
  id:number; equipment_id:number|null; unit:string; category:string; equipment_type:string|null;
  title:string; status:string; source:string; opened_at:string; completed_at:string|null;
  technician_name:string; location:string; labor_hours:number; labor_rate:number;
  outside_cost:number; parts_cost:number; part_lines:number; snapshot_part_lines:number; priced_part_lines:number;
};

type RepairAggregateRow = {
  equipment_id:number; repair_count_year:number; lifetime_repair_count:number; open_repairs:number;
  year_parts_cost:number; year_labor_cost:number; year_outside_cost:number; year_repair_cost:number;
  lifetime_repair_cost:number; cycle_total:number; cycle_count:number;
};

type ExpenseAggregateRow = { equipment_id:number; year_expense_cost:number; lifetime_expense_cost:number; entries:number };
type MaintenanceAggregateRow = { equipment_id:number; pm_events:number; annual_events:number };
type ExpenseRow = { id:number; equipment_id:number; unit:string; expense_date:string; category:string; amount:number; vendor:string|null; description:string|null; source:string };
type MaintenanceRow = { id:number; equipment_id:number; unit:string; event_type:string; pm_type:string|null; event_date:string; mileage:number|null; notes:string|null; source:string };
type PartUsageRow = { repair_id:number; equipment_id:number|null; unit:string; opened_at:string; part_number:string; description:string; quantity:number; snapshot_unit_cost:number|null; current_unit_cost:number|null };
type YearRepairRow = { year:number; repair_count:number; repair_cost:number };
type YearExpenseRow = { year:number; expense_cost:number };
type QualityRow = { total_repairs:number; labor_entered:number; open_repairs:number };
type PartQualityRow = { total_part_lines:number; snapshot_part_lines:number; priced_part_lines:number };

function dateYear(value:string|null|undefined){
  const match=String(value??'').match(/^(\d{4})-/);
  return match?Number(match[1]):null;
}
function roundMoney(value:number){return Math.round((value+Number.EPSILON)*100)/100;}
function displayCategory(row:{category:string;equipment_type?:string|null}){
  if(row.equipment_type==='trailer')return'Trailers';
  const value=String(row.category??'').trim();
  return value&&value.toLowerCase()!=='fleet'?value:'Uncategorized';
}
function isComplete(status:string){return status.toLowerCase().includes('complete');}
function cycleHours(openedAt:string,completedAt:string|null){
  if(!completedAt)return null;
  const opened=Date.parse(openedAt),completed=Date.parse(completedAt);
  if(!Number.isFinite(opened)||!Number.isFinite(completed)||completed<opened)return null;
  return(completed-opened)/3_600_000;
}
function selectedYearValue(value:unknown){
  const current=new Date().getUTCFullYear(),year=Number(value);
  return Number.isInteger(year)&&year>=2000&&year<=2100?year:current;
}
function selectedUnitValue(value:unknown){
  const id=Number(value);
  return Number.isInteger(id)&&id>0?id:null;
}

function repairView(row:RepairRow){
  const partsCost=Number(row.parts_cost??0),laborHours=Number(row.labor_hours??0),laborRate=Number(row.labor_rate??0);
  const laborCost=laborHours*laborRate,outsideCost=Number(row.outside_cost??0);
  return{
    id:row.id,equipmentId:row.equipment_id,unit:row.unit,category:displayCategory(row),equipmentType:row.equipment_type??'other',
    title:row.title,status:row.status,source:row.source,openedAt:row.opened_at,completedAt:row.completed_at??'',year:dateYear(row.opened_at),
    technician:row.technician_name||'Unassigned',location:row.location,partsCost:roundMoney(partsCost),laborHours,
    laborRate:roundMoney(laborRate),laborCost:roundMoney(laborCost),outsideCost:roundMoney(outsideCost),
    totalCost:roundMoney(partsCost+laborCost+outsideCost),repairCycleHours:cycleHours(row.opened_at,row.completed_at),
    partLines:Number(row.part_lines??0),snapshotPartLines:Number(row.snapshot_part_lines??0),pricedPartLines:Number(row.priced_part_lines??0),
  };
}

export async function getReportingDataOptimized(db:D1Database,requestedYear?:unknown,requestedUnit?:unknown){
  const selectedYear=selectedYearValue(requestedYear),yearText=String(selectedYear),requestedUnitId=selectedUnitValue(requestedUnit);
  const detailUnitClause=requestedUnitId?' OR r.equipment_id = ?':'';
  const expenseUnitClause=requestedUnitId?' OR x.equipment_id = ?':'';
  const maintenanceUnitClause=requestedUnitId?' OR m.equipment_id = ?':'';

  const equipmentPromise=db.prepare(`
    SELECT id,unit,category,equipment_type,current_mileage,model_year,make,model,
           purchase_date,purchase_price,in_service_date,acquisition_mileage,expected_residual_value,retired_date
    FROM equipment WHERE active=1 ORDER BY unit
  `).all<EquipmentRow>();

  const repairAggregatePromise=db.prepare(`
    WITH repair_costs AS (
      SELECT r.id,r.equipment_id,COALESCE(r.status,'') AS status,r.opened_at,r.completed_at,
             COALESCE(r.labor_hours,0) AS labor_hours,COALESCE(r.labor_rate,0) AS labor_rate,
             COALESCE(r.outside_cost,0) AS outside_cost,
             COALESCE((SELECT SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)) FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=r.id),0) AS parts_cost
      FROM repairs r WHERE r.equipment_id IS NOT NULL
    )
    SELECT equipment_id,
           SUM(CASE WHEN substr(opened_at,1,4)=? THEN 1 ELSE 0 END) AS repair_count_year,
           COUNT(*) AS lifetime_repair_count,
           SUM(CASE WHEN lower(status) NOT LIKE '%complete%' THEN 1 ELSE 0 END) AS open_repairs,
           COALESCE(SUM(CASE WHEN substr(opened_at,1,4)=? THEN parts_cost ELSE 0 END),0) AS year_parts_cost,
           COALESCE(SUM(CASE WHEN substr(opened_at,1,4)=? THEN labor_hours*labor_rate ELSE 0 END),0) AS year_labor_cost,
           COALESCE(SUM(CASE WHEN substr(opened_at,1,4)=? THEN outside_cost ELSE 0 END),0) AS year_outside_cost,
           COALESCE(SUM(CASE WHEN substr(opened_at,1,4)=? THEN parts_cost+labor_hours*labor_rate+outside_cost ELSE 0 END),0) AS year_repair_cost,
           COALESCE(SUM(parts_cost+labor_hours*labor_rate+outside_cost),0) AS lifetime_repair_cost,
           COALESCE(SUM(CASE WHEN completed_at IS NOT NULL AND julianday(completed_at)>=julianday(opened_at) THEN (julianday(completed_at)-julianday(opened_at))*24 ELSE 0 END),0) AS cycle_total,
           SUM(CASE WHEN completed_at IS NOT NULL AND julianday(completed_at)>=julianday(opened_at) THEN 1 ELSE 0 END) AS cycle_count
    FROM repair_costs GROUP BY equipment_id
  `).bind(yearText,yearText,yearText,yearText,yearText).all<RepairAggregateRow>();

  const expenseAggregatePromise=db.prepare(`
    SELECT equipment_id,
           COALESCE(SUM(CASE WHEN substr(expense_date,1,4)=? THEN amount ELSE 0 END),0) AS year_expense_cost,
           COALESCE(SUM(amount),0) AS lifetime_expense_cost,COUNT(*) AS entries
    FROM unit_expenses GROUP BY equipment_id
  `).bind(yearText).all<ExpenseAggregateRow>();

  const maintenanceAggregatePromise=db.prepare(`
    SELECT equipment_id,
           SUM(CASE WHEN event_type='pm' THEN 1 ELSE 0 END) AS pm_events,
           SUM(CASE WHEN event_type='annual' THEN 1 ELSE 0 END) AS annual_events
    FROM maintenance_events GROUP BY equipment_id
  `).all<MaintenanceAggregateRow>();

  const repairDetailSql=`
    SELECT r.id,r.equipment_id,COALESCE(e.unit,'') AS unit,COALESCE(e.category,'') AS category,e.equipment_type,
           r.title,r.status,r.source,r.opened_at,r.completed_at,COALESCE(t.name,r.driver,'') AS technician_name,
           COALESCE(r.location,'') AS location,COALESCE(r.labor_hours,0) AS labor_hours,COALESCE(r.labor_rate,0) AS labor_rate,
           COALESCE(r.outside_cost,0) AS outside_cost,
           COALESCE(SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)),0) AS parts_cost,
           COUNT(rp.id) AS part_lines,
           COALESCE(SUM(CASE WHEN rp.id IS NOT NULL AND rp.unit_cost IS NOT NULL THEN 1 ELSE 0 END),0) AS snapshot_part_lines,
           COALESCE(SUM(CASE WHEN rp.id IS NOT NULL AND (rp.unit_cost IS NOT NULL OR p.unit_cost IS NOT NULL) THEN 1 ELSE 0 END),0) AS priced_part_lines
    FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id LEFT JOIN technicians t ON t.id=r.technician_id
    LEFT JOIN repair_parts rp ON rp.repair_id=r.id LEFT JOIN parts p ON p.id=rp.part_id
    WHERE (substr(r.opened_at,1,4)=?${detailUnitClause})
    GROUP BY r.id,r.equipment_id,e.unit,e.category,e.equipment_type,r.title,r.status,r.source,r.opened_at,r.completed_at,
             t.name,r.driver,r.location,r.labor_hours,r.labor_rate,r.outside_cost
    ORDER BY r.opened_at DESC,r.id DESC
  `;
  const repairDetailPrepared=db.prepare(repairDetailSql);
  const repairDetailPromise=(requestedUnitId?repairDetailPrepared.bind(yearText,requestedUnitId):repairDetailPrepared.bind(yearText)).all<RepairRow>();

  const expenseDetailSql=`
    SELECT x.id,x.equipment_id,e.unit,x.expense_date,x.category,x.amount,x.vendor,x.description,x.source
    FROM unit_expenses x JOIN equipment e ON e.id=x.equipment_id
    WHERE (substr(x.expense_date,1,4)=?${expenseUnitClause})
    ORDER BY x.expense_date DESC,x.id DESC
  `;
  const expenseDetailPrepared=db.prepare(expenseDetailSql);
  const expenseDetailPromise=(requestedUnitId?expenseDetailPrepared.bind(yearText,requestedUnitId):expenseDetailPrepared.bind(yearText)).all<ExpenseRow>();

  const maintenanceDetailSql=`
    SELECT m.id,m.equipment_id,e.unit,m.event_type,m.pm_type,m.event_date,m.mileage,m.notes,m.source
    FROM maintenance_events m JOIN equipment e ON e.id=m.equipment_id
    WHERE (substr(m.event_date,1,4)=?${maintenanceUnitClause})
    ORDER BY m.event_date DESC,m.id DESC
  `;
  const maintenanceDetailPrepared=db.prepare(maintenanceDetailSql);
  const maintenanceDetailPromise=(requestedUnitId?maintenanceDetailPrepared.bind(yearText,requestedUnitId):maintenanceDetailPrepared.bind(yearText)).all<MaintenanceRow>();

  const partUsagePromise=db.prepare(`
    SELECT rp.repair_id,r.equipment_id,COALESCE(e.unit,'') AS unit,r.opened_at,p.part_number,p.description,rp.quantity,
           rp.unit_cost AS snapshot_unit_cost,p.unit_cost AS current_unit_cost
    FROM repair_parts rp JOIN repairs r ON r.id=rp.repair_id LEFT JOIN equipment e ON e.id=r.equipment_id JOIN parts p ON p.id=rp.part_id
    WHERE substr(r.opened_at,1,4)=?
    ORDER BY r.opened_at DESC,rp.id DESC
  `).bind(yearText).all<PartUsageRow>();

  const yearlyRepairPromise=db.prepare(`
    WITH repair_costs AS (
      SELECT r.id,r.opened_at,COALESCE(r.labor_hours,0) AS labor_hours,COALESCE(r.labor_rate,0) AS labor_rate,
             COALESCE(r.outside_cost,0) AS outside_cost,
             COALESCE((SELECT SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)) FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=r.id),0) AS parts_cost
      FROM repairs r
    )
    SELECT CAST(substr(opened_at,1,4) AS INTEGER) AS year,COUNT(*) AS repair_count,
           COALESCE(SUM(parts_cost+labor_hours*labor_rate+outside_cost),0) AS repair_cost
    FROM repair_costs WHERE length(substr(opened_at,1,4))=4 GROUP BY substr(opened_at,1,4) ORDER BY year
  `).all<YearRepairRow>();

  const yearlyExpensePromise=db.prepare(`
    SELECT CAST(substr(expense_date,1,4) AS INTEGER) AS year,COALESCE(SUM(amount),0) AS expense_cost
    FROM unit_expenses WHERE length(substr(expense_date,1,4))=4 GROUP BY substr(expense_date,1,4) ORDER BY year
  `).all<YearExpenseRow>();

  const qualityPromise=db.prepare(`
    SELECT COUNT(*) AS total_repairs,
           SUM(CASE WHEN COALESCE(labor_hours,0)>0 OR COALESCE(labor_rate,0)>0 THEN 1 ELSE 0 END) AS labor_entered,
           SUM(CASE WHEN lower(COALESCE(status,'')) NOT LIKE '%complete%' THEN 1 ELSE 0 END) AS open_repairs
    FROM repairs
  `).first<QualityRow>();

  const partQualityPromise=db.prepare(`
    SELECT COUNT(rp.id) AS total_part_lines,
           COALESCE(SUM(CASE WHEN rp.unit_cost IS NOT NULL THEN 1 ELSE 0 END),0) AS snapshot_part_lines,
           COALESCE(SUM(CASE WHEN rp.unit_cost IS NOT NULL OR p.unit_cost IS NOT NULL THEN 1 ELSE 0 END),0) AS priced_part_lines
    FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id
  `).first<PartQualityRow>();

  const yearsPromise=db.prepare(`
    SELECT year FROM (
      SELECT substr(opened_at,1,4) AS year FROM repairs
      UNION SELECT substr(expense_date,1,4) FROM unit_expenses
      UNION SELECT substr(purchase_date,1,4) FROM equipment WHERE active=1 AND purchase_date IS NOT NULL
      UNION SELECT substr(event_date,1,4) FROM maintenance_events
    ) WHERE length(year)=4 ORDER BY year
  `).all<{year:string}>();

  const [equipmentResult,repairAggregateResult,expenseAggregateResult,maintenanceAggregateResult,repairDetailResult,
    expenseDetailResult,maintenanceDetailResult,partUsageResult,yearlyRepairResult,yearlyExpenseResult,quality,partQuality,yearsResult]=await Promise.all([
      equipmentPromise,repairAggregatePromise,expenseAggregatePromise,maintenanceAggregatePromise,repairDetailPromise,
      expenseDetailPromise,maintenanceDetailPromise,partUsagePromise,yearlyRepairPromise,yearlyExpensePromise,qualityPromise,partQualityPromise,yearsPromise,
    ]);

  const repairAgg=new Map(repairAggregateResult.results.map(row=>[Number(row.equipment_id),row]));
  const expenseAgg=new Map(expenseAggregateResult.results.map(row=>[Number(row.equipment_id),row]));
  const maintenanceAgg=new Map(maintenanceAggregateResult.results.map(row=>[Number(row.equipment_id),row]));
  const repairs=repairDetailResult.results.map(repairView);
  const expenses=expenseDetailResult.results.map(row=>({
    id:row.id,equipmentId:row.equipment_id,unit:row.unit,expenseDate:row.expense_date,year:dateYear(row.expense_date),category:row.category,
    amount:roundMoney(Number(row.amount??0)),vendor:row.vendor??'',description:row.description??'',source:row.source,
  }));
  const maintenanceHistory=maintenanceDetailResult.results.map(row=>({
    id:row.id,equipmentId:row.equipment_id,unit:row.unit,eventType:row.event_type,pmType:row.pm_type??'',eventDate:row.event_date,
    year:dateYear(row.event_date),mileage:row.mileage==null?null:Number(row.mileage),notes:row.notes??'',source:row.source,
  }));

  const unitCosts=equipmentResult.results.map(row=>{
    const r=repairAgg.get(row.id),x=expenseAgg.get(row.id),m=maintenanceAgg.get(row.id);
    const yearPartsCost=Number(r?.year_parts_cost??0),yearLaborCost=Number(r?.year_labor_cost??0),yearOutsideCost=Number(r?.year_outside_cost??0);
    const yearRepairCost=Number(r?.year_repair_cost??0),yearExpenseCost=Number(x?.year_expense_cost??0);
    const lifetimeRepairCost=Number(r?.lifetime_repair_cost??0),lifetimeExpenseCost=Number(x?.lifetime_expense_cost??0);
    const purchasePrice=row.purchase_price==null?null:Number(row.purchase_price),residualValue=row.expected_residual_value==null?null:Number(row.expected_residual_value);
    const purchaseCostYear=dateYear(row.purchase_date)===selectedYear?(purchasePrice??0):0;
    const lifetimeOperatingCost=lifetimeRepairCost+lifetimeExpenseCost,lifetimeOwnershipCost=(purchasePrice??0)+lifetimeOperatingCost;
    const netLifecycleCost=Math.max(0,lifetimeOwnershipCost-(residualValue??0));
    const acquisitionMileage=row.acquisition_mileage==null?null:Number(row.acquisition_mileage),currentMileage=row.current_mileage==null?null:Number(row.current_mileage);
    const milesOwned=currentMileage!=null&&acquisitionMileage!=null&&currentMileage>acquisitionMileage?currentMileage-acquisitionMileage:null;
    const costBasisForMile=purchasePrice==null?lifetimeOperatingCost:netLifecycleCost;
    const cycleCount=Number(r?.cycle_count??0),cycleTotal=Number(r?.cycle_total??0);
    return{
      equipmentId:row.id,unit:row.unit,category:displayCategory(row),equipmentType:row.equipment_type,modelYear:row.model_year,make:row.make??'',model:row.model??'',
      currentMileage,purchaseDate:row.purchase_date??'',purchasePrice:purchasePrice==null?null:roundMoney(purchasePrice),inServiceDate:row.in_service_date??'',
      acquisitionMileage,expectedResidualValue:residualValue==null?null:roundMoney(residualValue),retiredDate:row.retired_date??'',
      repairCountYear:Number(r?.repair_count_year??0),lifetimeRepairCount:Number(r?.lifetime_repair_count??0),openRepairs:Number(r?.open_repairs??0),
      yearPartsCost:roundMoney(yearPartsCost),yearLaborCost:roundMoney(yearLaborCost),yearOutsideCost:roundMoney(yearOutsideCost),
      yearRepairCost:roundMoney(yearRepairCost),yearExpenseCost:roundMoney(yearExpenseCost),purchaseCostYear:roundMoney(purchaseCostYear),
      yearOperatingCost:roundMoney(yearRepairCost+yearExpenseCost),yearTotalCost:roundMoney(yearRepairCost+yearExpenseCost+purchaseCostYear),
      lifetimeRepairCost:roundMoney(lifetimeRepairCost),lifetimeExpenseCost:roundMoney(lifetimeExpenseCost),lifetimeOperatingCost:roundMoney(lifetimeOperatingCost),
      lifetimeOwnershipCost:roundMoney(lifetimeOwnershipCost),netLifecycleCost:roundMoney(netLifecycleCost),milesOwned,
      recordedCostPerMile:milesOwned?roundMoney(costBasisForMile/milesOwned):null,
      averageRepairCycleHours:cycleCount?Math.round((cycleTotal/cycleCount)*10)/10:null,pmEvents:Number(m?.pm_events??0),annualEvents:Number(m?.annual_events??0),
      ownershipDataComplete:purchasePrice!=null,
    };
  });
  unitCosts.sort((a,b)=>b.yearOperatingCost-a.yearOperatingCost||a.unit.localeCompare(b.unit,undefined,{numeric:true}));

  const categoryMap=new Map<string,{category:string;units:number;repairCost:number;expenseCost:number;purchaseCost:number}>();
  for(const unit of unitCosts){
    const entry=categoryMap.get(unit.category)??{category:unit.category,units:0,repairCost:0,expenseCost:0,purchaseCost:0};
    entry.units+=1;entry.repairCost+=unit.yearRepairCost;entry.expenseCost+=unit.yearExpenseCost;entry.purchaseCost+=unit.purchaseCostYear;categoryMap.set(unit.category,entry);
  }
  const categoryCosts=[...categoryMap.values()].map(entry=>({...entry,repairCost:roundMoney(entry.repairCost),expenseCost:roundMoney(entry.expenseCost),purchaseCost:roundMoney(entry.purchaseCost),operatingCost:roundMoney(entry.repairCost+entry.expenseCost),totalCost:roundMoney(entry.repairCost+entry.expenseCost+entry.purchaseCost)})).sort((a,b)=>b.totalCost-a.totalCost);

  const years=new Set<number>([new Date().getUTCFullYear(),selectedYear]);
  for(const row of yearsResult.results){const value=Number(row.year);if(Number.isInteger(value)&&value>=1900&&value<=2100)years.add(value);}
  const trendMap=new Map<number,{year:number;repairCount:number;repairCost:number;expenseCost:number;purchaseCost:number}>();
  for(const year of years)trendMap.set(year,{year,repairCount:0,repairCost:0,expenseCost:0,purchaseCost:0});
  for(const row of yearlyRepairResult.results){if(!Number(row.year))continue;const entry=trendMap.get(Number(row.year))??{year:Number(row.year),repairCount:0,repairCost:0,expenseCost:0,purchaseCost:0};entry.repairCount=Number(row.repair_count??0);entry.repairCost=Number(row.repair_cost??0);trendMap.set(entry.year,entry);}
  for(const row of yearlyExpenseResult.results){if(!Number(row.year))continue;const entry=trendMap.get(Number(row.year))??{year:Number(row.year),repairCount:0,repairCost:0,expenseCost:0,purchaseCost:0};entry.expenseCost=Number(row.expense_cost??0);trendMap.set(entry.year,entry);}
  for(const row of equipmentResult.results){const y=dateYear(row.purchase_date);if(!y||row.purchase_price==null)continue;const entry=trendMap.get(y)??{year:y,repairCount:0,repairCost:0,expenseCost:0,purchaseCost:0};entry.purchaseCost+=Number(row.purchase_price);trendMap.set(y,entry);}
  const yearlyTrend=[...trendMap.values()].sort((a,b)=>a.year-b.year).map(entry=>({year:entry.year,repairCount:entry.repairCount,repairCost:roundMoney(entry.repairCost),expenseCost:roundMoney(entry.expenseCost),purchaseCost:roundMoney(entry.purchaseCost),operatingCost:roundMoney(entry.repairCost+entry.expenseCost),totalCost:roundMoney(entry.repairCost+entry.expenseCost+entry.purchaseCost)}));

  const partMap=new Map<string,{partNumber:string;description:string;quantity:number;cost:number;repairs:Set<number>;units:Set<string>}>();
  for(const row of partUsageResult.results){
    const key=row.part_number.toLowerCase(),entry=partMap.get(key)??{partNumber:row.part_number,description:row.description,quantity:0,cost:0,repairs:new Set<number>(),units:new Set<string>()};
    const unitCost=row.snapshot_unit_cost==null?Number(row.current_unit_cost??0):Number(row.snapshot_unit_cost);
    entry.quantity+=Number(row.quantity??0);entry.cost+=Number(row.quantity??0)*unitCost;entry.repairs.add(row.repair_id);if(row.unit)entry.units.add(row.unit);partMap.set(key,entry);
  }
  const partsUsage=[...partMap.values()].map(entry=>({partNumber:entry.partNumber,description:entry.description,quantity:Math.round(entry.quantity*100)/100,repairCount:entry.repairs.size,unitCount:entry.units.size,units:[...entry.units].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),cost:roundMoney(entry.cost)})).sort((a,b)=>b.cost-a.cost||b.quantity-a.quantity);

  const yearRepairs=repairs.filter(row=>row.year===selectedYear),yearExpenses=expenses.filter(row=>row.year===selectedYear);
  const issueMap=new Map<string,{issue:string;repairs:number;cost:number;units:Set<string>}>();
  const technicianMap=new Map<string,{technician:string;repairs:number;completed:number;cost:number;cycleTotal:number;cycleCount:number}>();
  for(const repair of yearRepairs){
    const issueKey=repair.title.trim().toLowerCase(),issueEntry=issueMap.get(issueKey)??{issue:repair.title.trim()||'Unspecified repair',repairs:0,cost:0,units:new Set<string>()};
    issueEntry.repairs+=1;issueEntry.cost+=repair.totalCost;if(repair.unit)issueEntry.units.add(repair.unit);issueMap.set(issueKey,issueEntry);
    const name=repair.technician||'Unassigned',tech=technicianMap.get(name)??{technician:name,repairs:0,completed:0,cost:0,cycleTotal:0,cycleCount:0};
    tech.repairs+=1;if(isComplete(repair.status))tech.completed+=1;tech.cost+=repair.totalCost;if(repair.repairCycleHours!=null){tech.cycleTotal+=repair.repairCycleHours;tech.cycleCount+=1;}technicianMap.set(name,tech);
  }
  const issueAnalysis=[...issueMap.values()].map(entry=>({issue:entry.issue,repairCount:entry.repairs,unitCount:entry.units.size,totalCost:roundMoney(entry.cost),averageCost:entry.repairs?roundMoney(entry.cost/entry.repairs):0})).sort((a,b)=>b.totalCost-a.totalCost||b.repairCount-a.repairCount);
  const technicianAnalysis=[...technicianMap.values()].map(entry=>({technician:entry.technician,repairCount:entry.repairs,completedCount:entry.completed,totalCost:roundMoney(entry.cost),averageRepairCycleHours:entry.cycleCount?Math.round((entry.cycleTotal/entry.cycleCount)*10)/10:null})).sort((a,b)=>b.repairCount-a.repairCount||b.totalCost-a.totalCost);

  const completedCycles=yearRepairs.map(row=>row.repairCycleHours).filter((value):value is number=>value!=null);
  const repairSpend=yearRepairs.reduce((sum,row)=>sum+row.totalCost,0),expenseSpend=yearExpenses.reduce((sum,row)=>sum+row.amount,0);
  const purchaseSpend=unitCosts.reduce((sum,row)=>sum+row.purchaseCostYear,0);
  const totalExpenseEntries=expenseAggregateResult.results.reduce((sum,row)=>sum+Number(row.entries??0),0);

  return{
    years:[...years].sort((a,b)=>b-a),selectedYear,requestedUnitId,
    summary:{
      activeUnits:unitCosts.length,repairsInYear:yearRepairs.length,completedRepairsInYear:yearRepairs.filter(row=>isComplete(row.status)).length,
      openRepairs:Number(quality?.open_repairs??0),partsSpend:roundMoney(yearRepairs.reduce((sum,row)=>sum+row.partsCost,0)),
      laborSpend:roundMoney(yearRepairs.reduce((sum,row)=>sum+row.laborCost,0)),outsideRepairSpend:roundMoney(yearRepairs.reduce((sum,row)=>sum+row.outsideCost,0)),
      repairSpend:roundMoney(repairSpend),ownershipExpenseSpend:roundMoney(expenseSpend),purchaseSpend:roundMoney(purchaseSpend),
      operatingCost:roundMoney(repairSpend+expenseSpend),totalCost:roundMoney(repairSpend+expenseSpend+purchaseSpend),
      averageRepairCost:yearRepairs.length?roundMoney(repairSpend/yearRepairs.length):0,
      averageRepairCycleHours:completedCycles.length?Math.round((completedCycles.reduce((sum,value)=>sum+value,0)/completedCycles.length)*10)/10:null,
      fleetLifetimeOperatingCost:roundMoney(unitCosts.reduce((sum,row)=>sum+row.lifetimeOperatingCost,0)),
      fleetLifetimeOwnershipCost:roundMoney(unitCosts.reduce((sum,row)=>sum+row.lifetimeOwnershipCost,0)),
    },
    unitCosts,categoryCosts,yearlyTrend,repairHistory:repairs,partsUsage,issueAnalysis,technicianAnalysis,maintenanceHistory,expenses,
    expenseCategories:['Fuel','Insurance','Registration','Lease','Tires','Towing','Road service','Licensing','Taxes','Warranty','Body work','Outside maintenance','Other'],
    dataQuality:{
      totalUnits:unitCosts.length,unitsWithPurchasePrice:unitCosts.filter(row=>row.purchasePrice!=null).length,totalRepairs:Number(quality?.total_repairs??0),
      repairsWithLaborEntry:Number(quality?.labor_entered??0),totalPartLines:Number(partQuality?.total_part_lines??0),pricedPartLines:Number(partQuality?.priced_part_lines??0),
      snapshotPartLines:Number(partQuality?.snapshot_part_lines??0),ownershipExpenseEntries:totalExpenseEntries,
    },
    updatedAt:new Date().toISOString(),
  };
}
