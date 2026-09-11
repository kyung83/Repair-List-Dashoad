export const BREAKDOWN_SMS_AWAY_TIMEZONE = 'America/Detroit';

export function breakdownSmsLocalDateKey(date = new Date(), timeZone = BREAKDOWN_SMS_AWAY_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isBreakdownSmsAwayPeriodActive(period, date = new Date(), timeZone = BREAKDOWN_SMS_AWAY_TIMEZONE) {
  if (!period || period.active === false || Number(period.active) === 0) return false;
  const startDate = String(period.startDate ?? period.start_date ?? '').trim();
  const endDate = String(period.endDate ?? period.end_date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  const currentDate = breakdownSmsLocalDateKey(date, timeZone);
  return currentDate >= startDate && currentDate <= endDate;
}
