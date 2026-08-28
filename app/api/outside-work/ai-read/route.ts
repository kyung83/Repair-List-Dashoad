import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  readOutsideWorkInvoice,
  OUTSIDE_WORK_MAX_IMAGES,
  OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES,
} from '@/lib/outside-work-ai-reader';

type AiBinding={run:(model:string,input:unknown,options?:unknown)=>Promise<unknown>};

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required for Outside Work Intake.');
  return user;
}

export async function POST(request:Request){
  try{
    await requireManager(request);
    const body=await request.formData();
    const images=body.getAll('image').filter((entry):entry is File=>entry instanceof File&&entry.size>0);
    if(!images.length)return Response.json({error:'Invoice image is required.'},{status:400,headers:{'cache-control':'no-store'}});
    if(images.length>OUTSIDE_WORK_MAX_IMAGES)return Response.json({error:`Automatic invoice reader supports up to ${OUTSIDE_WORK_MAX_IMAGES} invoice pages at a time.`},{status:400,headers:{'cache-control':'no-store'}});
    if(images.reduce((sum,file)=>sum+file.size,0)>OUTSIDE_WORK_MAX_TOTAL_IMAGE_BYTES){
      return Response.json({error:'Invoice pages are too large for the automatic AI reader.'},{status:413,headers:{'cache-control':'no-store'}});
    }

    const ai=(env as unknown as {AI?:AiBinding}).AI;
    const {model,reading}=await readOutsideWorkInvoice(ai,env.DB,images);
    return Response.json({ok:true,model,reading},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Automatic AI invoice reader failed.';
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:/not configured/i.test(message)?503:/could not read|billing|credits/i.test(message)?502:500;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
