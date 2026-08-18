import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  applyAnnualSchedule,
  clearAnnualSchedule,
  completeAnnual,
  getAnnualScheduleData,
} from '@/lib/annual-schedules';

async function authorize(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'admin') {
    return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const denied = await authorize(request);
    if (denied) return denied;
    return Response.json(await getAnnualScheduleData(env.DB), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'annual_schedule_get_failed', error: String(error) }));
    return Response.json({ error: 'Annual schedules could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const denied = await authorize(request);
    if (denied) return denied;
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
