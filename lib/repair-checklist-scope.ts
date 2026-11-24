import type {RepairType} from './repair-types';

export type ChecklistMode='none'|'optional'|'required';
export type SubcategoryChecklistMode=ChecklistMode|'inherit';
export type ChecklistTemplate={id:number;name:string;version:number;subcategoryId:number|null};
export type ChecklistScope={mode:ChecklistMode;template:ChecklistTemplate|null;waitingForSubcategory:boolean;subcategoryId:number|null;subcategoryName:string|null;source:'parent'|'subcategory'|'started';started:boolean};
type TemplateRow={id:number;name:string;version:number;repair_subcategory_id:number|null};
const templateValue=(r:TemplateRow):ChecklistTemplate=>({id:Number(r.id),name:r.name,version:Number(r.version),subcategoryId:r.repair_subcategory_id===null?null:Number(r.repair_subcategory_id)});
export async function findActiveChecklistTemplate(db:D1Database,repairTypeId:number,subcategoryId:number|null=null):Promise<ChecklistTemplate|null>{
 const row=await db.prepare(`SELECT id,name,version,repair_subcategory_id FROM repair_type_checklist_templates
 WHERE repair_type_id=? AND repair_subcategory_id IS ? AND active=1 ORDER BY version DESC LIMIT 1`).bind(repairTypeId,subcategoryId).first<TemplateRow>();
 return row?templateValue(row):null;
}
export async function resolveRepairChecklist(db:D1Database,repairId:number,type:RepairType):Promise<ChecklistScope>{
 const row=await db.prepare(`SELECT r.repair_subcategory_id,sc.name AS subcategory_name,sc.checklist_mode,
 EXISTS(SELECT 1 FROM repair_type_subcategories s WHERE s.repair_type_id=r.repair_type_id AND s.active=1) AS has_options,
 t.id AS run_template_id,t.name AS run_template_name,t.version AS run_template_version,t.repair_subcategory_id AS run_template_subcategory_id
 FROM repairs r LEFT JOIN repair_type_subcategories sc ON sc.id=r.repair_subcategory_id AND sc.repair_type_id=r.repair_type_id
 LEFT JOIN repair_type_checklist_runs cr ON cr.repair_id=r.id LEFT JOIN repair_type_checklist_templates t ON t.id=cr.template_id WHERE r.id=?`).bind(repairId).first<{
 repair_subcategory_id:number|null;subcategory_name:string|null;checklist_mode:SubcategoryChecklistMode|null;has_options:number;
 run_template_id:number|null;run_template_name:string|null;run_template_version:number|null;run_template_subcategory_id:number|null}>();
 const subcategoryId=row?.repair_subcategory_id??null,subcategoryName=row?.subcategory_name??null;
 if(row?.run_template_id!=null)return{mode:'required',template:{id:Number(row.run_template_id),name:row.run_template_name||type.name+' Checklist',version:Number(row.run_template_version),subcategoryId:row.run_template_subcategory_id??null},waitingForSubcategory:false,subcategoryId,subcategoryName,source:'started',started:true};
 const waitingForSubcategory=Boolean(row?.has_options&&!subcategoryId);
 const custom=Boolean(subcategoryId&&row?.checklist_mode&&row.checklist_mode!=='inherit');
 const mode=custom?row!.checklist_mode as ChecklistMode:type.checklistMode;
 return{mode,template:waitingForSubcategory||mode==='none'?null:await findActiveChecklistTemplate(db,type.id,custom?subcategoryId:null),waitingForSubcategory,subcategoryId,subcategoryName,source:custom?'subcategory':'parent',started:false};
}
