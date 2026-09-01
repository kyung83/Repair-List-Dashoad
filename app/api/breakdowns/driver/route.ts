import { env } from 'cloudflare:workers';
import {
  getDriverBreakdownFollowup,
  recordDriverBreakdownAction,
  type DriverBreakdownAction,
} from '@/lib/breakdown-driver-followup';
import { uploadAndReadDriverBreakdownReceipt } from '@/lib/breakdown-driver-receipt-server';

const ACTIONS=new Set<DriverBreakdownAction>(['tech_arrived','repair_finished','rolling']);

type DispatchRow={
  service_provider:string|null;
  service_provider_phone:string|null;
  eta:string|null;
  updated_at:string|null;
};

type FollowupBase=Awaited<ReturnType<typeof getDriverBreakdownFollowup>>;

function rejectCrossSite(request:Request){
  return String(request.headers.get('sec-fetch-site')||'').trim().toLowerCase()==='cross-site';
}

function safeId(value:unknown){
  const id=Number(value);
  if(!Number.isInteger(id)||id<=0)throw new Error('Breakdown follow-up link is invalid.');
  return id;
}

async function withDispatch(breakdownId:number,breakdown:FollowupBase){
  const dispatch=await env.DB.prepare(`
    SELECT service_provider,service_provider_phone,eta,updated_at
    FROM roadside_breakdowns
    WHERE id=?
  `).bind(breakdownId).first<DispatchRow>();
  return{
    ...breakdown,
    serviceProvider:String(dispatch?.service_provider||'').trim(),
    serviceProviderPhone:String(dispatch?.service_provider_phone||'').trim(),
    eta:String(dispatch?.eta||'').trim(),
    dispatchUpdatedAt:dispatch?.updated_at||null,
  };
}

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const breakdownId=safeId(url.searchParams.get('breakdownId'));
    const token=String(url.searchParams.get('token')||'').trim();
    const verified=await getDriverBreakdownFollowup(breakdownId,token);
    const breakdown=await withDispatch(breakdownId,verified);
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
    const updated=await recordDriverBreakdownAction(breakdownId,token,action);
    const breakdown=await withDispatch(breakdownId,updated);
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
    const updated=await uploadAndReadDriverBreakdownReceipt(breakdownId,token,files);
    const breakdown=await withDispatch(breakdownId,updated);
    return Response.json({ok:true,breakdown},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const status=/too large|20 MB/i.test(message)?413:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
