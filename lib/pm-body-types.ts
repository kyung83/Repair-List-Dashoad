export type PMEquipmentType='truck'|'trailer';
export const TRAILER_BODY_TYPES=['Flat Bed','Step Deck','Conestoga','Conestoga Step Deck','Dry Van'] as const;
export type EquipmentBodyFields={equipment_type?:string|null;trailer_type?:string|null;trailer_subtype?:string|null;truck_body_type?:string|null};
export type PMBodyAssignment={equipmentType:PMEquipmentType;bodyType:string;templateKey:string};
export function cleanTruckBodyType(value:unknown){
 if(typeof value!=='string'&&value!=null)throw new Error('Enter a valid truck body type.');
 const name=String(value??'').trim().replace(/\s+/g,' ');
 if(name.length>100)throw new Error('Truck body type must be 100 characters or fewer.');
 return name;
}
export function equipmentBodyType(e:EquipmentBodyFields){
 const type=String(e.equipment_type??'').trim().toLowerCase();
 if(type==='truck')return String(e.truck_body_type??'').trim().replace(/\s+/g,' ');
 if(type!=='trailer')return '';
 const base=String(e.trailer_type??'').trim(),sub=String(e.trailer_subtype??'').trim();
 return base.toLowerCase()==='conestoga'&&sub.toLowerCase()==='step deck'?'Conestoga Step Deck':base;
}
export async function listPMBodyAssignments(db:D1Database):Promise<PMBodyAssignment[]>{
 const rows=await db.prepare('SELECT equipment_type,body_type,template_key FROM pm_body_checklist_assignments ORDER BY equipment_type,body_type COLLATE NOCASE').all<{equipment_type:PMEquipmentType;body_type:string;template_key:string}>();
 return rows.results.map(r=>({equipmentType:r.equipment_type,bodyType:r.body_type,templateKey:r.template_key}));
}
export async function listPMBodyTypes(db:D1Database){
 const [trucks,assignments]=await Promise.all([
  db.prepare(`SELECT DISTINCT trim(truck_body_type) AS name FROM equipment WHERE lower(equipment_type)='truck' AND trim(truck_body_type)<>'' ORDER BY name COLLATE NOCASE`).all<{name:string}>(),
  listPMBodyAssignments(db)
 ]);
 const unique=(values:readonly string[])=>[...new Map(values.filter(Boolean).map(v=>[v.toLowerCase(),v])).values()].sort((a,b)=>a.localeCompare(b));
 return{truck:unique([...trucks.results.map(r=>r.name),...assignments.filter(a=>a.equipmentType==='truck').map(a=>a.bodyType)]),trailer:unique([...TRAILER_BODY_TYPES,...assignments.filter(a=>a.equipmentType==='trailer').map(a=>a.bodyType)])};
}
export async function requirePMBodyType(db:D1Database,type:PMEquipmentType,value:unknown){
 const raw=cleanTruckBodyType(value);
 if(!raw)throw new Error('Choose a body type first.');
 const options=await listPMBodyTypes(db);
 const name=options[type].find(x=>x.toLowerCase()===raw.toLowerCase());
 if(!name)throw new Error('This body type is not configured in Equipment Master.');
 return name;
}
export async function bodyPMTemplateKey(db:D1Database,equipment:EquipmentBodyFields){
 const type=String(equipment.equipment_type??'').toLowerCase();
 if(type!=='truck'&&type!=='trailer')return null;
 const bodyType=equipmentBodyType(equipment);
 if(!bodyType)return null;
 const row=await db.prepare('SELECT body_type,template_key FROM pm_body_checklist_assignments WHERE equipment_type=? AND body_type=? COLLATE NOCASE').bind(type,bodyType).first<{body_type:string;template_key:string}>();
 return row?{bodyType:row.body_type,templateKey:row.template_key}:null;
}
export async function assignBodyPMTemplate(db:D1Database,type:PMEquipmentType,value:unknown,templateKey:string,userId:number){
 const bodyType=await requirePMBodyType(db,type,value);
 const template=await db.prepare("SELECT id FROM maintenance_checklist_templates WHERE event_type='pm' AND template_key=? AND active=1 LIMIT 1").bind(templateKey).first();
 if(!template)throw new Error('Choose an active PM checklist template.');
 await db.prepare(`INSERT INTO pm_body_checklist_assignments(equipment_type,body_type,template_key,updated_by_user_id) VALUES(?,?,?,?)
 ON CONFLICT(equipment_type,body_type) DO UPDATE SET template_key=excluded.template_key,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP`).bind(type,bodyType,templateKey,userId).run();
}
export async function clearBodyPMTemplate(db:D1Database,type:PMEquipmentType,value:unknown){
 const bodyType=await requirePMBodyType(db,type,value);
 await db.prepare('DELETE FROM pm_body_checklist_assignments WHERE equipment_type=? AND body_type=? COLLATE NOCASE').bind(type,bodyType).run();
}
