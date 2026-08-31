import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  getBreakdownSmsContactSchedules,
  getBreakdownSmsSchedule,
  saveBreakdownSmsContactSchedule,
  saveBreakdownSmsSchedule,
  type BreakdownSmsContactScheduleMode,
  type BreakdownSmsWeekInterval,
} from '@/lib/breakdown-sms-schedule';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }), user: null };
  if (user.role !== 'admin') return { response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }), user: null };
  return { response: null, user };
}

async function statusPayload() {
  const [schedule, contacts] = await Promise.all([
    getBreakdownSmsSchedule(env.DB),
    getBreakdownSmsContactSchedules(env.DB),
  ]);
  return { schedule, contacts };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    return Response.json(await statusPayload(), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_sms_schedule_status_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown text schedules could not be loaded.' }, { status: 500 });
  }
}

type ScheduleBody = {
  action?: string;
  enabled?: boolean;
  days?: number[];
  startTime?: string;
  endTime?: string;
  weekInterval?: number;
  activeThisWeek?: boolean;
  contactId?: number;
  mode?: BreakdownSmsContactScheduleMode;
};

function requestedWeekInterval(value: unknown): BreakdownSmsWeekInterval {
  return Number(value) === 2 ? 2 : 1;
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json().catch(() => ({})) as ScheduleBody;
    const action = String(body.action || 'save-default');

    if (action === 'save-contact') {
      await saveBreakdownSmsContactSchedule(env.DB, {
        contactId: Number(body.contactId),
        mode: body.mode === 'always' || body.mode === 'custom' ? body.mode : 'default',
        days: Array.isArray(body.days) ? body.days.map(Number) : [],
        startTime: String(body.startTime || ''),
        endTime: String(body.endTime || ''),
        weekInterval: requestedWeekInterval(body.weekInterval),
        activeThisWeek: body.activeThisWeek !== false,
      }, auth.user.id);
      const status = await statusPayload();
      return Response.json({
        ok: true,
        message: 'Personal breakdown text schedule saved.',
        ...status,
      });
    }

    if (action !== 'save-default') {
      return Response.json({ error: 'Unknown breakdown text schedule action.' }, { status: 400 });
    }

    await saveBreakdownSmsSchedule(env.DB, {
      enabled: Boolean(body.enabled),
      days: Array.isArray(body.days) ? body.days.map(Number) : [],
      startTime: String(body.startTime || ''),
      endTime: String(body.endTime || ''),
      weekInterval: requestedWeekInterval(body.weekInterval),
      activeThisWeek: body.activeThisWeek !== false,
    }, auth.user.id);
    const status = await statusPayload();
    return Response.json({
      ok: true,
      message: body.enabled ? 'Default breakdown text schedule saved.' : 'Default breakdown texts set to Always On.',
      ...status,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_sms_schedule_save_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown text schedule could not be saved.' }, { status: 500 });
  }
}
