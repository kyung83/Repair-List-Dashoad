import { env } from 'cloudflare:workers';
import {
  applyPmSchedule,
  clearPmSchedule,
  getPmScheduleData,
  recordAnnualCompletion,
  recordPmCompletion,
  setPmEquipmentCategory,
  updatePmMileage,
} from '@/lib/pm-schedules';

export async function GET() {
  try {
    return Response.json(await getPmScheduleData(env.DB), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'pm_schedule_get_failed', error: String(error) }));
    return Response.json({ error: 'PM schedules could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'applySchedule') return Response.json(await applyPmSchedule(env.DB, body));
    if (action === 'clearSchedule') return Response.json(await clearPmSchedule(env.DB, body));
    if (action === 'setCategory') return Response.json(await setPmEquipmentCategory(env.DB, body));
    if (action === 'updateMileage') return Response.json(await updatePmMileage(env.DB, body));
    if (action === 'completePm') return Response.json(await recordPmCompletion(env.DB, body));
    if (action === 'completeAnnual') return Response.json(await recordAnnualCompletion(env.DB, body));
    return Response.json({ error: 'Unknown PM schedule action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'pm_schedule_post_failed', error: String(error) }));
    return Response.json(
      { error: error instanceof Error ? error.message : 'PM schedule action failed.' },
      { status: 400 },
    );
  }
}
