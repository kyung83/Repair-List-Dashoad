type ReportingPayload=Record<string,any>;
type HistoryAggregate={equipment_id:number;ros:number;labor:number;parts:number;sublet:number;total:number};
type YearAggregate={year:number;ros:number;total:number};
function money(value:unknown){return Math.round((Number(value)||0)*100)/100;}
function integer(value:unknown){const number=Number(value);return Number.isFinite(number)?Math.trunc(number):0;}
function addMoney(left:unknown,right:unknown){return money((Number(left)||0)+(Number(right)||0));}

export async function mergeHistoricalReportingDataOptimized(db:D1Database,base:ReportingPayload){
  const selectedYear=integer(base?.selectedYear),requestedUnitId=integer(base?.requestedUnitId);
  if(selectedYear<2000||selectedYear>2100)return base;
  const yearText=String(selectedYear);

  const periodPromise=db.prepare(`
    SELECT h.equipment_id,COUNT(*) AS ros,COALESCE(SUM(h.labor_cost),0) AS labor,
           COALESCE(SUM(h.parts_cost),0) AS parts,COALESCE(SUM(h.sublet_cost),0) AS sublet,COALESCE(SUM(h.total_cost),0) AS total
    FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id
    WHERE e.active=1 AND substr(h.ro_date,1,4)=? GROUP BY h.equipment_id
  `).bind(yearText).all<HistoryAggregate>();
  const lifetimePromise=db.prepare(`
    SELECT h.equipment_id,COUNT(*) AS ros,COALESCE(SUM(h.labor_cost),0) AS labor,
           COALESCE(SUM(h.parts_cost),0) AS parts,COALESCE(SUM(h.sublet_cost),0) AS sublet,COALESCE(SUM(h.total_cost),0) AS total
    FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id WHERE e.active=1 GROUP BY h.equipment_id
  `).all<HistoryAggregate>();
  const yearlyPromise=db.prepare(`
    SELECT CAST(substr(h.ro_date,1,4) AS INTEGER) AS year,COUNT(*) AS ros,COALESCE(SUM(h.total_cost),0) AS total
    FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id WHERE e.active=1
    GROUP BY substr(h.ro_date,1,4) ORDER BY year
  `).all<YearAggregate>();
  const historyPromise=requestedUnitId>0
    ?db.prepare(`
      SELECT h.id,h.equipment_id,e.unit,e.category,e.equipment_type,h.ro_number,h.ro_date,h.location,h.source_status,
             h.labor_hours,h.labor_cost,h.parts_cost,h.sublet_cost,h.total_cost
      FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id
      WHERE e.active=1 AND h.equipment_id=? ORDER BY h.ro_date DESC,h.ro_number DESC LIMIT 5000
    `).bind(requestedUnitId).all<any>()
    :db.prepare(`
      SELECT h.id,h.equipment_id,e.unit,e.category,e.equipment_type,h.ro_number,h.ro_date,h.location,h.source_status,
             h.labor_hours,h.labor_cost,h.parts_cost,h.sublet_cost,h.total_cost
      FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id
      WHERE e.active=1 AND substr(h.ro_date,1,4)=? ORDER BY h.ro_date DESC,h.ro_number DESC LIMIT 5000
    `).bind(yearText).all<any>();
  const totalsPromise=db.prepare(`
    SELECT COUNT(*) AS ros,COALESCE(SUM(CASE WHEN h.labor_hours>0 THEN 1 ELSE 0 END),0) AS with_labor
    FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id WHERE e.active=1
  `).first<any>();

  const[periodResult,lifetimeResult,yearlyResult,historyResult,historyTotals]=await Promise.all([periodPromise,lifetimePromise,yearlyPromise,historyPromise,totalsPromise]);
  const periodByUnit=new Map(periodResult.results.map(row=>[Number(row.equipment_id),row]));
  const lifetimeByUnit=new Map(lifetimeResult.results.map(row=>[Number(row.equipment_id),row]));

  for(const unit of base.unitCosts??[]){
    const period=periodByUnit.get(Number(unit.equipmentId)),lifetime=lifetimeByUnit.get(Number(unit.equipmentId));
    if(period){
      unit.repairCountYear=integer(unit.repairCountYear)+integer(period.ros);
      unit.yearLaborCost=addMoney(unit.yearLaborCost,period.labor);unit.yearPartsCost=addMoney(unit.yearPartsCost,period.parts);
      unit.yearOutsideCost=addMoney(unit.yearOutsideCost,period.sublet);unit.yearRepairCost=addMoney(unit.yearRepairCost,period.total);
      unit.yearOperatingCost=addMoney(unit.yearOperatingCost,period.total);unit.yearTotalCost=addMoney(unit.yearTotalCost,period.total);
    }
    if(lifetime){
      unit.lifetimeRepairCount=integer(unit.lifetimeRepairCount)+integer(lifetime.ros);
      unit.lifetimeRepairCost=addMoney(unit.lifetimeRepairCost,lifetime.total);unit.lifetimeOperatingCost=addMoney(unit.lifetimeOperatingCost,lifetime.total);
      unit.lifetimeOwnershipCost=addMoney(unit.lifetimeOwnershipCost,lifetime.total);unit.netLifecycleCost=addMoney(unit.netLifecycleCost,lifetime.total);
      const milesOwned=Number(unit.milesOwned);if(Number.isFinite(milesOwned)&&milesOwned>0)unit.recordedCostPerMile=money((unit.purchasePrice==null?unit.lifetimeOperatingCost:unit.netLifecycleCost)/milesOwned);
    }
  }
  base.unitCosts?.sort((a:any,b:any)=>Number(b.yearOperatingCost)-Number(a.yearOperatingCost)||String(a.unit).localeCompare(String(b.unit),undefined,{numeric:true}));

  const periodRos=periodResult.results.reduce((sum,row)=>sum+integer(row.ros),0),periodLabor=periodResult.results.reduce((sum,row)=>sum+Number(row.labor||0),0);
  const periodParts=periodResult.results.reduce((sum,row)=>sum+Number(row.parts||0),0),periodSublet=periodResult.results.reduce((sum,row)=>sum+Number(row.sublet||0),0);
  const periodTotal=periodResult.results.reduce((sum,row)=>sum+Number(row.total||0),0);
  if(base.summary){
    base.summary.repairsInYear=integer(base.summary.repairsInYear)+periodRos;base.summary.completedRepairsInYear=integer(base.summary.completedRepairsInYear)+periodRos;
    base.summary.laborSpend=addMoney(base.summary.laborSpend,periodLabor);base.summary.partsSpend=addMoney(base.summary.partsSpend,periodParts);
    base.summary.outsideRepairSpend=addMoney(base.summary.outsideRepairSpend,periodSublet);base.summary.repairSpend=addMoney(base.summary.repairSpend,periodTotal);
    base.summary.operatingCost=addMoney(base.summary.operatingCost,periodTotal);base.summary.totalCost=addMoney(base.summary.totalCost,periodTotal);
    base.summary.averageRepairCost=base.summary.repairsInYear?money(base.summary.repairSpend/base.summary.repairsInYear):0;
    base.summary.fleetLifetimeOperatingCost=money((base.unitCosts??[]).reduce((sum:number,unit:any)=>sum+Number(unit.lifetimeOperatingCost||0),0));
    base.summary.fleetLifetimeOwnershipCost=money((base.unitCosts??[]).reduce((sum:number,unit:any)=>sum+Number(unit.lifetimeOwnershipCost||0),0));
  }

  const categoryMap=new Map<string,{category:string;units:number;repairCost:number;expenseCost:number;purchaseCost:number}>();
  for(const unit of base.unitCosts??[]){const category=String(unit.category||'Uncategorized'),entry=categoryMap.get(category)??{category,units:0,repairCost:0,expenseCost:0,purchaseCost:0};entry.units+=1;entry.repairCost+=Number(unit.yearRepairCost||0);entry.expenseCost+=Number(unit.yearExpenseCost||0);entry.purchaseCost+=Number(unit.purchaseCostYear||0);categoryMap.set(category,entry);}
  base.categoryCosts=[...categoryMap.values()].map(entry=>({category:entry.category,units:entry.units,repairCost:money(entry.repairCost),expenseCost:money(entry.expenseCost),purchaseCost:money(entry.purchaseCost),operatingCost:money(entry.repairCost+entry.expenseCost),totalCost:money(entry.repairCost+entry.expenseCost+entry.purchaseCost)})).sort((a,b)=>b.totalCost-a.totalCost);

  const trendMap=new Map<number,any>((base.yearlyTrend??[]).map((row:any)=>[Number(row.year),{...row}]));
  for(const row of yearlyResult.results){const year=integer(row.year);if(!year)continue;const entry=trendMap.get(year)??{year,repairCount:0,repairCost:0,expenseCost:0,purchaseCost:0,operatingCost:0,totalCost:0};entry.repairCount=integer(entry.repairCount)+integer(row.ros);entry.repairCost=addMoney(entry.repairCost,row.total);entry.operatingCost=addMoney(entry.operatingCost,row.total);entry.totalCost=addMoney(entry.totalCost,row.total);trendMap.set(year,entry);}
  base.yearlyTrend=[...trendMap.values()].sort((a,b)=>Number(a.year)-Number(b.year));
  const years=new Set<number>((base.years??[]).map((year:unknown)=>integer(year)).filter(Boolean));for(const row of yearlyResult.results)if(integer(row.year))years.add(integer(row.year));years.add(selectedYear);base.years=[...years].sort((a,b)=>b-a);

  const historicalRows=historyResult.results.map((row:any)=>({
    id:-Number(row.id),equipmentId:Number(row.equipment_id),unit:row.unit,
    category:row.equipment_type==='trailer'?'Trailers':(String(row.category||'').toLowerCase()==='fleet'?'Uncategorized':(row.category||'Uncategorized')),
    title:`Historical RO ${row.ro_number}`,status:row.source_status||'COMPLETED',source:'Historical RO import',openedAt:row.ro_date,completedAt:row.ro_date,
    year:integer(String(row.ro_date||'').slice(0,4))||selectedYear,technician:'Historical import',location:row.location||'',partsCost:money(row.parts_cost),
    laborHours:Number(row.labor_hours||0),laborRate:Number(row.labor_hours||0)>0?money(Number(row.labor_cost||0)/Number(row.labor_hours||1)):0,
    laborCost:money(row.labor_cost),outsideCost:money(row.sublet_cost),totalCost:money(row.total_cost),repairCycleHours:null,
  }));
  const byId=new Map<number,any>();for(const row of[...(base.repairHistory??[]),...historicalRows])byId.set(Number(row.id),row);
  base.repairHistory=[...byId.values()].sort((a:any,b:any)=>String(b.openedAt).localeCompare(String(a.openedAt))||Number(b.id)-Number(a.id));

  if(base.dataQuality){base.dataQuality.totalRepairs=integer(base.dataQuality.totalRepairs)+integer(historyTotals?.ros);base.dataQuality.repairsWithLaborEntry=integer(base.dataQuality.repairsWithLaborEntry)+integer(historyTotals?.with_labor);}
  base.historicalReportingMerged=true;base.historicalRowsInSelectedYear=periodRos;return base;
}
