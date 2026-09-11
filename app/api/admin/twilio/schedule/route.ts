import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  saveBreakdownSmsContactSchedule,
  type BreakdownSmsContactScheduleMode,
  type BreakdownSmsContactScheduleWindowInput,
  type BreakdownSmsWeekInterval,
} from '@/lib/breakdown-sms-schedule';
import {
  getBreakdownSmsContactCoverage,
  removeBreakdownSmsAwayPeriod,
  saveBreakdownSmsAwayPeriod,
} from '@/lib/breakdown-sms-vacation';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }), user: null };
  if (user.role !== 'admin') return { response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }), user: null };
  return { response: null, user };
}

async function statusPayload() {
  return { contacts: await getBreakdownSmsContactCoverage(env.DB) };
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

type WindowBody = {
  label?: string;
  days?: number[];
  startTime?: string;
  endTime?: string;
  weekInterval?: number;
  activeThisWeek?: boolean;
};

type ScheduleBody = {
  action?: string;
  contactId?: number;
  mode?: BreakdownSmsContactScheduleMode;
  windows?: WindowBody[];
  awayId?: number;
  startDate?: string;
  endDate?: string;
  backupContactId?: number | null;
  awayLabel?: string;
  // Accepted only so a browser left open during deployment can still save one
  // personal window after refreshing. The shared/default save is retired.
  days?: number[];
  startTime?: string;
  endTime?: string;
  weekInterval?: number;
  activeThisWeek?: boolean;
};

function requestedWeekInterval(value: unknown): BreakdownSmsWeekInterval {
  return Number(value) === 2 ? 2 : 1;
}

function requestedWindows(value: unknown): BreakdownSmsContactScheduleWindowInput[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const window = item && typeof item === 'object' ? item as WindowBody : {};
    return {
      label: String(window.label || ''),
      days: Array.isArray(window.days) ? window.days.map(Number) : [],
      startTime: String(window.startTime || ''),
      endTime: String(window.endTime || ''),
      weekInterval: requestedWeekInterval(window.weekInterval),
      activeThisWeek: window.activeThisWeek !== false,
    };
  });
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json().catch(() => ({})) as ScheduleBody;
    const action = String(body.action || 'save-contact');

    if (action === 'save-default') {
      return Response.json({
        error: 'The shared schedule was removed. Refresh this page and set each person’s coverage windows instead.',
      }, { status: 409 });
    }

    if (action === 'save-away') {
      await saveBreakdownSmsAwayPeriod(env.DB, {
        awayId: body.awayId == null ? null : Number(body.awayId),
        contactId: Number(body.contactId),
        startDate: String(body.startDate || ''),
        endDate: String(body.endDate || ''),
        backupContactId: body.backupContactId == null ? null : Number(body.backupContactId),
        label: String(body.awayLabel || ''),
      }, auth.user.id);
      return Response.json({
        ok: true,
        message: 'Vacation / away coverage saved. Normal texting will resume automatically after the end date.',
        ...await statusPayload(),
      });
    }

    if (action === 'remove-away') {
      await removeBreakdownSmsAwayPeriod(
        env.DB,
        Number(body.contactId),
        Number(body.awayId),
        auth.user.id,
      );
      return Response.json({
        ok: true,
        message: 'Vacation / away period canceled. The normal text schedule is active again when its regular hours match.',
        ...await statusPayload(),
      });
    }

    if (action !== 'save-contact') {
      return Response.json({ error: 'Unknown breakdown text schedule action.' }, { status: 400 });
    }

    const mode: BreakdownSmsContactScheduleMode = body.mode === 'always' || body.mode === 'custom'
      ? body.mode
      : 'default';
    const hasWindowList = Array.isArray(body.windows);

    await saveBreakdownSmsContactSchedule(env.DB, {
      contactId: Number(body.contactId),
      mode,
      windows: hasWindowList ? requestedWindows(body.windows) : undefined,
      days: Array.isArray(body.days) ? body.days.map(Number) : undefined,
      startTime: body.startTime == null ? undefined : String(body.startTime),
      endTime: body.endTime == null ? undefined : String(body.endTime),
      weekInterval: requestedWeekInterval(body.weekInterval),
      activeThisWeek: body.activeThisWeek !== false,
    }, auth.user.id);

    const status = await statusPayload();
    const message = mode === 'always'
      ? 'This person will receive every new breakdown text.'
      : mode === 'custom'
        ? 'This person’s coverage windows were saved.'
        : 'Scheduled breakdown texts are paused for this person.';

    return Response.json({ ok: true, message, ...status });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_sms_schedule_save_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown text schedule could not be saved.' }, { status: 500 });
  }
}
