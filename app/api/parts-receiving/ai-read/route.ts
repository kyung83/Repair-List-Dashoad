import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  PARTS_RECEIVING_MAX_IMAGES,
  PARTS_RECEIVING_MAX_TOTAL_IMAGE_BYTES,
  readPartsReceivingInvoice,
} from '@/lib/parts-receiving-ai';

type AiBinding={run:(model:string,input:unknown,options?:unknown)=>Promise<unknown>};

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required for Parts Receiving.');
  return user;
}

export async function POST(request:Request){
  try{
    await requireManager(request);
    const body=await request.formData();
    const images=body.getAll('image').filter((entry):entry is File=>entry instanceof File&&entry.size>0);
    if(!images.length)return Response.json({error:'Invoice image is required.'},{status:400});
    if(images.length>PARTS_RECEIVING_MAX_IMAGES)return Response.json({error:`Parts receiving supports up to ${PARTS_RECEIVING_MAX_IMAGES} invoice pages at a time.`},{status:400});
    if(images.reduce((sum,file)=>sum+file.size,0)>PARTS_RECEIVING_MAX_TOTAL_IMAGE_BYTES)return Response.json({error:'Invoice pages are too large for the automatic reader.'},{status:413});
    const ai=(env as unknown as {AI?:AiBinding}).AI;
    const result=await readPartsReceivingInvoice(ai,env.DB,images);
    return Response.json({ok:true,...result},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Automatic parts invoice reader failed.';
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:/not configured/i.test(message)?503:500;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
