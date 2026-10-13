import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getTechnicianJobComparisons } from '@/lib/technician-job-comparisons';

function utcDay(date:Date){return date.toISOString().slice(0,10);}

export async function GET(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)return Response.json({error:'Sign in to view technician job comparisons.'},{status:401,headers:{'cache-control':'no-store'}});
  if(user.role!=='manager'&&user.role!=='admin'){
    return Response.json({error:'Only managers and administrators can view technician comparisons.'},{status:403,headers:{'cache-control':'no-store'}});
  }
  try{
    const params=new URL(request.url).searchParams;
    const now=new Date();
    const start=params.get('start')??utcDay(new Date(now.getTime()-29*86400000));
    const end=params.get('end')??utcDay(now);
    const report=await getTechnicianJobComparisons(env.DB,start,end);
    return Response.json(report,{headers:{'cache-control':'private, no-store',vary:'Cookie'}});
  }catch(error){
    if(error instanceof RangeError){
      return Response.json({error:error.message},{status:400,headers:{'cache-control':'no-store'}});
    }
    console.error(JSON.stringify({event:'technician_job_comparison_report_failed',error:String(error)}));
    return Response.json({error:'Technician job comparisons could not be loaded. Choose a shorter date range if the problem continues.'},
      {status:500,headers:{'cache-control':'no-store'}});
  }
}
