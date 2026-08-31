import {
  BREAKDOWN_SMS_TIMEZONE,
  breakdownSmsAnchorForCurrentWeek,
  isBreakdownSmsScheduleAllowed,
  isBreakdownSmsWeekActive,
} from './breakdown-sms-schedule-core.js';

export { BREAKDOWN_SMS_TIMEZONE, isBreakdownSmsScheduleAllowed };
export const BREAKDOWN_SMS_GROUP = 'Breakdown Alerts';

export type BreakdownSmsWeekInterval = 1 | 2;

export type BreakdownSmsSchedule = {
  enabled: boolean;
  days: number[];
  startTime: string;
  endTime: string;
  weekInterval: BreakdownSmsWeekInterval;
  activeThisWeek: boolean;
  anchorWeekStart: string;
  timezone: string;
  allowedNow: boolean;
  updatedAt: string;
  updatedByUserId: number | null;
};

export type BreakdownSmsContactScheduleMode = 'default' | 'always' | 'custom';

export type BreakdownSmsContactSchedule = {
  contactId: number;
  label: string;
  phone: string;
  active: boolean;
  mode: BreakdownSmsContactScheduleMode;
  days: number[];
  startTime: string;
  endTime: string;
  weekInterval: BreakdownSmsWeekInterval;
  activeThisWeek: boolean;
  anchorWeekStart: string;
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
  week_interval: number;
  anchor_week_start: string | null;
  timezone: string;
  updated_at: string;
  updated_by_user_id: number | null;
};

type ContactScheduleRow = {
  contact_id: number;
  label: string;
  phone: string;
  active: number;
  mode: string | null;
  days_mask: number | null;
  start_minute: number | null;
  end_minute: number | null;
  week_interval: number | null;
  anchor_week_start: string | null;
  timezone: string | null;
  updated_at: string | null;
  updated_by_user_id: number | null;
};

