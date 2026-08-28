export const BREAKDOWN_SMS_TIMEZONE = 'America/Detroit';

export type BreakdownSmsSchedule = {
  enabled: boolean;
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  allowedNow: boolean;
  updatedAt: string;
  updatedByUserId: number | null;
};

type ScheduleRow = {
  enabled: number;
  days_mask: number;
  start_minute: number;
  end_minute: number;
  timezone: string;
  updated_at: string;
  updated_by_user_id: number | null;
};

type ScheduleCore = {
  enabled: boolean;
  daysMask: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function minuteToTime(minute: number) {
  const safe = Math.max(0, Math.min(1439, Math.trunc(Number(minute) || 0)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function timeToMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function maskFromDays(days: number[]) {
  let mask = 0;
  for (const day of days) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) mask |= 1 << day;
  }
  return mask;
}

function daysFromMask(mask: number) {
  const days: number[] = [];
  for (let day = 0; day <= 6; day += 1) {
    if ((mask & (1 << day)) !== 0) days.push(day);
  }
  return days;
}

function localClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = parts.find(part => part.type === 'weekday')?.value || '';
  const hour = Number(parts.find(part => part.type === 'hour')?.value || '0');
  const minute = Number(parts.find(part => part.type === 'minute')?.value || '0');
  const day = WEEKDAY_INDEX[weekday];
  return {
    day: Number.isInteger(day) ? day : 0,
    minute: hour * 60 + minute,
  };
}

function selected(mask: number, day: number) {
  return (mask & (1 << day)) !== 0;
}

export function isBreakdownSmsScheduleAllowed(schedule: ScheduleCore, date = new Date()) {
  if (!schedule.enabled) return true;
  if (!schedule.daysMask) return false;

  const clock = localClock(date, schedule.timezone || BREAKDOWN_SMS_TIMEZONE);
  const start = schedule.startMinute;
  const end = schedule.endMinute;

  // Equal times mean a full 24-hour window on each selected day.
  if (start === end) return selected(schedule.daysMask, clock.day);

  // Same-day window, e.g. 06:00-22:00.
  if (start < end) {
    return selected(schedule.daysMask, clock.day) && clock.minute >= start && clock.minute < end;
  }

  // Overnight window, e.g. Monday 18:00-Tuesday 06:00. The selected day
  // is the day the window starts, so early Tuesday belongs to Monday's window.
  if (clock.minute >= start) return selected(schedule.daysMask, clock.day);
  const previousDay = (clock.day + 6) % 7;
  return clock.minute < end && selected(schedule.daysMask, previousDay);
}

async function scheduleRow(db: D1Database) {
  return db.prepare(`
    SELECT enabled,days_mask,start_minute,end_minute,timezone,updated_at,updated_by_user_id
    FROM breakdown_sms_schedule WHERE id=1
  `).first<ScheduleRow>();
}

export async function getBreakdownSmsSchedule(db: D1Database): Promise<BreakdownSmsSchedule> {
  const row = await scheduleRow(db);
  const core: ScheduleCore = row ? {
    enabled: Boolean(row.enabled),
    daysMask: Number(row.days_mask || 0),
    startMinute: Number(row.start_minute || 0),
    endMinute: Number(row.end_minute || 0),
    timezone: String(row.timezone || BREAKDOWN_SMS_TIMEZONE),
  } : {
    enabled: false,
    daysMask: 127,
    startMinute: 0,
    endMinute: 0,
    timezone: BREAKDOWN_SMS_TIMEZONE,
  };
  return {
    enabled: core.enabled,
    days: daysFromMask(core.daysMask),
    startTime: minuteToTime(core.startMinute),
    endTime: minuteToTime(core.endMinute),
    timezone: core.timezone,
    allowedNow: isBreakdownSmsScheduleAllowed(core),
    updatedAt: row?.updated_at || '',
    updatedByUserId: row?.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
  };
}

export async function saveBreakdownSmsSchedule(
  db: D1Database,
  input: { enabled: boolean; days: number[]; startTime: string; endTime: string },
  updatedByUserId: number,
) {
  const daysMask = maskFromDays(Array.isArray(input.days) ? input.days : []);
  const startMinute = timeToMinute(input.startTime);
  const endMinute = timeToMinute(input.endTime);
  if (input.enabled && daysMask === 0) throw new Error('Select at least one day for the breakdown text schedule.');
  if (startMinute == null || endMinute == null) throw new Error('Enter a valid start and end time.');

  await db.prepare(`
    INSERT INTO breakdown_sms_schedule(
      id,enabled,days_mask,start_minute,end_minute,timezone,updated_at,updated_by_user_id
    ) VALUES(1,?,?,?,?,?,CURRENT_TIMESTAMP,?)
    ON CONFLICT(id) DO UPDATE SET
      enabled=excluded.enabled,
      days_mask=excluded.days_mask,
      start_minute=excluded.start_minute,
      end_minute=excluded.end_minute,
      timezone=excluded.timezone,
      updated_at=CURRENT_TIMESTAMP,
      updated_by_user_id=excluded.updated_by_user_id
  `).bind(
    input.enabled ? 1 : 0,
    daysMask || 127,
    startMinute,
    endMinute,
    BREAKDOWN_SMS_TIMEZONE,
    updatedByUserId,
  ).run();
}

export async function breakdownSmsScheduleAllows(db: D1Database) {
  const row = await scheduleRow(db);
  if (!row) return true;
  return isBreakdownSmsScheduleAllowed({
    enabled: Boolean(row.enabled),
    daysMask: Number(row.days_mask || 0),
    startMinute: Number(row.start_minute || 0),
    endMinute: Number(row.end_minute || 0),
    timezone: String(row.timezone || BREAKDOWN_SMS_TIMEZONE),
  });
}
