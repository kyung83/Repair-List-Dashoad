import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getRepairTypeReportData } from '@/lib/repair-type-reports';

export async function GET(request:Request){
  try{
    const user=await getSessionUser(env.DB,request);
    if(!user)return Response.json({error:'Authentication required.'},{status:401});
    if(user.role==='mechanic')return Response.json({error:'Reports access is not available for this role.'},{status:403});
    const params=new URL(request.url).searchParams;
    return Response.json(await getRepairTypeReportData(env.DB,{
      startDate:params.get('start'),endDate:params.get('end'),repairType:params.get('repairType'),equipmentId:params.get('unit'),technician:params.get('technician'),query:params.get('q'),
    }),{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'repair_type_report_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Repair type report could not be loaded.'},{status:500});
  }
}
