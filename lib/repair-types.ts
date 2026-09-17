export type UnitRule = 'required' | 'optional';
export type ChecklistMode = 'none' | 'optional' | 'required';

export type RepairTypeDefinition = {
  id:number;
  code:string;
  name:string;
  active:boolean;
  sortOrder:number;
  unitRule:UnitRule;
  checklistMode:ChecklistMode;
  systemKey:string;
  checklistConfigured:boolean;
};

type RepairTypeRow = {
  id:number;
  code:string;
  name:string;
  active:number;
  sort_order:number;
  unit_rule:UnitRule;
  checklist_mode:ChecklistMode;
  system_key:string|null;
  checklist_configured:number;
};

function mapRow(row:RepairTypeRow):RepairTypeDefinition {
  return {
    id:Number(row.id),
    code:row.code,
    name:row.name,
    active:Boolean(row.active),
    sortOrder:Number(row.sort_order),
    unitRule:row.unit_rule,
    checklistMode:row.checklist_mode,
    systemKey:row.system_key ?? '',
    checklistConfigured:Boolean(row.checklist_configured),
  };
}

export async function listRepairTypes(db:D1Database, includeInactive=false) {
  const result = await db.prepare(`
    SELECT rt.id,rt.code,rt.name,rt.active,rt.sort_order,rt.unit_rule,rt.checklist_mode,rt.system_key,
           EXISTS(
             SELECT 1 FROM repair_type_checklist_templates t
             WHERE t.repair_type_id=rt.id AND t.active=1
           ) AS checklist_configured
    FROM repair_types rt
    ${includeInactive ? '' : 'WHERE rt.active=1'}
    ORDER BY rt.sort_order,rt.name COLLATE NOCASE,rt.id
  `).all<RepairTypeRow>();
  return result.results.map(mapRow);
}

export async function getRepairType(db:D1Database, idValue:unknown, includeInactive=false) {
  const id=Number(idValue??0);
  if(!Number.isInteger(id)||id<=0) return null;
  const row=await db.prepare(`
    SELECT rt.id,rt.code,rt.name,rt.active,rt.sort_order,rt.unit_rule,rt.checklist_mode,rt.system_key,
           EXISTS(
             SELECT 1 FROM repair_type_checklist_templates t
             WHERE t.repair_type_id=rt.id AND t.active=1
           ) AS checklist_configured
    FROM repair_types rt
    WHERE rt.id=? ${includeInactive?'':'AND rt.active=1'}
  `).bind(id).first<RepairTypeRow>();
  return row?mapRow(row):null;
}

export async function getRepairTypeBySystemKey(db:D1Database, systemKey:string) {
  const row=await db.prepare(`
    SELECT rt.id,rt.code,rt.name,rt.active,rt.sort_order,rt.unit_rule,rt.checklist_mode,rt.system_key,
           EXISTS(
             SELECT 1 FROM repair_type_checklist_templates t
             WHERE t.repair_type_id=rt.id AND t.active=1
           ) AS checklist_configured
    FROM repair_types rt
    WHERE rt.system_key=? AND rt.active=1
  `).bind(systemKey).first<RepairTypeRow>();
  return row?mapRow(row):null;
}

export async function requireRepairType(db:D1Database, idValue:unknown) {
  const type=await getRepairType(db,idValue,false);
  if(!type) throw new Error('Choose an active repair type.');
  return type;
}

export function repairTypeCode(name:string) {
  const base=name.trim().toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,80);
  return base||'repair-type';
}

export async function uniqueRepairTypeCode(db:D1Database,name:string) {
  const base=repairTypeCode(name);
  for(let suffix=0;suffix<1000;suffix++){
    const code=suffix?`${base}-${suffix+1}`.slice(0,96):base;
    const found=await db.prepare('SELECT id FROM repair_types WHERE code=?').bind(code).first<{id:number}>();
    if(!found)return code;
  }
  throw new Error('A unique repair type code could not be generated.');
}

export function normalizeUnitRule(value:unknown):UnitRule {
  return String(value??'required')==='optional'?'optional':'required';
}

export function normalizeChecklistMode(value:unknown):ChecklistMode {
  const mode=String(value??'none');
  return mode==='required'||mode==='optional'?mode:'none';
}

export function displayRepairType(source:string, repairTypeName:string|null|undefined) {
  if(source==='scheduled-pm')return 'PM';
  if(source==='scheduled-annual')return 'ANNUAL';
  return String(repairTypeName??'').trim()||'UNCLASSIFIED';
}
