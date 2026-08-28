import {
  getDriverBreakdownFollowup,
  recordDriverBreakdownAction,
  uploadDriverBreakdownReceipt,
  type DriverBreakdownAction,
} from '@/lib/breakdown-driver-followup';

const ACTIONS=new Set<DriverBreakdownAction>(['tech_arrived','repair_finished','rolling']);

function rejectCrossSite(request:Request){
  return String(request.headers.get('sec-fetch-site')||'').trim().toLowerCase()==='cross-site';
}

function safeId(value:unknown){
  const id=Number(value);
  if(!Number.isInteger(id)||id<=0)throw new Error('Breakdown follow-up link is invalid.');
  return id;
}

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const breakdownId=safeId(url.searchParams.get('breakdownId'));
    const token=String(url.searchParams.get('token')||'').trim();
    const breakdown=await getDriverBreakdownFollowup(breakdownId,token);
    return Response.json({ok:true,breakdown},{headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:String(error)},{status:403,headers:{'cache-control':'no-store'}});
  }
}

export async function PATCH(request:Request){
  try{
    if(rejectCrossSite(request))return Response.json({error:'Cross-site breakdown update rejected.'},{status:403,headers:{'cache-control':'no-store'}});
    const body=await request.json<Record<string,unknown>>();
    const breakdownId=safeId(body.breakdownId);
    const token=String(body.token||'').trim();
    const action=String(body.action||'') as DriverBreakdownAction;
    if(!ACTIONS.has(action))throw new Error('Choose a valid breakdown update.');
    const breakdown=await recordDriverBreakdownAction(breakdownId,token,action);
    return Response.json({ok:true,breakdown},{headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:String(error)},{status:400,headers:{'cache-control':'no-store'}});
  }
}

export async function POST(request:Request){
  try{
    if(rejectCrossSite(request))return Response.json({error:'Cross-site receipt upload rejected.'},{status:403,headers:{'cache-control':'no-store'}});
    const form=await request.formData();
    const breakdownId=safeId(form.get('breakdownId'));
    const token=String(form.get('token')||'').trim();
    const files=form.getAll('receipt').filter((entry):entry is File=>entry instanceof File&&entry.size>0);
    const breakdown=await uploadDriverBreakdownReceipt(breakdownId,token,files);
    return Response.json({ok:true,breakdown},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const status=/too large|8 MB/i.test(message)?413:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
