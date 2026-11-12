import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type CategoryRow={id:number;name:string;active:number;sort_order:number};
const headers={'cache-control':'no-store'};
const cleanName=(value:unknown)=>{
  const name=String(value??'').trim().replace(/\s+/g,' ');
  if(!name||name.length>100)throw new Error('Category name must be between 1 and 100 characters.');
  return name;
};
const positiveId=(value:unknown)=>{
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Choose a valid indirect labor category.');
  return id;
};
const rows=async (includeInactive:boolean)=>{
  const result=await env.DB.prepare(`SELECT id,name,active,sort_order FROM indirect_labor_categories
    ${includeInactive?'':'WHERE active=1'} ORDER BY sort_order,name COLLATE NOCASE,id`).all<CategoryRow>();
  return result.results.map(row=>({id:Number(row.id),name:row.name,active:Boolean(row.active),sortOrder:Number(row.sort_order)}));
};

export async function GET(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!['mechanic','manager','admin'].includes(user.role))return Response.json({error:'Access denied.'},{status:403,headers});
  return Response.json({ok:true,categories:await rows(['manager','admin'].includes(user.role)),
    canManage:['manager','admin'].includes(user.role)},{headers});
}

export async function POST(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!['manager','admin'].includes(user.role))return Response.json({error:'Manager or administrator access is required.'},{status:403,headers});
  try{
    const body=await request.json() as Record<string,unknown>;
    const action=String(body.action??'');
    if(action==='create'){
      const name=cleanName(body.name);
      const prior=await env.DB.prepare('SELECT id FROM indirect_labor_categories WHERE name=? COLLATE NOCASE').bind(name).first();
      if(prior)throw new Error('This category already exists. Re-enable it instead of creating a duplicate.');
      const max=await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS n FROM indirect_labor_categories').first<{n:number}>();
      await env.DB.prepare(`INSERT INTO indirect_labor_categories(name,sort_order) VALUES(?,?)`).bind(name,Number(max?.n??0)+10).run();
    }else if(action==='update'){
      const id=positiveId(body.id),name=cleanName(body.name);
      if(typeof body.active!=='boolean')throw new Error('Choose whether the category is active.');
      const order=Number(body.sortOrder);
      if(!Number.isSafeInteger(order)||order<0||order>100000)throw new Error('Sort order must be between 0 and 100000.');
      const old=await env.DB.prepare('SELECT id FROM indirect_labor_categories WHERE id=?').bind(id).first();
      if(!old)throw new Error('Indirect labor category not found.');
      await env.DB.prepare(`UPDATE indirect_labor_categories
        SET name=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(name,body.active?1:0,order,id).run();
    }else throw new Error('Unknown indirect labor category action.');
    return Response.json({ok:true,categories:await rows(true),canManage:true},{headers});
  }catch(error){
    console.error(JSON.stringify({event:'indirect_labor_category_save_failed',error:String(error)}));
    const message=error instanceof Error?error.message:'Category could not be saved.';
    return Response.json({error:/UNIQUE constraint failed/i.test(message)?'That category name already exists.':message},{status:400,headers});
  }
}
