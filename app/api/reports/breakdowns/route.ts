import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getBreakdownReportData } from '@/lib/breakdown-reports';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    if (user.role === 'mechanic') return Response.json({ error: 'Reports access is not available for this role.' }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const data = await getBreakdownReportData(env.DB, {
      startDate: params.get('start'),
      endDate: params.get('end'),
      equipmentId: params.get('unit'),
      category: params.get('category'),
      provider: params.get('provider'),
      status: params.get('status'),
      location: params.get('location'),
      query: params.get('q'),
    });
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_report_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown reports could not be loaded.' }, { status: 500 });
  }
}
