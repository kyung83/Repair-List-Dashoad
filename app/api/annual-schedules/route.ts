import { env } from 'cloudflare:workers';
import {
  applyAnnualSchedule,
  clearAnnualSchedule,
  completeAnnual,
  getAnnualScheduleData,
} from '@/lib/annual-schedules';

export async function GET() {
  try {
    return Response.json(await getAnnualScheduleData(env.DB), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'annual_schedule_get_failed', error: String(error) }));
    return Response.json({ error: 'Annual schedules could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'applyAnnual') return Response.json(await applyAnnualSchedule(env.DB, body));
    if (action === 'clearAnnual') return Response.json(await clearAnnualSchedule(env.DB, body));
    if (action === 'completeAnnual') return Response.json(await completeAnnual(env.DB, body));
    return Response.json({ error: 'Unknown annual schedule action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'annual_schedule_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Annual schedule action failed.' }, { status: 400 });
  }
}
