import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getPartsUsageReport } from '@/lib/parts-usage-report';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    if (user.role === 'mechanic' || user.role === 'dispatch') {
      return Response.json({ error: 'Reports access is not available for this role.' }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const data = await getPartsUsageReport(env.DB, {
      startDate: params.get('start'),
      endDate: params.get('end'),
      partId: params.get('part'),
      equipmentId: params.get('unit'),
      query: params.get('q'),
    });

    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'parts_usage_report_failed', error: String(error) }));
    return Response.json(
      { error: error instanceof Error ? error.message : 'Parts usage report could not be loaded.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
