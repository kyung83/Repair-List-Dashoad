import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { replacePartCrossReferences } from '@/lib/part-cross-references';

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required.');
  return user;
}

export async function POST(request:Request){
  try{
    await requireManager(request);
    const body=await request.json() as Record<string,unknown>;
    const partId=Number(body.partId??0);
    return Response.json(await replacePartCrossReferences(env.DB,partId,body.crossReferences),{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Cross references could not be saved.';
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
