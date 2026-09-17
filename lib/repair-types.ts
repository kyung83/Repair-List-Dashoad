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

export async function validateRepairTypeChecklistBeforeClose(db:D1Database,repairId:number){
 const type=await repairTypeForRepair(db,repairId);if(!type||type.checklistMode==='none')return;
 const template=await activeRepairTypeChecklistTemplate(db,type.id);
 const run=await db.prepare(`SELECT id,status FROM repair_type_checklist_runs WHERE repair_id=?`).bind(repairId).first<{id:number;status:string}>();
 if(type.checklistMode==='optional'&&!run)return;
 if(!template&&!run){if(type.checklistMode==='required')throw new Error(`${type.name} requires a checklist, but no checklist is configured. Ask a manager to open Repair Type Setup.`);return}
 if(!run)throw new Error(`Complete the ${type.name} checklist before marking this work repaired.`);
 const summary=await db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN result='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) AS failed,SUM(CASE WHEN result<>'pending' AND require_notes=1 AND COALESCE(TRIM(notes),'')='' THEN 1 ELSE 0 END) AS missing_notes,SUM(CASE WHEN result<>'pending' AND require_measurement=1 AND COALESCE(TRIM(measurement_value),'')='' THEN 1 ELSE 0 END) AS missing_measurement,SUM(CASE WHEN result<>'pending' AND require_photo=1 AND NOT EXISTS(SELECT 1 FROM repair_type_checklist_photos p WHERE p.checklist_item_id=repair_type_checklist_items.id) THEN 1 ELSE 0 END) AS missing_photo FROM repair_type_checklist_items WHERE checklist_run_id=?`).bind(run.id).first<{total:number;pending:number;failed:number;missing_notes:number;missing_measurement:number;missing_photo:number}>();
 if(Number(summary?.total??0)<=0)throw new Error(`${type.name} checklist has no questions.`);
 if(Number(summary?.pending??0)>0)throw new Error(`Finish every ${type.name} checklist item before marking this work repaired.`);
 if(Number(summary?.failed??0)>0)throw new Error(`Correct all failed ${type.name} checklist items and change them to Pass before closing.`);
 if(Number(summary?.missing_notes??0)>0)throw new Error('Add the required checklist notes before closing.');
 if(Number(summary?.missing_measurement??0)>0)throw new Error('Enter the required checklist measurements before closing.');
 if(Number(summary?.missing_photo??0)>0)throw new Error('Add the required checklist photos before closing.');
}

export async function completeRepairTypeChecklist(db:D1Database,repairId:number){
 await db.prepare(`UPDATE repair_type_checklist_runs SET status='completed',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE repair_id=?`).bind(repairId).run();
}
