import {
  BREAKDOWN_SMS_TIMEZONE,
  breakdownSmsAnchorForCurrentWeek,
  isBreakdownSmsCoverageAllowed,
  isBreakdownSmsScheduleAllowed,
  isBreakdownSmsWeekActive,
} from './breakdown-sms-schedule-core.js';

export {
  BREAKDOWN_SMS_TIMEZONE,
  isBreakdownSmsCoverageAllowed,
  isBreakdownSmsScheduleAllowed,
};
export const BREAKDOWN_SMS_GROUP = 'Breakdown Alerts';
export const MAX_BREAKDOWN_SMS_PERSONAL_WINDOWS = 12;

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

export type BreakdownSmsContactScheduleWindow = {
  id: number;
  label: string;
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

export type BreakdownSmsContactSchedule = {
  contactId: number;
  label: string;
  phone: string;
  active: boolean;
  mode: BreakdownSmsContactScheduleMode;
  windows: BreakdownSmsContactScheduleWindow[];
  // First-window compatibility fields are retained for older clients.
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

export type BreakdownSmsContactScheduleWindowInput = {
  label?: string;
  days: number[];
  startTime: string;
  endTime: string;
  weekInterval: BreakdownSmsWeekInterval;
  activeThisWeek: boolean;
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

type ContactScheduleWindowRow = {
  id: number;
  contact_id: number;
  label: string;
  days_mask: number;
  start_minute: number;
  end_minute: number;
  week_interval: number;
  anchor_week_start: string | null;
  timezone: string;
  sort_order: number;
  updated_at: string;
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

type NormalizedWindow = {
  label: string;
  daysMask: number;
  startMinute: number;
  endMinute: number;
  weekInterval: BreakdownSmsWeekInterval;
  anchorWeekStart: string | null;
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

function legacyPersonalCore(row: ContactScheduleRow): ScheduleCore {
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

function windowCore(row: ContactScheduleWindowRow): ScheduleCore {
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

function windowResponse(row: ContactScheduleWindowRow): BreakdownSmsContactScheduleWindow {
  const core = windowCore(row);
  return {
    id: Number(row.id),
    label: String(row.label || '').trim() || 'Personal coverage',
    days: daysFromMask(core.daysMask),
    startTime: minuteToTime(core.startMinute),
    endTime: minuteToTime(core.endMinute),
    weekInterval: core.weekInterval,
    activeThisWeek: isBreakdownSmsWeekActive(core),
    anchorWeekStart: core.anchorWeekStart,
    timezone: core.timezone,
    allowedNow: isBreakdownSmsScheduleAllowed(core),
    updatedAt: row.updated_at || '',
    updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
  };
}

function legacyWindowResponse(row: ContactScheduleRow): BreakdownSmsContactScheduleWindow {
  const core = legacyPersonalCore(row);
  return {
    id: 0,
    label: 'Personal coverage',
    days: daysFromMask(core.daysMask),
    startTime: minuteToTime(core.startMinute),
    endTime: minuteToTime(core.endMinute),
    weekInterval: core.weekInterval,
    activeThisWeek: isBreakdownSmsWeekActive(core),
    anchorWeekStart: core.anchorWeekStart,
    timezone: core.timezone,
    allowedNow: isBreakdownSmsScheduleAllowed(core),
    updatedAt: row.updated_at || '',
    updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
  };
}

function contactScheduleAllowed(
  row: ContactScheduleRow,
  personalRows: ContactScheduleWindowRow[],
  sharedCore: ScheduleCore,
  date = new Date(),
) {
  const mode = contactMode(row.mode);
  if (mode === 'default') return isBreakdownSmsScheduleAllowed(sharedCore, date);
  if (mode === 'always') return true;

  const personalCores = personalRows.length
    ? personalRows.map(windowCore)
    : [legacyPersonalCore(row)];
  return isBreakdownSmsCoverageAllowed(sharedCore, personalCores, date);
}

function normalizeWindowInput(
  input: BreakdownSmsContactScheduleWindowInput,
  index: number,
): NormalizedWindow {
  const daysMask = maskFromDays(Array.isArray(input.days) ? input.days : []);
  const startMinute = timeToMinute(input.startTime);
  const endMinute = timeToMinute(input.endTime);
  const interval = weekInterval(input.weekInterval);
  if (!daysMask) throw new Error(`Select at least one day for personal coverage window ${index + 1}.`);
  if (startMinute == null || endMinute == null) throw new Error(`Enter a valid start and end time for personal coverage window ${index + 1}.`);
  const rawLabel = String(input.label || '').trim();
  return {
    label: (rawLabel || `Personal coverage ${index + 1}`).slice(0, 80),
    daysMask,
    startMinute,
    endMinute,
    weekInterval: interval,
    anchorWeekStart: scheduleAnchor(interval, input.activeThisWeek),
    timezone: BREAKDOWN_SMS_TIMEZONE,
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

async function contactScheduleWindowRows(db: D1Database, contactId: number) {
  const result = await db.prepare(`
    SELECT id,contact_id,label,days_mask,start_minute,end_minute,week_interval,
           anchor_week_start,timezone,sort_order,updated_at,updated_by_user_id
    FROM breakdown_sms_contact_schedule_windows
    WHERE contact_id=?
    ORDER BY sort_order,id
  `).bind(contactId).all<ContactScheduleWindowRow>();
  return result.results;
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
  const [contactsResult, windowsResult] = await Promise.all([
    db.prepare(`
      SELECT c.id AS contact_id,c.label,COALESCE(c.phone,'') AS phone,c.active,
             s.mode,s.days_mask,s.start_minute,s.end_minute,s.week_interval,s.anchor_week_start,
             s.timezone,s.updated_at,s.updated_by_user_id
      FROM notification_group_contacts c
      LEFT JOIN breakdown_sms_contact_schedules s ON s.contact_id=c.id
      WHERE c.group_id=? AND c.phone IS NOT NULL AND trim(c.phone)<>''
      ORDER BY c.active DESC,c.label COLLATE NOCASE,c.id
    `).bind(group.id).all<ContactScheduleRow>(),
    db.prepare(`
      SELECT w.id,w.contact_id,w.label,w.days_mask,w.start_minute,w.end_minute,w.week_interval,
             w.anchor_week_start,w.timezone,w.sort_order,w.updated_at,w.updated_by_user_id
      FROM breakdown_sms_contact_schedule_windows w
      JOIN notification_group_contacts c ON c.id=w.contact_id
      WHERE c.group_id=?
      ORDER BY w.contact_id,w.sort_order,w.id
    `).bind(group.id).all<ContactScheduleWindowRow>(),
  ]);

  const windowsByContact = new Map<number, ContactScheduleWindowRow[]>();
  for (const window of windowsResult.results) {
    const contactId = Number(window.contact_id);
    const existing = windowsByContact.get(contactId) || [];
    existing.push(window);
    windowsByContact.set(contactId, existing);
  }

  return contactsResult.results.map(row => {
    const contactId = Number(row.contact_id);
    const mode = contactMode(row.mode);
    const personalRows = windowsByContact.get(contactId) || [];
    const windows = personalRows.length
      ? personalRows.map(windowResponse)
      : mode === 'custom'
        ? [legacyWindowResponse(row)]
        : [];
    const firstWindow = windows[0];
    const legacy = legacyWindowResponse(row);
    const compatibility = firstWindow || legacy;
    return {
      contactId,
      label: String(row.label || ''),
      phone: String(row.phone || ''),
      active: Boolean(row.active),
      mode,
      windows,
      days: compatibility.days,
      startTime: compatibility.startTime,
      endTime: compatibility.endTime,
      weekInterval: compatibility.weekInterval,
      activeThisWeek: compatibility.activeThisWeek,
      anchorWeekStart: compatibility.anchorWeekStart,
      timezone: compatibility.timezone,
      allowedNow: Boolean(row.active) && contactScheduleAllowed(row, personalRows, defaultCore),
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
  if (input.enabled && daysMask === 0) throw new Error('Select at least one day for the shared office-hours text schedule.');
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
    windows?: BreakdownSmsContactScheduleWindowInput[];
    // Legacy one-window fields remain accepted during rolling deployment.
    days?: number[];
    startTime?: string;
    endTime?: string;
    weekInterval?: BreakdownSmsWeekInterval;
    activeThisWeek?: boolean;
  },
  updatedByUserId: number,
) {
  const contactId = Number(input.contactId);
  if (!Number.isInteger(contactId) || contactId <= 0) throw new Error('Choose a valid breakdown text user.');
  const mode = contactMode(input.mode);
  const existing = await contactScheduleRow(db, contactId);
  if (!existing) throw new Error('Breakdown text user was not found.');

  let replaceWindows = Array.isArray(input.windows);
  let windowInputs = Array.isArray(input.windows) ? input.windows : undefined;
  if (!windowInputs && mode === 'custom') {
    replaceWindows = true;
    windowInputs = [{
      label: 'Personal coverage',
      days: Array.isArray(input.days) ? input.days : [],
      startTime: String(input.startTime || ''),
      endTime: String(input.endTime || ''),
      weekInterval: weekInterval(input.weekInterval),
      activeThisWeek: input.activeThisWeek !== false,
    }];
  }

  if (windowInputs && windowInputs.length > MAX_BREAKDOWN_SMS_PERSONAL_WINDOWS) {
    throw new Error(`A person can have up to ${MAX_BREAKDOWN_SMS_PERSONAL_WINDOWS} personal coverage windows.`);
  }
  const normalizedWindows = windowInputs?.map(normalizeWindowInput) || [];
  if (mode === 'custom' && normalizedWindows.length === 0) {
    throw new Error('Add at least one personal coverage window for this person.');
  }

  const first = normalizedWindows[0];
  const legacyDaysMask = first?.daysMask ?? Number(existing.days_mask || 127);
  const legacyStartMinute = first?.startMinute ?? Number(existing.start_minute || 0);
  const legacyEndMinute = first?.endMinute ?? Number(existing.end_minute || 0);
  const legacyWeekInterval = first?.weekInterval ?? weekInterval(existing.week_interval);
  const legacyAnchor = first?.anchorWeekStart ?? (anchorWeekStart(existing.anchor_week_start) || null);
  const legacyTimezone = first?.timezone ?? String(existing.timezone || BREAKDOWN_SMS_TIMEZONE);

  const statements: D1PreparedStatement[] = [
    db.prepare(`
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
      legacyDaysMask,
      legacyStartMinute,
      legacyEndMinute,
      legacyWeekInterval,
      legacyAnchor,
      legacyTimezone,
      updatedByUserId,
    ),
  ];

  if (replaceWindows) {
    statements.push(db.prepare(`
      DELETE FROM breakdown_sms_contact_schedule_windows
      WHERE contact_id=?
    `).bind(contactId));

    normalizedWindows.forEach((window, index) => {
      statements.push(db.prepare(`
        INSERT INTO breakdown_sms_contact_schedule_windows(
          contact_id,label,days_mask,start_minute,end_minute,week_interval,anchor_week_start,
          timezone,sort_order,created_at,updated_at,updated_by_user_id
        ) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)
      `).bind(
        contactId,
        window.label,
        window.daysMask,
        window.startMinute,
        window.endMinute,
        window.weekInterval,
        window.anchorWeekStart,
        window.timezone,
        index,
        updatedByUserId,
      ));
    });
  }

  await db.batch(statements);
}

export async function breakdownSmsScheduleAllows(db: D1Database, contactId?: number) {
  const defaultRow = await scheduleRow(db);
  const defaultCore = defaultScheduleCore(defaultRow);
  if (!contactId) return isBreakdownSmsScheduleAllowed(defaultCore);

  const [row, personalRows] = await Promise.all([
    contactScheduleRow(db, contactId),
    contactScheduleWindowRows(db, contactId),
  ]);
  if (!row) return isBreakdownSmsScheduleAllowed(defaultCore);
  return contactScheduleAllowed(row, personalRows, defaultCore);
}
