export type RepairTypeReportInput={startDate:string|null;endDate:string|null;repairType:string|null;equipmentId:string|null;technician:string|null;query:string|null};

type Row={
  id:number;repair_type:string;equipment_id:number|null;unit:string;repair_date:string;repair:string;status:string;source:string;technician:string;
  labor_hours:number;labor_cost:number;parts_cost:number;outside_cost:number;total_cost:number;
};
type SummaryRow={repair_type:string;repairs:number;units:number;labor_hours:number;labor_cost:number;parts_cost:number;outside_cost:number;total_cost:number};

function ymd(value:string|null,fallback:string){const text=String(value??'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:fallback}
function typeSql(alias='r'){return `CASE WHEN ${alias}.source='scheduled-pm' THEN 'PM' WHEN ${alias}.source='scheduled-annual' THEN 'ANNUAL' WHEN ${alias}.source='roadside-breakdown' THEN 'BREAKDOWN' ELSE COALESCE(NULLIF(trim(rt.name),''),'UNCLASSIFIED') END`}

export async function getRepairTypeReportData(db:D1Database,input:RepairTypeReportInput){
  const today=new Date().toISOString().slice(0,10),year=today.slice(0,4);
  const startDate=ymd(input.startDate,`${year}-01-01`),endDate=ymd(input.endDate,today);
  if(startDate>endDate)throw new Error('Start date must be on or before end date.');
  const where:string[]=[`date(COALESCE(r.completed_at,r.opened_at)) BETWEEN date(?) AND date(?)`];
  const params:unknown[]=[startDate,endDate];
  const repairType=String(input.repairType??'').trim();
  if(repairType){where.push(`${typeSql()} = ?`);params.push(repairType)}
  const equipmentId=Number(input.equipmentId??0);if(Number.isInteger(equipmentId)&&equipmentId>0){where.push('r.equipment_id=?');params.push(equipmentId)}
  const technician=String(input.technician??'').trim();if(technician){where.push(`COALESCE(t.name,'Unassigned')=?`);params.push(technician)}
  const query=String(input.query??'').trim().toLowerCase();if(query){where.push(`lower(COALESCE(e.unit,'')||' '||COALESCE(r.title,'')||' '||COALESCE(t.name,'')||' '||${typeSql()}||' '||COALESCE(r.source,'')) LIKE ?`);params.push(`%${query}%`)}
  const clause=where.join(' AND ');
  const base=`
    WITH part_cost AS (
      SELECT rp.repair_id,SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)) AS parts_cost
      FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id GROUP BY rp.repair_id
    ), labor AS (
      SELECT repair_id,SUM(hours) AS hours,SUM(hours*rate) AS cost
      FROM repair_labor_entries GROUP BY repair_id
    )
    SELECT r.id,${typeSql()} AS repair_type,r.equipment_id,COALESCE(e.unit,'') AS unit,
           substr(COALESCE(r.completed_at,r.opened_at),1,10) AS repair_date,COALESCE(r.title,'') AS repair,
           COALESCE(r.status,'') AS status,COALESCE(r.source,'') AS source,COALESCE(t.name,'Unassigned') AS technician,
           COALESCE(l.hours,r.labor_hours,0) AS labor_hours,
           CASE WHEN l.repair_id IS NOT NULL THEN COALESCE(l.cost,0) ELSE COALESCE(r.labor_hours,0)*COALESCE(r.labor_rate,0) END AS labor_cost,
           COALESCE(pc.parts_cost,0) AS parts_cost,COALESCE(r.outside_cost,0) AS outside_cost,
           COALESCE(pc.parts_cost,0)+CASE WHEN l.repair_id IS NOT NULL THEN COALESCE(l.cost,0) ELSE COALESCE(r.labor_hours,0)*COALESCE(r.labor_rate,0) END+COALESCE(r.outside_cost,0) AS total_cost
    FROM repairs r
    LEFT JOIN repair_types rt ON rt.id=r.repair_type_id
    LEFT JOIN equipment e ON e.id=r.equipment_id
    LEFT JOIN technicians t ON t.id=r.technician_id
    LEFT JOIN part_cost pc ON pc.repair_id=r.id
    LEFT JOIN labor l ON l.repair_id=r.id
    WHERE ${clause}
  `;
  const detail=await db.prepare(`${base} ORDER BY repair_date DESC,id DESC LIMIT 5001`).bind(...params).all<Row>();
  const truncated=detail.results.length>5000;
  const rows=detail.results.slice(0,5000).map(row=>({
    id:Number(row.id),repairType:row.repair_type,equipmentId:row.equipment_id==null?null:Number(row.equipment_id),unit:row.unit,date:row.repair_date,repair:row.repair,status:row.status,source:row.source,technician:row.technician,
    laborHours:Number(row.labor_hours??0),laborCost:Number(row.labor_cost??0),partsCost:Number(row.parts_cost??0),outsideCost:Number(row.outside_cost??0),totalCost:Number(row.total_cost??0),
  }));
  const summaries=await db.prepare(`SELECT repair_type,COUNT(*) AS repairs,COUNT(DISTINCT equipment_id) AS units,SUM(labor_hours) AS labor_hours,SUM(labor_cost) AS labor_cost,SUM(parts_cost) AS parts_cost,SUM(outside_cost) AS outside_cost,SUM(total_cost) AS total_cost FROM (${base}) GROUP BY repair_type ORDER BY total_cost DESC,repairs DESC,repair_type`).bind(...params).all<SummaryRow>();
  const total=await db.prepare(`SELECT COUNT(*) AS repairs,COUNT(DISTINCT equipment_id) AS units,SUM(labor_hours) AS labor_hours,SUM(labor_cost) AS labor_cost,SUM(parts_cost) AS parts_cost,SUM(outside_cost) AS outside_cost,SUM(total_cost) AS total_cost FROM (${base})`).bind(...params).first<{repairs:number;units:number;labor_hours:number;labor_cost:number;parts_cost:number;outside_cost:number;total_cost:number}>();
  const [types,units,techs]=await Promise.all([
    db.prepare(`SELECT value FROM (SELECT name AS value FROM repair_types WHERE active=1 UNION SELECT 'PM' UNION SELECT 'ANNUAL' UNION SELECT 'BREAKDOWN' UNION SELECT 'UNCLASSIFIED') ORDER BY value COLLATE NOCASE`).all<{value:string}>(),
    db.prepare(`SELECT id,unit FROM equipment WHERE active=1 ORDER BY unit COLLATE NOCASE`).all<{id:number;unit:string}>(),
    db.prepare(`SELECT DISTINCT COALESCE(t.name,'Unassigned') AS value FROM repairs r LEFT JOIN technicians t ON t.id=r.technician_id ORDER BY value COLLATE NOCASE`).all<{value:string}>(),
  ]);
  return {
    range:{startDate,endDate},filters:{repairType,equipmentId:equipmentId>0?equipmentId:null,technician,query},
    summary:{repairs:Number(total?.repairs??0),units:Number(total?.units??0),laborHours:Number(total?.labor_hours??0),laborCost:Number(total?.labor_cost??0),partsCost:Number(total?.parts_cost??0),outsideCost:Number(total?.outside_cost??0),totalCost:Number(total?.total_cost??0)},
    byType:summaries.results.map(row=>({repairType:row.repair_type,repairs:Number(row.repairs??0),units:Number(row.units??0),laborHours:Number(row.labor_hours??0),laborCost:Number(row.labor_cost??0),partsCost:Number(row.parts_cost??0),outsideCost:Number(row.outside_cost??0),totalCost:Number(row.total_cost??0)})),
    rows,truncated,options:{repairTypes:types.results.map(row=>row.value),units:units.results.map(row=>({id:Number(row.id),unit:row.unit})),technicians:techs.results.map(row=>row.value)},updatedAt:new Date().toISOString(),
  };
}
