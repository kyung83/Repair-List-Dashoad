import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getReportSearchData } from '@/lib/report-search';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    if (user.role === 'mechanic') return Response.json({ error: 'Reports access is not available for this role.' }, { status: 403 });

    const url = new URL(request.url);
    const params = url.searchParams;
    const data = await getReportSearchData(env.DB, {
      startDate: params.get('start'),
      endDate: params.get('end'),
      equipmentId: params.get('unit'),
      category: params.get('category'),
      equipmentType: params.get('equipmentType'),
      make: params.get('make'),
      model: params.get('model'),
      repairStatus: params.get('repairStatus'),
      technician: params.get('technician'),
      repairSource: params.get('repairSource'),
      repairLocation: params.get('repairLocation'),
      maintenanceType: params.get('maintenanceType'),
      pmType: params.get('pmType'),
      maintenanceSource: params.get('maintenanceSource'),
      expenseCategory: params.get('expenseCategory'),
      expenseSource: params.get('expenseSource'),
      query: params.get('q'),
    });
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'report_search_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Report search could not be loaded.' }, { status: 500 });
  }
}
