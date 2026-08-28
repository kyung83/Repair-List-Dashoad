import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { confirmBreakdownReceiptAndClose, getBreakdownReceiptReview } from '@/lib/breakdown-driver-followup';

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required.');
  return user;
}

function breakdownId(value:unknown){
  const id=Number(value);
  if(!Number.isInteger(id)||id<=0)throw new Error('Breakdown was not found.');
  return id;
}

export async function GET(request:Request){
  try{
    await requireManager(request);
    const url=new URL(request.url);
    const id=breakdownId(url.searchParams.get('breakdownId'));
    const review=await getBreakdownReceiptReview(id);
    if(!review)return Response.json({error:'Breakdown was not found.'},{status:404,headers:{'cache-control':'no-store'}});
    return Response.json({ok:true,review},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}

export async function PATCH(request:Request){
  try{
    const user=await requireManager(request);
    const body=await request.json<Record<string,unknown>>();
    const id=breakdownId(body.breakdownId);
    const result=await confirmBreakdownReceiptAndClose(id,user.id,body);
    return Response.json({ok:true,...result},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
