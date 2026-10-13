/**
 * Productivity here describes the mix of time LOGGED to work orders, not paid
 * hours, attendance, job efficiency, or technician performance against a flat
 * rate standard. Zero recorded hours are shown as N/A, never as 0% productivity.
 */
export function trackedProductivity(directHours, indirectHours) {
  const direct = Number(directHours);
  const indirect = Number(indirectHours);
  if (!Number.isFinite(direct) || !Number.isFinite(indirect) || direct < 0 || indirect < 0) {
    throw new RangeError('Technician labor hours must be valid nonnegative values.');
  }
  const total = direct + indirect;
  const roundHours = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const roundPercent = value => Math.round((value + Number.EPSILON) * 10) / 10;
  return {
    directHours: roundHours(direct),
    indirectHours: roundHours(indirect),
    totalHours: roundHours(total),
    productivityPercent: total > 0 ? roundPercent((direct / total) * 100) : null,
    indirectPercent: total > 0 ? roundPercent((indirect / total) * 100) : null,
  };
}

/**
 * UTC date range follows repair_labor_entries.labor_date, which is saved
 * when a timer stops. Validate the full calendar date, not just its shape.
 */
export function validateLaborReportRange(start, end, maxDays = 366) {
  function utcDay(input) {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      throw new RangeError('Enter both dates in YYYY-MM-DD format.');
    }
    const milliseconds = Date.parse(input + 'T00:00:00Z');
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== input) {
      throw new RangeError('One of the selected dates is invalid.');
    }
    return milliseconds;
  }
  const first = utcDay(start);
  const last = utcDay(end);
  const days = Math.round((last - first) / 86400000) + 1;
  if (days < 1) throw new RangeError('The start date cannot come after the end date.');
  if (days > maxDays) throw new RangeError('Choose up to ' + maxDays + ' days per report.');
  return { startDate: start, endDate: end, days };
}
