import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  listRepairTypes,
  normalizeChecklistMode,
  normalizeUnitRule,
  uniqueRepairTypeCode,
} from '@/lib/repair-types';

async function requireUser(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  return user;
}

function canManage(user:{role:string}){return user.role==='manager'||user.role==='admin'}

export async function GET(request:Request){
  try{
    const user=await requireUser(request);
    const all=new URL(request.url).searchParams.get('all')==='1'&&canManage(user);
    return Response.json({types:await listRepairTypes(env.DB,all)},{headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Repair types could not be loaded.'},{status:400});
  }
}

export async function POST(request:Request){
  try{
    const user=await requireUser(request);
    if(!canManage(user))throw new Error('Manager or administrator access is required to change repair types.');
    const body=await request.json() as Record<string,unknown>;
    const action=String(body.action??'');

    if(action==='create'){
      const name=String(body.name??'').trim().slice(0,120);
      if(!name)throw new Error('Enter a repair type name.');
      const duplicate=await env.DB.prepare('SELECT id FROM repair_types WHERE lower(trim(name))=lower(trim(?))').bind(name).first<{id:number}>();
      if(duplicate)throw new Error('That repair type already exists.');
      const code=await uniqueRepairTypeCode(env.DB,name);
      const unitRule=normalizeUnitRule(body.unitRule);
      const checklistMode=normalizeChecklistMode(body.checklistMode);
      const max=await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS value FROM repair_types').first<{value:number}>();
      const sortOrder=Math.max(10,Number(max?.value??0)+10);
      await env.DB.prepare(`
        INSERT INTO repair_types(code,name,active,sort_order,unit_rule,checklist_mode,updated_at)
        VALUES(?,?,1,?,?,?,CURRENT_TIMESTAMP)
      `).bind(code,name,sortOrder,unitRule,checklistMode).run();
      return Response.json({ok:true,types:await listRepairTypes(env.DB,true)},{headers:{'cache-control':'no-store'}});
    }

    if(action==='update'){
      const id=Number(body.id??0);
      if(!Number.isInteger(id)||id<=0)throw new Error('Repair type was not found.');
      const current=await env.DB.prepare(`SELECT id,system_key FROM repair_types WHERE id=?`).bind(id).first<{id:number;system_key:string|null}>();
      if(!current)throw new Error('Repair type was not found.');
      const name=String(body.name??'').trim().slice(0,120);
      if(!name)throw new Error('Enter a repair type name.');
      const duplicate=await env.DB.prepare('SELECT id FROM repair_types WHERE lower(trim(name))=lower(trim(?)) AND id<>?').bind(name,id).first<{id:number}>();
      if(duplicate)throw new Error('Another repair type already uses that name.');
      let unitRule=normalizeUnitRule(body.unitRule);
      let checklistMode=normalizeChecklistMode(body.checklistMode);
      if(current.system_key==='new-equipment-check'){
        unitRule='required';
        checklistMode='required';
      }else if(current.system_key==='indirect-labor'){
        unitRule='optional';
        checklistMode='none';
      }
      const active=body.active===false||body.active===0||body.active==='0'?0:1;
      const sortOrder=Number(body.sortOrder??100);
      if(!Number.isFinite(sortOrder))throw new Error('Sort order must be a number.');
      await env.DB.prepare(`
        UPDATE repair_types
        SET name=?,active=?,sort_order=?,unit_rule=?,checklist_mode=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(name,active,Math.round(sortOrder),unitRule,checklistMode,id).run();
      return Response.json({ok:true,types:await listRepairTypes(env.DB,true)},{headers:{'cache-control':'no-store'}});
    }

    return Response.json({error:'Unknown repair type action.'},{status:400});
  }catch(error){
    console.error(JSON.stringify({event:'repair_type_setup_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair type change failed.'},{status:400});
  }
}
