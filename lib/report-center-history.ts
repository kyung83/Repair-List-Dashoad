type HistoryLine={id:number;historical_repair_id:number;equipment_id:number;unit:string;fleet:string;equipment_type:string;make:string;model:string;model_year:number|null;ro_number:string;ro_date:string;major_category:string;system_code:string;assembly_code:string;vmrs_description:string;labor_hours:number|null;labor_cost:number|null;parts_cost:number|null;sublet_cost:number|null;total_cost:number|null;total_count:number};
export async function getReportCenterHistoryLines(db:D1Database,scope:{startDate:string;endDate:string;equipmentType:string;equipmentId:string;query:string|null}){
 const clauses=['l.ro_date BETWEEN ? AND ?'],binds:unknown[]=[scope.startDate,scope.endDate];
 if(scope.equipmentType){clauses.push("lower(COALESCE(e.equipment_type,''))=?");binds.push(scope.equipmentType);}
 if(scope.equipmentId){clauses.push('l.equipment_id=?');binds.push(Number(scope.equipmentId));}
 const q=String(scope.query??'').trim().slice(0,200).toLowerCase();
 if(q){clauses.push("lower(COALESCE(e.unit,'') || ' ' || COALESCE(l.ro_number,'') || ' ' || COALESCE(l.vmrs_description,'') || ' ' || COALESCE(l.major_category,'') || ' ' || COALESCE(l.system_code,'') || ' ' || COALESCE(l.assembly_code,'')) LIKE ?");binds.push('%'+q+'%');}
 const result=await db.prepare(`SELECT l.id,l.historical_repair_id,l.equipment_id,e.unit,COALESCE(e.category,'') AS fleet,COALESCE(e.equipment_type,'') AS equipment_type,COALESCE(e.make,'') AS make,COALESCE(e.model,'') AS model,e.model_year,l.ro_number,l.ro_date,l.major_category,l.system_code,l.assembly_code,l.vmrs_description,l.labor_hours,l.labor_cost,l.parts_cost,l.sublet_cost,l.total_cost,COUNT(*) OVER() AS total_count FROM historical_repair_lines l JOIN equipment e ON e.id=l.equipment_id WHERE ${clauses.join(' AND ')} ORDER BY l.ro_date DESC,l.id DESC LIMIT 5001`).bind(...binds).all<HistoryLine>();
 return {rows:result.results.slice(0,5000),truncated:result.results.length>5000,totalCount:Number(result.results[0]?.total_count??0)};
}
export type HistoryLineData=Awaited<ReturnType<typeof getReportCenterHistoryLines>>;
