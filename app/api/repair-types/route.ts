import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import {listRepairSubcategories,subcategoryName,subcategoryOrder} from '@/lib/repair-subcategories';

type RepairTypeRow={id:number;name:string;unit_rule:'required'|'optional';checklist_mode:'none'|'optional'|'required';active:number;sort_order:number};
type TemplateRow={id:number;repair_type_id:number;name:string;version:number;active:number;created_at:string};
type ItemRow={position:number;section:string;item_text:string;enabled:number;allow_pass:number;allow_fail:number;allow_na:number;require_notes:number;require_photo:number;require_measurement:number;measurement_label:string|null;measurement_unit:string|null};

function manager(user:AppUser){return user.role==='manager'||user.role==='admin'}
function cleanName(value:unknown){const v=String(value??'').trim().replace(/\s+/g,' ');if(!v)throw new Error('Repair type name is required.');if(v.length>100)throw new Error('Repair type name must be 100 characters or fewer.');return v}
function unitRule(value:unknown){if(value==='required'||value==='optional')return value;throw new Error('Unit rule must be Required or Optional.')}
function checklistMode(value:unknown){if(value==='none'||value==='optional'||value==='required')return value;throw new Error('Checklist mode is invalid.')}
function id(value:unknown,label='Repair type'){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error(`${label} was not found.`);return n}
function flag(value:unknown,fallback=true){return typeof value==='boolean'?value:fallback}

function parseItems(value:unknown){
  if(!Array.isArray(value)||!value.length)throw new Error('Add at least one checklist item.');
  if(value.length>300)throw new Error('A checklist can contain at most 300 items.');
  const items=value.map((raw,index)=>{
    const row=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;
    const section=String(row.section??'').trim().slice(0,120);
    const text=String(row.text??'').trim().slice(0,500);
    if(!section||!text)throw new Error(`Checklist item ${index+1} needs a section and question.`);
    const enabled=flag(row.enabled,true),allowPass=flag(row.allowPass,true),allowFail=flag(row.allowFail,true),allowNa=flag(row.allowNa,true);
    if(enabled&&!allowPass&&!allowFail&&!allowNa)throw new Error(`Checklist item ${index+1} must allow Pass, Fail, or N/A.`);
    const requireMeasurement=flag(row.requireMeasurement,false),measurementLabel=String(row.measurementLabel??'').trim().slice(0,80),measurementUnit=String(row.measurementUnit??'').trim().slice(0,30);
    if(enabled&&requireMeasurement&&!measurementLabel)throw new Error(`Checklist item ${index+1} needs a measurement label.`);
    return{position:index+1,section,text,enabled,allowPass,allowFail,allowNa,requireNotes:flag(row.requireNotes,false),requirePhoto:flag(row.requirePhoto,false),requireMeasurement,measurementLabel,measurementUnit};
  });
  if(!items.some(item=>item.enabled))throw new Error('At least one checklist item must be enabled.');
  return items;
}

async function activeTemplate(repairTypeId:number,subcategoryId:number|null=null){
  const t=await env.DB.prepare(`SELECT id,repair_type_id,name,version,active,created_at FROM repair_type_checklist_templates WHERE repair_type_id=? AND repair_subcategory_id IS ? AND active=1 ORDER BY version DESC LIMIT 1`).bind(repairTypeId,subcategoryId).first<TemplateRow>();
  if(!t)return null;
  const rows=await env.DB.prepare(`SELECT position,section,item_text,enabled,allow_pass,allow_fail,allow_na,require_notes,require_photo,require_measurement,measurement_label,measurement_unit FROM repair_type_checklist_template_items WHERE template_id=? ORDER BY position,id`).bind(t.id).all<ItemRow>();
  return{id:Number(t.id),name:t.name,version:Number(t.version),createdAt:t.created_at,items:rows.results.map(row=>({position:Number(row.position),section:row.section,text:row.item_text,enabled:Boolean(row.enabled),allowPass:Boolean(row.allow_pass),allowFail:Boolean(row.allow_fail),allowNa:Boolean(row.allow_na),requireNotes:Boolean(row.require_notes),requirePhoto:Boolean(row.require_photo),requireMeasurement:Boolean(row.require_measurement),measurementLabel:row.measurement_label??'',measurementUnit:row.measurement_unit??''}))};
}

