import { env } from 'cloudflare:workers';
import { getReportingData, handleReportingAction } from '@/lib/reports';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(await getReportingData(env.DB, url.searchParams.get('year')), {
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
