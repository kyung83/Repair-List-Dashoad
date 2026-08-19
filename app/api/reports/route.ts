import { env } from 'cloudflare:workers';
import { handleReportingAction } from '@/lib/reports';
import { getReportingDataOptimized } from '@/lib/reports-optimized';
import { mergeHistoricalReportingDataOptimized } from '@/lib/reports-history-merge-optimized';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const base = await getReportingDataOptimized(env.DB, url.searchParams.get('year'), url.searchParams.get('unit'));
    return Response.json(await mergeHistoricalReportingDataOptimized(env.DB, base), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'reports_get_failed', error: String(error) }));
    return Response.json({ error: 'Reports could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return Response.json(await handleReportingAction(env.DB, body), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'reports_post_failed', error: String(error) }));
    return Response.json(
      { error: error instanceof Error ? error.message : 'Reporting action failed.' },
      { status: 400 },
    );
  }
}
