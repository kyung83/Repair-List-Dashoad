import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type VendorRow = {
  id:number;
  name:string;
  phone:string|null;
  email:string|null;
  address:string|null;
};

async function requireManager(request:Request):Promise<AppUser>{
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required for Outside Work Intake.');
  return user;
}

function normalizeVendor(value:string){
  let normalized=value
    .toUpperCase()
    .replace(/&/g,' AND ')
    .replace(/[^A-Z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  normalized=normalized
    .replace(/\s+(?:INCORPORATED|INC|LLC|LTD|CORPORATION|CORP|COMPANY|CO)$/,'')
    .replace(/\s+(?:TRUCKS|TRUCK|TRACTORS|TRACTOR)$/,'')
    .trim();
  return normalized;
}

async function activeVendors(){
  const result=await env.DB.prepare(`
    SELECT id,name,phone,email,address
    FROM outside_work_vendors
    WHERE COALESCE(active,1)=1
    ORDER BY name,id
  `).all<VendorRow>();
  return result.results;
}

function errorStatus(message:string){
  if(message==='Authentication required.')return 401;
  if(message.includes('Manager or administrator'))return 403;
  return 400;
}

export async function GET(request:Request){
  try{
    await requireManager(request);
    const vendors=await activeVendors();
    return Response.json({
      vendors:vendors.map(row=>({
        id:Number(row.id),name:row.name,phone:row.phone??'',email:row.email??'',address:row.address??'',
        lookupKey:normalizeVendor(row.name),
      })),
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Outside Work vendors could not be loaded.';
    return Response.json({error:message},{status:errorStatus(message),headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request:Request){
  try{
    await requireManager(request);
    const body=await request.json() as Record<string,unknown>;
    const name=String(body.name??'').replace(/\s+/g,' ').trim().slice(0,180);
    if(name.length<2)throw new Error('Enter the vendor company name.');
    if(name.length>180)throw new Error('Vendor name is too long.');
    if(/[.!?].*[.!?]/.test(name)||name.split(/\s+/).length>12)throw new Error('Vendor name looks like invoice prose. Enter only the company name.');
    const key=normalizeVendor(name);
    if(key.length<2)throw new Error('Enter the vendor company name.');

    const vendors=await activeVendors();
    const matches=vendors.filter(row=>normalizeVendor(row.name)===key);
    if(matches.length===1){
      const existing=matches[0];
      return Response.json({ok:true,created:false,vendor:{id:Number(existing.id),name:existing.name,phone:existing.phone??'',email:existing.email??'',address:existing.address??'',lookupKey:key}},{headers:{'cache-control':'no-store'}});
    }
    if(matches.length>1)throw new Error('More than one existing Outside Work vendor matches this name. Choose the correct existing vendor instead of creating another.');

    const phone=String(body.phone??'').trim().slice(0,80);
    const email=String(body.email??'').trim().slice(0,180);
    const address=String(body.address??'').replace(/\s+/g,' ').trim().slice(0,300);
    const notes='Created from Outside Work invoice intake. May be a one-time over-the-road repair vendor.';
    const inserted=await env.DB.prepare(`
      INSERT INTO outside_work_vendors (name,phone,email,address,notes,active)
      VALUES (?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),?,1)
    `).bind(name,phone,email,address,notes).run();
    const id=Number(inserted.meta.last_row_id??0);
    if(!id)throw new Error('Outside Work vendor could not be created.');
    return Response.json({ok:true,created:true,vendor:{id,name,phone,email,address,lookupKey:key}},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Outside Work vendor could not be saved.';
    return Response.json({error:message},{status:errorStatus(message),headers:{'cache-control':'no-store'}});
  }
}
