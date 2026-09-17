import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

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

async function activeTemplate(repairTypeId:number){
  const t=await env.DB.prepare(`SELECT id,repair_type_id,name,version,active,created_at FROM repair_type_checklist_templates WHERE repair_type_id=? AND active=1 ORDER BY version DESC LIMIT 1`).bind(repairTypeId).first<TemplateRow>();
  if(!t)return null;
  const rows=await env.DB.prepare(`SELECT position,section,item_text,enabled,allow_pass,allow_fail,allow_na,require_notes,require_photo,require_measurement,measurement_label,measurement_unit FROM repair_type_checklist_template_items WHERE template_id=? ORDER BY position,id`).bind(t.id).all<ItemRow>();
  return{id:Number(t.id),name:t.name,version:Number(t.version),createdAt:t.created_at,items:rows.results.map(row=>({position:Number(row.position),section:row.section,text:row.item_text,enabled:Boolean(row.enabled),allowPass:Boolean(row.allow_pass),allowFail:Boolean(row.allow_fail),allowNa:Boolean(row.allow_na),requireNotes:Boolean(row.require_notes),requirePhoto:Boolean(row.require_photo),requireMeasurement:Boolean(row.require_measurement),measurementLabel:row.measurement_label??'',measurementUnit:row.measurement_unit??''}))};
}

async function payload(user:AppUser){
  const where=manager(user)?'':`WHERE active=1 AND upper(name)<>'INDIRECT LABOR-OTHER'`;
  const rows=await env.DB.prepare(`SELECT id,name,unit_rule,checklist_mode,active,sort_order FROM repair_types ${where} ORDER BY sort_order,name COLLATE NOCASE`).all<RepairTypeRow>();
  const types=await Promise.all(rows.results.map(async row=>({id:Number(row.id),name:row.name,unitRule:row.unit_rule,checklistMode:row.checklist_mode,active:Boolean(row.active),sortOrder:Number(row.sort_order),checklist:await activeTemplate(Number(row.id))})));
  return{types,canManage:manager(user),updatedAt:new Date().toISOString()};
}

export async function GET(request:Request){
  try{const user=await getSessionUser(env.DB,request);if(!user)return Response.json({error:'Authentication required.'},{status:401});return Response.json(await payload(user),{headers:{'cache-control':'no-store'}})}
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
    }else if(action==='publishChecklist'){
      const typeId=id(body.id),items=parseItems(body.items),name=String(body.name??'').trim().slice(0,100)||'Repair Type Checklist';
      const type=await env.DB.prepare(`SELECT id,checklist_mode FROM repair_types WHERE id=?`).bind(typeId).first<{id:number;checklist_mode:string}>();if(!type)throw new Error('Repair type was not found.');
      if(type.checklist_mode==='none')throw new Error('Set this repair type to Optional or Required checklist first.');
      const max=await env.DB.prepare(`SELECT COALESCE(MAX(version),0) AS n FROM repair_type_checklist_templates WHERE repair_type_id=?`).bind(typeId).first<{n:number}>();const version=Number(max?.n??0)+1;
      const inserted=await env.DB.prepare(`INSERT INTO repair_type_checklist_templates(repair_type_id,name,version,active,created_by_user_id) VALUES(?,?,?,0,?)`).bind(typeId,name,version,user.id).run();
      const templateId=Number(inserted.meta.last_row_id);if(!templateId)throw new Error('Checklist version could not be created.');
      const statements=items.map(item=>env.DB.prepare(`INSERT INTO repair_type_checklist_template_items(template_id,position,section,item_text,enabled,allow_pass,allow_fail,allow_na,require_notes,require_photo,require_measurement,measurement_label,measurement_unit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(templateId,item.position,item.section,item.text,item.enabled?1:0,item.allowPass?1:0,item.allowFail?1:0,item.allowNa?1:0,item.requireNotes?1:0,item.requirePhoto?1:0,item.requireMeasurement?1:0,item.measurementLabel||null,item.measurementUnit||null));
      for(let i=0;i<statements.length;i+=60)await env.DB.batch(statements.slice(i,i+60));
      await env.DB.batch([env.DB.prepare(`UPDATE repair_type_checklist_templates SET active=0,updated_at=CURRENT_TIMESTAMP WHERE repair_type_id=? AND active=1`).bind(typeId),env.DB.prepare(`UPDATE repair_type_checklist_templates SET active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(templateId)]);
    }else throw new Error('Unknown repair type action.');
    return Response.json({ok:true,...await payload(user)},{headers:{'cache-control':'no-store'}});
  }catch(error){console.error(JSON.stringify({event:'repair_types_post_failed',error:String(error)}));return Response.json({error:error instanceof Error?error.message:'Repair type change failed.'},{status:400})}
}
