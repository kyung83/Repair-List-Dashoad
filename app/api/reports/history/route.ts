// Historical RO reporting endpoint.
import { env } from 'cloudflare:workers';
import { getHistoricalReportingData } from '@/lib/history-reporting';

export async function GET(request: Request) {
  try {
    const u = new URL(request.url);
    return Response.json(await getHistoricalReportingData(env.DB, {
      startDate: u.searchParams.get('start'), endDate: u.searchParams.get('end'),
      equipmentId: u.searchParams.get('unit'), majorCategory: u.searchParams.get('major'),
      systemCode: u.searchParams.get('system'), assemblyCode: u.searchParams.get('assembly'),
      query: u.searchParams.get('q'),
    }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'history_reports_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Historical reports could not be loaded.' }, { status: 500 });
  }
}
