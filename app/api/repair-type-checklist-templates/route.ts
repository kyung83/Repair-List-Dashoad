import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getRepairType } from '@/lib/repair-types';

type ItemInput={
  position?:number;section?:string;text?:string;enabled?:boolean;
  allowPass?:boolean;allowFail?:boolean;allowNa?:boolean;
  requireNotes?:boolean;requirePhoto?:boolean;requireMeasurement?:boolean;
  measurementLabel?:string;measurementUnit?:string;
};

async function manager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required to edit checklists.');
  return user;
}

function typeId(value:unknown){const id=Number(value??0);if(!Number.isInteger(id)||id<=0)throw new Error('Repair type was not found.');return id}

async function load(id:number){
  const type=await getRepairType(env.DB,id,true);
  if(!type)throw new Error('Repair type was not found.');
  const template=await env.DB.prepare(`
    SELECT id,name,version,active,created_at
    FROM repair_type_checklist_templates
    WHERE repair_type_id=? AND active=1
    ORDER BY version DESC LIMIT 1
  `).bind(id).first<{id:number;name:string;version:number;active:number;created_at:string}>();
  const items=template?await env.DB.prepare(`
    SELECT position,section,item_text,enabled,allow_pass,allow_fail,allow_na,
           require_notes,require_photo,require_measurement,measurement_label,measurement_unit
    FROM repair_type_checklist_template_items
    WHERE template_id=? ORDER BY position
  `).bind(template.id).all<{
    position:number;section:string;item_text:string;enabled:number;allow_pass:number;allow_fail:number;allow_na:number;
    require_notes:number;require_photo:number;require_measurement:number;measurement_label:string|null;measurement_unit:string|null;
  }>() : {results:[]};
  const versions=await env.DB.prepare(`
    SELECT id,name,version,active,created_at,
           (SELECT COUNT(*) FROM repair_type_checklist_template_items i WHERE i.template_id=t.id AND i.enabled=1) AS item_count
    FROM repair_type_checklist_templates t
    WHERE repair_type_id=? ORDER BY version DESC
  `).bind(id).all<{id:number;name:string;version:number;active:number;created_at:string;item_count:number}>();
  return {
    repairType:type,
    template:template?{
      id:template.id,name:template.name,version:Number(template.version),active:Boolean(template.active),createdAt:template.created_at,
      items:items.results.map(item=>({
        position:Number(item.position),section:item.section,text:item.item_text,enabled:Boolean(item.enabled),
        allowPass:Boolean(item.allow_pass),allowFail:Boolean(item.allow_fail),allowNa:Boolean(item.allow_na),
        requireNotes:Boolean(item.require_notes),requirePhoto:Boolean(item.require_photo),requireMeasurement:Boolean(item.require_measurement),
        measurementLabel:item.measurement_label??'',measurementUnit:item.measurement_unit??'',
      })),
    }:null,
    versions:versions.results.map(row=>({id:row.id,name:row.name,version:Number(row.version),active:Boolean(row.active),createdAt:row.created_at,itemCount:Number(row.item_count??0)})),
  };
}

function normalizeItems(raw:unknown){
  if(!Array.isArray(raw)||!raw.length)throw new Error('Add at least one checklist item.');
  return raw.map((value,index)=>{
    const item=(value??{}) as ItemInput;
    const section=String(item.section??'').trim().slice(0,120);
    const text=String(item.text??'').trim().slice(0,1000);
    if(!section||!text)throw new Error(`Checklist item ${index+1} needs a section and question.`);
    const enabled=item.enabled!==false;
    const allowPass=item.allowPass!==false,allowFail=item.allowFail!==false,allowNa=item.allowNa!==false;
    if(enabled&&!allowPass&&!allowFail&&!allowNa)throw new Error(`Checklist item ${index+1} must allow Pass, Fail, or N/A.`);
    const requireMeasurement=Boolean(item.requireMeasurement);
    const measurementLabel=String(item.measurementLabel??'').trim().slice(0,120);
    if(enabled&&requireMeasurement&&!measurementLabel)throw new Error(`Checklist item ${index+1} needs a measurement label.`);
    return {
      position:index+1,section,text,enabled,allowPass,allowFail,allowNa,
      requireNotes:Boolean(item.requireNotes),requirePhoto:Boolean(item.requirePhoto),requireMeasurement,
      measurementLabel,measurementUnit:String(item.measurementUnit??'').trim().slice(0,40),
    };
  });
}

export async function GET(request:Request){
  try{
    await manager(request);
    const id=typeId(new URL(request.url).searchParams.get('repairTypeId'));
    return Response.json(await load(id),{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Checklist template could not be loaded.'},{status:400})}
}

export async function POST(request:Request){
  try{
    const user=await manager(request);
    const body=await request.json() as Record<string,unknown>;
    if(String(body.action??'publish')!=='publish')throw new Error('Unknown checklist template action.');
    const id=typeId(body.repairTypeId);
    const type=await getRepairType(env.DB,id,true);
    if(!type)throw new Error('Repair type was not found.');
    if(type.checklistMode==='none')throw new Error('Turn checklist support on for this repair type first.');
    const items=normalizeItems(body.items);
    if(!items.some(item=>item.enabled))throw new Error('At least one checklist item must be enabled.');
    const name=String(body.name??`${type.name} Checklist`).trim().slice(0,160)||`${type.name} Checklist`;
    const row=await env.DB.prepare('SELECT COALESCE(MAX(version),0) AS version FROM repair_type_checklist_templates WHERE repair_type_id=?').bind(id).first<{version:number}>();
    const version=Number(row?.version??0)+1;
    const inserted=await env.DB.prepare(`
      INSERT INTO repair_type_checklist_templates(repair_type_id,name,version,active,created_by_user_id)
      VALUES(?,?,?,0,?)
    `).bind(id,name,version,user.id).run();
    const templateId=Number(inserted.meta.last_row_id);
    if(!templateId)throw new Error('Checklist template could not be created.');
    try{
      await env.DB.batch(items.map(item=>env.DB.prepare(`
        INSERT INTO repair_type_checklist_template_items(
          template_id,position,section,item_text,enabled,allow_pass,allow_fail,allow_na,
          require_notes,require_photo,require_measurement,measurement_label,measurement_unit
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(templateId,item.position,item.section,item.text,item.enabled?1:0,item.allowPass?1:0,item.allowFail?1:0,item.allowNa?1:0,item.requireNotes?1:0,item.requirePhoto?1:0,item.requireMeasurement?1:0,item.measurementLabel||null,item.measurementUnit||null)));
      await env.DB.batch([
        env.DB.prepare('UPDATE repair_type_checklist_templates SET active=0 WHERE repair_type_id=? AND id<>?').bind(id,templateId),
        env.DB.prepare('UPDATE repair_type_checklist_templates SET active=1 WHERE id=?').bind(templateId),
      ]);
    }catch(error){
      await env.DB.prepare('DELETE FROM repair_type_checklist_templates WHERE id=?').bind(templateId).run();
      throw error;
    }
    return Response.json({ok:true,...await load(id)},{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'repair_type_checklist_template_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Checklist template could not be saved.'},{status:400});
  }
}