type ScheduleCore = {
  enabled: boolean;
  daysMask: number;
  startMinute: number;
  endMinute: number;
  weekInterval: BreakdownSmsWeekInterval;
  anchorWeekStart: string;
  timezone: string;
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

function weekInterval(value: unknown): BreakdownSmsWeekInterval {
  return Number(value) === 2 ? 2 : 1;
}

function anchorWeekStart(value: unknown) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function scheduleAnchor(interval: BreakdownSmsWeekInterval, activeThisWeek: boolean | undefined) {
  return interval === 2
    ? breakdownSmsAnchorForCurrentWeek(activeThisWeek !== false, new Date(), BREAKDOWN_SMS_TIMEZONE)
    : null;
}

function defaultScheduleCore(row: ScheduleRow | null): ScheduleCore {
  return row ? {
    enabled: Boolean(row.enabled),
    daysMask: Number(row.days_mask || 0),
    startMinute: Number(row.start_minute || 0),
    endMinute: Number(row.end_minute || 0),
    weekInterval: weekInterval(row.week_interval),
    anchorWeekStart: anchorWeekStart(row.anchor_week_start),
    timezone: String(row.timezone || BREAKDOWN_SMS_TIMEZONE),
  } : {
    enabled: false,
    daysMask: 127,
    startMinute: 0,
    endMinute: 0,
    weekInterval: 1,
    anchorWeekStart: '',
    timezone: BREAKDOWN_SMS_TIMEZONE,
  };
}

function contactMode(value: unknown): BreakdownSmsContactScheduleMode {
  return value === 'always' || value === 'custom' ? value : 'default';
}

function contactScheduleCore(row: ContactScheduleRow, defaultCore: ScheduleCore): ScheduleCore {
  const mode = contactMode(row.mode);
  if (mode === 'default') return defaultCore;
  if (mode === 'always') {
    return {
      enabled: false,
      daysMask: 127,
      startMinute: 0,
      endMinute: 0,
      weekInterval: 1,
      anchorWeekStart: '',
      timezone: BREAKDOWN_SMS_TIMEZONE,
    };
  }
  return {
    enabled: true,
    daysMask: Number(row.days_mask || 0),
    startMinute: Number(row.start_minute || 0),
    endMinute: Number(row.end_minute || 0),
    weekInterval: weekInterval(row.week_interval),
    anchorWeekStart: anchorWeekStart(row.anchor_week_start),
    timezone: String(row.timezone || BREAKDOWN_SMS_TIMEZONE),
  };
}

async function scheduleRow(db: D1Database) {
  return db.prepare(`
    SELECT enabled,days_mask,start_minute,end_minute,week_interval,anchor_week_start,
           timezone,updated_at,updated_by_user_id
    FROM breakdown_sms_schedule WHERE id=1
  `).first<ScheduleRow>();
}

async function contactScheduleRow(db: D1Database, contactId: number) {
  return db.prepare(`
    SELECT c.id AS contact_id,c.label,COALESCE(c.phone,'') AS phone,c.active,
           s.mode,s.days_mask,s.start_minute,s.end_minute,s.week_interval,s.anchor_week_start,
           s.timezone,s.updated_at,s.updated_by_user_id
    FROM notification_group_contacts c
    JOIN notification_groups g ON g.id=c.group_id AND g.name=?
    LEFT JOIN breakdown_sms_contact_schedules s ON s.contact_id=c.id
    WHERE c.id=? AND c.phone IS NOT NULL AND trim(c.phone)<>''
  `).bind(BREAKDOWN_SMS_GROUP, contactId).first<ContactScheduleRow>();
}

export async function getBreakdownSmsSchedule(db: D1Database): Promise<BreakdownSmsSchedule> {
  const row = await scheduleRow(db);
  const core = defaultScheduleCore(row);
  return {
    enabled: core.enabled,
    days: daysFromMask(core.daysMask),
    startTime: minuteToTime(core.startMinute),
    endTime: minuteToTime(core.endMinute),
    weekInterval: core.weekInterval,
    activeThisWeek: isBreakdownSmsWeekActive(core),
    anchorWeekStart: core.anchorWeekStart,
    timezone: core.timezone,
    allowedNow: isBreakdownSmsScheduleAllowed(core),
    updatedAt: row?.updated_at || '',
    updatedByUserId: row?.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
  };
}

export async function getBreakdownSmsContactSchedules(db: D1Database): Promise<BreakdownSmsContactSchedule[]> {
  const [defaultRow, group] = await Promise.all([
    scheduleRow(db),
    db.prepare(`SELECT id FROM notification_groups WHERE name=?`).bind(BREAKDOWN_SMS_GROUP).first<{ id: number }>(),
  ]);
  if (!group) return [];

  const defaultCore = defaultScheduleCore(defaultRow);
  const result = await db.prepare(`
    SELECT c.id AS contact_id,c.label,COALESCE(c.phone,'') AS phone,c.active,
           s.mode,s.days_mask,s.start_minute,s.end_minute,s.week_interval,s.anchor_week_start,
           s.timezone,s.updated_at,s.updated_by_user_id
    FROM notification_group_contacts c
    LEFT JOIN breakdown_sms_contact_schedules s ON s.contact_id=c.id
    WHERE c.group_id=? AND c.phone IS NOT NULL AND trim(c.phone)<>''
    ORDER BY c.active DESC,c.label COLLATE NOCASE,c.id
  `).bind(group.id).all<ContactScheduleRow>();

  return result.results.map(row => {
    const mode = contactMode(row.mode);
    const core = contactScheduleCore(row, defaultCore);
    const storedDaysMask = row.days_mask == null ? 127 : Number(row.days_mask);
    const storedStartMinute = row.start_minute == null ? 0 : Number(row.start_minute);
    const storedEndMinute = row.end_minute == null ? 0 : Number(row.end_minute);
    const storedWeekInterval = weekInterval(row.week_interval);
    const storedAnchorWeekStart = anchorWeekStart(row.anchor_week_start);
    return {
      contactId: Number(row.contact_id),
      label: String(row.label || ''),
      phone: String(row.phone || ''),
      active: Boolean(row.active),
      mode,
      days: daysFromMask(storedDaysMask),
      startTime: minuteToTime(storedStartMinute),
      endTime: minuteToTime(storedEndMinute),
      weekInterval: storedWeekInterval,
      activeThisWeek: isBreakdownSmsWeekActive({
        enabled: true,
        daysMask: storedDaysMask,
        startMinute: storedStartMinute,
        endMinute: storedEndMinute,
        weekInterval: storedWeekInterval,
        anchorWeekStart: storedAnchorWeekStart,
        timezone: String(row.timezone || BREAKDOWN_SMS_TIMEZONE),
      }),
      anchorWeekStart: storedAnchorWeekStart,
      timezone: String(row.timezone || BREAKDOWN_SMS_TIMEZONE),
      allowedNow: Boolean(row.active) && isBreakdownSmsScheduleAllowed(core),
      updatedAt: row.updated_at || '',
      updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
    };
  });
}

export async function saveBreakdownSmsSchedule(
  db: D1Database,
  input: {
    enabled: boolean;
    days: number[];
    startTime: string;
    endTime: string;
    weekInterval: BreakdownSmsWeekInterval;
    activeThisWeek: boolean;
  },
  updatedByUserId: number,
) {
  const daysMask = maskFromDays(Array.isArray(input.days) ? input.days : []);
  const startMinute = timeToMinute(input.startTime);
  const endMinute = timeToMinute(input.endTime);
  const interval = weekInterval(input.weekInterval);
  const anchor = scheduleAnchor(interval, input.activeThisWeek);
  if (input.enabled && daysMask === 0) throw new Error('Select at least one day for the default breakdown text schedule.');
  if (startMinute == null || endMinute == null) throw new Error('Enter a valid start and end time.');

  await db.prepare(`
    INSERT INTO breakdown_sms_schedule(
      id,enabled,days_mask,start_minute,end_minute,week_interval,anchor_week_start,
      timezone,updated_at,updated_by_user_id
    ) VALUES(1,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
    ON CONFLICT(id) DO UPDATE SET
      enabled=excluded.enabled,
      days_mask=excluded.days_mask,
      start_minute=excluded.start_minute,
      end_minute=excluded.end_minute,
      week_interval=excluded.week_interval,
      anchor_week_start=excluded.anchor_week_start,
      timezone=excluded.timezone,
      updated_at=CURRENT_TIMESTAMP,
      updated_by_user_id=excluded.updated_by_user_id
  `).bind(
    input.enabled ? 1 : 0,
    daysMask || 127,
    startMinute,
    endMinute,
    interval,
    anchor,
    BREAKDOWN_SMS_TIMEZONE,
    updatedByUserId,
  ).run();
}

export async function saveBreakdownSmsContactSchedule(
  db: D1Database,
  input: {
    contactId: number;
    mode: BreakdownSmsContactScheduleMode;
    days: number[];
    startTime: string;
    endTime: string;
    weekInterval: BreakdownSmsWeekInterval;
    activeThisWeek: boolean;
  },
  updatedByUserId: number,
) {
  const contactId = Number(input.contactId);
  if (!Number.isInteger(contactId) || contactId <= 0) throw new Error('Choose a valid breakdown text user.');
  const mode = contactMode(input.mode);
  const daysMask = maskFromDays(Array.isArray(input.days) ? input.days : []);
  const startMinute = timeToMinute(input.startTime);
  const endMinute = timeToMinute(input.endTime);
  const interval = weekInterval(input.weekInterval);
  const anchor = scheduleAnchor(interval, input.activeThisWeek);
  if (mode === 'custom' && daysMask === 0) throw new Error('Select at least one day for this person.');
  if (startMinute == null || endMinute == null) throw new Error('Enter a valid start and end time.');

  const contact = await db.prepare(`
    SELECT c.id
    FROM notification_group_contacts c
    JOIN notification_groups g ON g.id=c.group_id
    WHERE c.id=? AND g.name=? AND c.phone IS NOT NULL AND trim(c.phone)<>''
  `).bind(contactId, BREAKDOWN_SMS_GROUP).first<{ id: number }>();
  if (!contact) throw new Error('Breakdown text user was not found.');

  await db.prepare(`
    INSERT INTO breakdown_sms_contact_schedules(
      contact_id,mode,days_mask,start_minute,end_minute,week_interval,anchor_week_start,
      timezone,updated_at,updated_by_user_id
    ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
    ON CONFLICT(contact_id) DO UPDATE SET
      mode=excluded.mode,
      days_mask=excluded.days_mask,
      start_minute=excluded.start_minute,
      end_minute=excluded.end_minute,
      week_interval=excluded.week_interval,
      anchor_week_start=excluded.anchor_week_start,
      timezone=excluded.timezone,
      updated_at=CURRENT_TIMESTAMP,
      updated_by_user_id=excluded.updated_by_user_id
  `).bind(
    contactId,
    mode,
    daysMask || 127,
    startMinute,
    endMinute,
    interval,
    anchor,
    BREAKDOWN_SMS_TIMEZONE,
    updatedByUserId,
  ).run();
}

export async function breakdownSmsScheduleAllows(db: D1Database, contactId?: number) {
  const defaultRow = await scheduleRow(db);
  const defaultCore = defaultScheduleCore(defaultRow);
  if (!contactId) return isBreakdownSmsScheduleAllowed(defaultCore);

  const row = await contactScheduleRow(db, contactId);
  if (!row) return isBreakdownSmsScheduleAllowed(defaultCore);
  return isBreakdownSmsScheduleAllowed(contactScheduleCore(row, defaultCore));
}