async function subcategoryChecklist(id:number){
 const row=await env.DB.prepare(`SELECT s.id,s.name,s.repair_type_id,s.checklist_mode,rt.name AS parent_name,rt.checklist_mode AS parent_mode
 FROM repair_type_subcategories s JOIN repair_types rt ON rt.id=s.repair_type_id WHERE s.id=?`).bind(id).first<{id:number;name:string;repair_type_id:number;checklist_mode:string;parent_name:string;parent_mode:string}>();
 if(!row||row.parent_name.toUpperCase()==='INDIRECT LABOR-OTHER')throw new Error('Fleet repair subcategory was not found.');
 return{subcategory:{id:row.id,name:row.name,repairTypeId:row.repair_type_id,checklistMode:row.checklist_mode,parentName:row.parent_name,parentMode:row.parent_mode},checklist:await activeTemplate(row.repair_type_id,row.id),parentChecklist:await activeTemplate(row.repair_type_id)};
}
function childChecklistMode(value:unknown){if(value==='inherit'||value==='none'||value==='optional'||value==='required')return value;throw new Error('Subcategory checklist setting is invalid.')}

async function payload(user:AppUser){
  const where=manager(user)?'':`WHERE active=1 AND upper(name)<>'INDIRECT LABOR-OTHER'`;
  const rows=await env.DB.prepare(`SELECT id,name,unit_rule,checklist_mode,active,sort_order FROM repair_types ${where} ORDER BY sort_order,name COLLATE NOCASE`).all<RepairTypeRow>();
  const types=await Promise.all(rows.results.map(async row=>({id:Number(row.id),name:row.name,unitRule:row.unit_rule,checklistMode:row.checklist_mode,active:Boolean(row.active),sortOrder:Number(row.sort_order),checklist:await activeTemplate(Number(row.id))})));
  const subcategories=(await listRepairSubcategories(env.DB,!manager(user))).filter(s=>types.some(t=>t.id===s.repairTypeId&&t.name.toUpperCase()!=='INDIRECT LABOR-OTHER'));
  return{types,subcategories,canManage:manager(user),updatedAt:new Date().toISOString()};
}

export async function GET(request:Request){
  try{const user=await getSessionUser(env.DB,request);if(!user)return Response.json({error:'Authentication required.'},{status:401});const sub=new URL(request.url).searchParams.get('subcategoryId');if(sub!==null){if(!manager(user))return Response.json({error:'Manager or administrator access is required.'},{status:403});return Response.json(await subcategoryChecklist(id(sub,'Subcategory')),{headers:{'cache-control':'no-store'}})}return Response.json(await payload(user),{headers:{'cache-control':'no-store'}})}
  catch(error){return Response.json({error:error instanceof Error?error.message:'Repair types could not be loaded.'},{status:500})}
}

