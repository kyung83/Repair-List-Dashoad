export type RepairType={id:number;name:string;unitRule:'required'|'optional';checklistMode:'none'|'optional'|'required';active:boolean;sortOrder:number};

type TypeRow={id:number;name:string;unit_rule:'required'|'optional';checklist_mode:'none'|'optional'|'required';active:number;sort_order:number};

export async function listRepairTypes(db:D1Database,activeOnly=true):Promise<RepairType[]>{
 const rows=await db.prepare(`SELECT id,name,unit_rule,checklist_mode,active,sort_order FROM repair_types ${activeOnly?'WHERE active=1':''} ORDER BY sort_order,name COLLATE NOCASE`).all<TypeRow>();
 return rows.results.map(row=>({id:Number(row.id),name:row.name,unitRule:row.unit_rule,checklistMode:row.checklist_mode,active:Boolean(row.active),sortOrder:Number(row.sort_order)}));
}

export async function requireRepairType(db:D1Database,value:unknown){
 const id=Number(value);if(!Number.isInteger(id)||id<=0)throw new Error('Choose a repair type.');
 const row=await db.prepare(`SELECT id,name,unit_rule,checklist_mode,active,sort_order FROM repair_types WHERE id=? AND active=1`).bind(id).first<TypeRow>();
 if(!row)throw new Error('That repair type is no longer available.');
 return{id:Number(row.id),name:row.name,unitRule:row.unit_rule,checklistMode:row.checklist_mode,active:Boolean(row.active),sortOrder:Number(row.sort_order)} as RepairType;
}

export async function repairTypeForRepair(db:D1Database,repairId:number){
 const row=await db.prepare(`SELECT rt.id,rt.name,rt.unit_rule,rt.checklist_mode,rt.active,rt.sort_order FROM repairs r LEFT JOIN repair_types rt ON rt.id=r.repair_type_id WHERE r.id=?`).bind(repairId).first<TypeRow>();
 if(!row?.id)return null;
 return{id:Number(row.id),name:row.name,unitRule:row.unit_rule,checklistMode:row.checklist_mode,active:Boolean(row.active),sortOrder:Number(row.sort_order)} as RepairType;
}

export async function activeRepairTypeChecklistTemplate(db:D1Database,repairTypeId:number){
 const row=await db.prepare(`SELECT id,name,version FROM repair_type_checklist_templates WHERE repair_type_id=? AND active=1 ORDER BY version DESC LIMIT 1`).bind(repairTypeId).first<{id:number;name:string;version:number}>();
 return row?{id:Number(row.id),name:row.name,version:Number(row.version)}:null;
}
