import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getBreakdownSmsSchedule, saveBreakdownSmsSchedule } from '@/lib/breakdown-sms-schedule';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }), user: null };
  if (user.role !== 'admin') return { response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }), user: null };
  return { response: null, user };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    return Response.json({ schedule: await getBreakdownSmsSchedule(env.DB) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_sms_schedule_status_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown text schedule could not be loaded.' }, { status: 500 });
  }
}

type ScheduleBody = {
  enabled?: boolean;
  days?: number[];
  startTime?: string;
  endTime?: string;
};

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json().catch(() => ({})) as ScheduleBody;
    await saveBreakdownSmsSchedule(env.DB, {
      enabled: Boolean(body.enabled),
      days: Array.isArray(body.days) ? body.days.map(Number) : [],
      startTime: String(body.startTime || ''),
      endTime: String(body.endTime || ''),
    }, auth.user.id);
    return Response.json({
      ok: true,
      message: body.enabled ? 'Breakdown text schedule saved.' : 'Breakdown texts set to Always On.',
      schedule: await getBreakdownSmsSchedule(env.DB),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_sms_schedule_save_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown text schedule could not be saved.' }, { status: 500 });
  }
}