export async function POST(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);if(!user)return Response.json({error:'Authentication required.'},{status:401});if(!manager(user))return Response.json({error:'Manager or administrator access is required.'},{status:403});
    const body=await request.json() as Record<string,unknown>,action=String(body.action??'');
    if(action==='create'){
      const name=cleanName(body.name),rule=unitRule(body.unitRule),mode=checklistMode(body.checklistMode);
      const max=await env.DB.prepare(`SELECT COALESCE(MAX(sort_order),0) AS n FROM repair_types`).first<{n:number}>();
      await env.DB.prepare(`INSERT INTO repair_types(name,unit_rule,checklist_mode,active,sort_order,updated_at) VALUES(?,?,?,1,?,CURRENT_TIMESTAMP)`).bind(name,rule,mode,Number(max?.n??0)+1).run();
    }else if(action==='update'){
      const typeId=id(body.id),name=cleanName(body.name),rule=unitRule(body.unitRule),mode=checklistMode(body.checklistMode),active=Boolean(body.active);
      const sortOrder=Number.isFinite(Number(body.sortOrder))?Math.max(0,Math.floor(Number(body.sortOrder))):0;
      await env.DB.prepare(`UPDATE repair_types SET name=?,unit_rule=?,checklist_mode=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(name,rule,mode,active?1:0,sortOrder,typeId).run();
    }else if(action==='createSubcategory'||action==='updateSubcategory'){
      const parentId=id(body.repairTypeId),name=subcategoryName(body.name);
      const parent=await env.DB.prepare('SELECT id,name FROM repair_types WHERE id=?').bind(parentId).first<{id:number;name:string}>();
      if(!parent||parent.name.toUpperCase()==='INDIRECT LABOR-OTHER')throw new Error('Choose a fleet Repair Type. Indirect labor has its own category setup.');
      if(action==='createSubcategory'){
        const next=await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM repair_type_subcategories WHERE repair_type_id=?').bind(parentId).first<{n:number}>();
        await env.DB.prepare('INSERT INTO repair_type_subcategories(repair_type_id,name,active,sort_order) VALUES(?,?,1,?)').bind(parentId,name,Number(next?.n??1)).run();
      }else{
        const subId=id(body.id,'Subcategory'),order=subcategoryOrder(body.sortOrder);
        if(typeof body.active!=='boolean')throw new Error('Choose whether this subcategory is active.');
        const updated=await env.DB.prepare('UPDATE repair_type_subcategories SET name=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND repair_type_id=?').bind(name,body.active?1:0,order,subId,parentId).run();
        if(!updated.meta.changes)throw new Error('Subcategory was not found under this Repair Type.');
      }
    }else if(action==='saveSubcategoryChecklistMode'){
      const subId=id(body.subcategoryId,'Subcategory'),mode=childChecklistMode(body.checklistMode),config=await subcategoryChecklist(subId);
      if((mode==='optional'||mode==='required')&&!config.checklist)throw new Error('Publish a checklist with at least one enabled question before selecting its own checklist.');
      await env.DB.prepare('UPDATE repair_type_subcategories SET checklist_mode=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(mode,subId).run();
      return Response.json({ok:true,...await subcategoryChecklist(subId)},{headers:{'cache-control':'no-store'}});
    }else if(action==='publishChecklist'){
      const typeId=id(body.id),items=parseItems(body.items),name=String(body.name??'').trim().slice(0,100)||'Repair Type Checklist';
      const subId=body.subcategoryId==null?null:id(body.subcategoryId,'Subcategory');
      const type=await env.DB.prepare(`SELECT id,checklist_mode FROM repair_types WHERE id=?`).bind(typeId).first<{id:number;checklist_mode:string}>();if(!type)throw new Error('Repair type was not found.');
      const mode=subId!==null?childChecklistMode(body.checklistMode):type.checklist_mode;
      if(subId!==null){const config=await subcategoryChecklist(subId);if(config.subcategory.repairTypeId!==typeId)throw new Error('Subcategory does not belong to this Repair Type.');}
      if(mode!=='optional'&&mode!=='required')throw new Error('Set this checklist to Optional or Required first.');
      const max=await env.DB.prepare(`SELECT COALESCE(MAX(version),0) AS n FROM repair_type_checklist_templates WHERE repair_type_id=?`).bind(typeId).first<{n:number}>();const version=Number(max?.n??0)+1;
      const inserted=await env.DB.prepare(`INSERT INTO repair_type_checklist_templates(repair_type_id,name,version,active,created_by_user_id,repair_subcategory_id) VALUES(?,?,?,0,?,?)`).bind(typeId,name,version,user.id,subId).run();
      const templateId=Number(inserted.meta.last_row_id);if(!templateId)throw new Error('Checklist version could not be created.');
      const statements=items.map(item=>env.DB.prepare(`INSERT INTO repair_type_checklist_template_items(template_id,position,section,item_text,enabled,allow_pass,allow_fail,allow_na,require_notes,require_photo,require_measurement,measurement_label,measurement_unit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(templateId,item.position,item.section,item.text,item.enabled?1:0,item.allowPass?1:0,item.allowFail?1:0,item.allowNa?1:0,item.requireNotes?1:0,item.requirePhoto?1:0,item.requireMeasurement?1:0,item.measurementLabel||null,item.measurementUnit||null));
      for(let i=0;i<statements.length;i+=60)await env.DB.batch(statements.slice(i,i+60));
      await env.DB.batch([env.DB.prepare(`UPDATE repair_type_checklist_templates SET active=0,updated_at=CURRENT_TIMESTAMP WHERE repair_type_id=? AND repair_subcategory_id IS ? AND active=1`).bind(typeId,subId),env.DB.prepare(`UPDATE repair_type_checklist_templates SET active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(templateId),...(subId!==null?[env.DB.prepare('UPDATE repair_type_subcategories SET checklist_mode=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(mode,subId)]:[])]);
      if(subId!==null)return Response.json({ok:true,...await subcategoryChecklist(subId)},{headers:{'cache-control':'no-store'}});
    }else throw new Error('Unknown repair type action.');
    return Response.json({ok:true,...await payload(user)},{headers:{'cache-control':'no-store'}});
  }catch(error){console.error(JSON.stringify({event:'repair_types_post_failed',error:String(error)}));return Response.json({error:error instanceof Error?error.message:'Repair type change failed.'},{status:400})}
}
