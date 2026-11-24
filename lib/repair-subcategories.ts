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
 if(value===null||value==='')return null;
 const id=Number(value);
 if(!Number.isSafeInteger(id)||id<=0)throw new Error('Choose a valid subcategory or leave it blank.');
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
