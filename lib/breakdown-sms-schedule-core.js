export const BREAKDOWN_SMS_TIMEZONE = 'America/Detroit';

const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DEFAULT_BIWEEKLY_ANCHOR = '1970-01-05';

function padded(value) {
  return String(value).padStart(2, '0');
}

function validDateKey(value) {
  const raw = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return '';
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(stamp)) return '';
  return new Date(stamp).toISOString().slice(0, 10) === raw ? raw : '';
}

function dateKeyStamp(value) {
  const key = validDateKey(value);
  return key ? Date.parse(`${key}T00:00:00Z`) : null;
}

function shiftDateKey(value, days) {
  const stamp = dateKeyStamp(value);
  if (stamp == null) return '';
  return new Date(stamp + Number(days || 0) * DAY_MS).toISOString().slice(0, 10);
}

export function breakdownSmsWeekStartForDateKey(value) {
  const key = validDateKey(value);
  if (!key) return '';
  const stamp = dateKeyStamp(key);
  const weekday = new Date(stamp).getUTCDay();
  return shiftDateKey(key, -((weekday + 6) % 7));
}

function localClock(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || BREAKDOWN_SMS_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value || '';
  const weekday = WEEKDAY_INDEX[value('weekday')];
  const year = Number(value('year'));
  const month = Number(value('month'));
  const dayOfMonth = Number(value('day'));
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  return {
    day: Number.isInteger(weekday) ? weekday : 0,
    minute: hour * 60 + minute,
    dateKey: `${year}-${padded(month)}-${padded(dayOfMonth)}`,
  };
}

export function currentBreakdownSmsWeekStart(date = new Date(), timezone = BREAKDOWN_SMS_TIMEZONE) {
  return breakdownSmsWeekStartForDateKey(localClock(date, timezone).dateKey);
}

export function breakdownSmsAnchorForCurrentWeek(
  activeThisWeek,
  date = new Date(),
  timezone = BREAKDOWN_SMS_TIMEZONE,
) {
  const current = currentBreakdownSmsWeekStart(date, timezone);
  return activeThisWeek === false ? shiftDateKey(current, 7) : current;
}

function normalizedWeekInterval(value) {
  return Number(value) === 2 ? 2 : 1;
}

function normalizedAnchor(value) {
  const key = validDateKey(value);
  return breakdownSmsWeekStartForDateKey(key || DEFAULT_BIWEEKLY_ANCHOR);
}

function weekActiveForDateKey(schedule, dateKey) {
  if (normalizedWeekInterval(schedule?.weekInterval) !== 2) return true;
  const weekStart = breakdownSmsWeekStartForDateKey(dateKey);
  const anchor = normalizedAnchor(schedule?.anchorWeekStart);
  const weekStamp = dateKeyStamp(weekStart);
  const anchorStamp = dateKeyStamp(anchor);
  if (weekStamp == null || anchorStamp == null) return false;
  const weeksApart = Math.round((weekStamp - anchorStamp) / WEEK_MS);
  return ((weeksApart % 2) + 2) % 2 === 0;
}

export function isBreakdownSmsWeekActive(schedule, date = new Date()) {
  const timezone = String(schedule?.timezone || BREAKDOWN_SMS_TIMEZONE);
  return weekActiveForDateKey(schedule, localClock(date, timezone).dateKey);
}

function selected(mask, day) {
  return (Number(mask || 0) & (1 << day)) !== 0;
}

/**
 * Evaluates the day, time, overnight window, and optional every-other-week
 * rotation. For an overnight window, the rotation belongs to the day the
 * window started, so Sunday night remains in Sunday's scheduled week after
 * midnight Monday.
 */
export function isBreakdownSmsScheduleAllowed(schedule, date = new Date()) {
  if (!schedule?.enabled) return true;
  if (!Number(schedule.daysMask || 0)) return false;

  const timezone = String(schedule.timezone || BREAKDOWN_SMS_TIMEZONE);
  const clock = localClock(date, timezone);
  const start = Math.max(0, Math.min(1439, Math.trunc(Number(schedule.startMinute) || 0)));
  const end = Math.max(0, Math.min(1439, Math.trunc(Number(schedule.endMinute) || 0)));
  let windowStartDate = '';

  // Equal times mean a full 24-hour window on each selected day.
  if (start === end) {
    if (selected(schedule.daysMask, clock.day)) windowStartDate = clock.dateKey;
  } else if (start < end) {
    // Same-day window, e.g. 06:00-22:00.
    if (selected(schedule.daysMask, clock.day) && clock.minute >= start && clock.minute < end) {
      windowStartDate = clock.dateKey;
    }
  } else if (clock.minute >= start) {
    // Overnight window before midnight.
    if (selected(schedule.daysMask, clock.day)) windowStartDate = clock.dateKey;
  } else if (clock.minute < end) {
    // Overnight window after midnight belongs to the previous day's rotation.
    const previousDay = (clock.day + 6) % 7;
    if (selected(schedule.daysMask, previousDay)) windowStartDate = shiftDateKey(clock.dateKey, -1);
  }

  return Boolean(windowStartDate) && weekActiveForDateKey(schedule, windowStartDate);
}

/**
 * Shared office hours and personal windows are additive. A contact is eligible
 * when the shared window is open or any one of that person's saved windows is
 * open. This supports, for example, an every-week early shift plus a separate
 * every-other-week overnight on-call block for the same person.
 */
export function isBreakdownSmsCoverageAllowed(
  sharedSchedule,
  personalSchedules = [],
  date = new Date(),
) {
  if (isBreakdownSmsScheduleAllowed(sharedSchedule, date)) return true;
  return Array.isArray(personalSchedules)
    && personalSchedules.some(schedule => isBreakdownSmsScheduleAllowed(schedule, date));
}
