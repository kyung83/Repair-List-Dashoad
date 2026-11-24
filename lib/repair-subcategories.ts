export type RepairSubcategory={id:number;repairTypeId:number;name:string;active:boolean;sortOrder:number};
type Row={id:number;repair_type_id:number;name:string;active:number;sort_order:number};
const columns='id,repair_type_id,name,active,sort_order';
const mapped=(r:Row):RepairSubcategory=>({id:Number(r.id),repairTypeId:Number(r.repair_type_id),name:r.name,active:Boolean(r.active),sortOrder:Number(r.sort_order)});
export async function listRepairSubcategories(db:D1Database,activeOnly=true){
 const rows=await db.prepare(`SELECT ${columns} FROM repair_type_subcategories ${activeOnly?'WHERE active=1':''} ORDER BY repair_type_id,sort_order,name COLLATE NOCASE,id`).all<Row>();
 return rows.results.map(mapped);
}
export async function repairSubcategoryForRepair(db:D1Database,repairId:number){
 const row=await db.prepare(`SELECT s.id,s.repair_type_id,s.name,s.active,s.sort_order FROM repairs r JOIN repair_type_subcategories s ON s.id=r.repair_subcategory_id AND s.repair_type_id=r.repair_type_id WHERE r.id=?`).bind(repairId).first<Row>();
 return row?mapped(row):null;
}
export async function requireRepairSubcategory(db:D1Database,repairTypeId:number,value:unknown){
 if(value===null||value===''){
  const required=await db.prepare('SELECT 1 AS required FROM repair_type_subcategories WHERE repair_type_id=? AND active=1 LIMIT 1').bind(repairTypeId).first<{required:number}>();
  if(required)throw new Error('Choose a subcategory for this Repair Type.');
  return null;
 }
 const id=Number(value);
 if(!Number.isSafeInteger(id)||id<=0)throw new Error('Choose a valid subcategory.');
 const row=await db.prepare(`SELECT ${columns} FROM repair_type_subcategories WHERE id=? AND repair_type_id=? AND active=1`).bind(id,repairTypeId).first<Row>();
 if(!row)throw new Error('That subcategory is not available for the selected Repair Type.');
 return mapped(row);
}
export function subcategoryName(value:unknown){
 const name=String(value??'').trim().replace(/\s+/g,' ');
 if(!name||name.length>100)throw new Error('Subcategory name must be between 1 and 100 characters.');
 return name;
}
export function subcategoryOrder(value:unknown){
 const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>100000)throw new Error('Subcategory order must be a whole number from 0 to 100000.');
 return n;
}

/** Validate the configured requirement at the point a technician leaves work.
 * Previously selected, subsequently retired choices remain valid for that repair.
 * Existing completed repairs and maintenance/indirect-labor workflows are not changed.
 */
export async function requireConfiguredSubcategoryBeforeLeavingWork(db:D1Database,repairId:number){
 const missing=await db.prepare(`SELECT rt.name AS name FROM repairs r
 JOIN repair_types rt ON rt.id=r.repair_type_id
 WHERE r.id=? AND r.equipment_id IS NOT NULL
 AND upper(rt.name)<>'INDIRECT LABOR-OTHER'
 AND NOT EXISTS(SELECT 1 FROM maintenance_checklist_runs m WHERE m.repair_id=r.id AND m.event_type IN ('pm','annual'))
 AND EXISTS(SELECT 1 FROM repair_type_subcategories s WHERE s.repair_type_id=rt.id AND s.active=1)
 AND NOT EXISTS(SELECT 1 FROM repair_type_subcategories selected WHERE selected.id=r.repair_subcategory_id AND selected.repair_type_id=rt.id)
 LIMIT 1`).bind(repairId).first<{name:string}>();
 if(missing)throw new Error('Choose the required subcategory for '+missing.name+' before leaving this work.');
}
