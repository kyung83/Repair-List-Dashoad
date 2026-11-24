import {env} from 'cloudflare:workers';
import {getSessionUser} from '@/lib/auth';
import {getReportSearchData} from '@/lib/report-search';
import {getBreakdownReportData} from '@/lib/breakdown-reports';

export async function GET(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)return Response.json({error:'Authentication required.'},{status:401});
  if(user.role!=='manager'&&user.role!=='admin')return Response.json({error:'Manager or administrator access required.'},{status:403});
  try{
    const p=new URL(request.url).searchParams;
    const start=p.get('start')||'',end=p.get('end')||'',type=p.get('equipmentType')||'',unit=p.get('unit')||'',view=p.get('view');
    const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
    if(!validDate(start)||!validDate(end)||start>end)throw new RangeError('Select a valid date range.');
    if(!['','truck','trailer'].includes(type))throw new RangeError('Select a valid equipment type.');
    if(unit&&(!/^\d+$/.test(unit)||!Number.isSafeInteger(Number(unit))||Number(unit)<=0))throw new RangeError('Select a valid unit.');
    if(view!=='repairs'&&view!=='breakdowns')throw new RangeError('Invalid report view.');
    const filters={startDate:start,endDate:end,equipmentType:type,equipmentId:unit,query:p.get('q'),deepSearch:true,includeInactive:true};
    const result=view==='repairs'?await getReportSearchData(env.DB,filters):await getBreakdownReportData(env.DB,filters);
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'report_center_pilot_failed',error:String(error)}));
    return Response.json({error:error instanceof RangeError?error.message:'The report could not load. Try a smaller range or use the classic reports.'},{status:error instanceof RangeError?400:500,headers:{'cache-control':'no-store'}});
  }
}
