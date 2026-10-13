import { trackedProductivity, validateLaborReportRange } from './technician-productivity-metrics.js';
import { technicianSummarySql, technicianDailySql } from './technician-productivity-sql.js';

type LaborSummary = {
  technician_id: number;
  technician_name: string;
  active: number;
  direct_hours: number;
  indirect_hours: number;
  no_timer_hours: number;
  labor_entries: number;
  logged_days: number;
  direct_repair_count: number;
  indirect_activity_count: number;
};
type DailyLabor = {
  labor_date: string;
  direct_hours: number;
  indirect_hours: number;
  direct_repair_count: number;
  indirect_activity_count: number;
  no_timer_hours: number;
};
type RunningTimer = { technician_id: number; running: number };

export async function getTechnicianProductivity(
  db: D1Database,
  start: string,
  end: string,
  technicianId?: number,
) {
  const range = validateLaborReportRange(start, end);
  if (technicianId !== undefined && (!Number.isInteger(technicianId) || technicianId <= 0)) {
    throw new RangeError('Choose a valid technician.');
  }

  // Stopped timer labor + manual labor rows share this source. Current timers
  // are deliberately excluded until they have a saved elapsed-time entry.
  const [labor, timers] = await Promise.all([
    db.prepare(technicianSummarySql()).bind(range.startDate, range.endDate).all<LaborSummary>(),
    db.prepare('SELECT technician_id, COUNT(*) AS running FROM repair_labor_timers GROUP BY technician_id')
      .all<RunningTimer>(),
  ]);
  const running = new Map(timers.results.map(row => [Number(row.technician_id), Number(row.running || 0)]));
  const technicians = labor.results.map(row => {
    const metrics = trackedProductivity(Number(row.direct_hours || 0), Number(row.indirect_hours || 0));
    return {
      id: Number(row.technician_id),
      name: row.technician_name,
      active: Boolean(row.active),
      ...metrics,
      noTimerHours: Math.round(Number(row.no_timer_hours || 0) * 100) / 100,
      timeEntries: Number(row.labor_entries || 0),
      loggedDays: Number(row.logged_days || 0),
      repairCount: Number(row.direct_repair_count || 0),
      indirectActivities: Number(row.indirect_activity_count || 0),
      runningTimers: running.get(Number(row.technician_id)) ?? 0,
    };
  });

  const sums = technicians.reduce((value, tech) => ({
    direct: value.direct + tech.directHours,
    indirect: value.indirect + tech.indirectHours,
    withoutTimestamps: value.withoutTimestamps + tech.noTimerHours,
    timeEntries: value.timeEntries + tech.timeEntries,
    running: value.running + tech.runningTimers,
    techniciansWithHours: value.techniciansWithHours + (tech.totalHours > 0 ? 1 : 0),
  }), { direct: 0, indirect: 0, withoutTimestamps: 0, timeEntries: 0, running: 0, techniciansWithHours: 0 });

  // Weighted overall percentage: sum direct / sum all logged hours.
  // Do not average technician percentages, and do not treat zero hours as 0%.
  const fleetMetrics = trackedProductivity(sums.direct, sums.indirect);
  let daily: Array<{
    date: string;
    directHours: number;
    indirectHours: number;
    totalHours: number;
    productivityPercent: number | null;
    indirectPercent: number | null;
    repairCount: number;
    indirectActivities: number;
    noTimerHours: number;
  }> = [];

  if (technicianId !== undefined) {
    if (!technicians.some(tech => tech.id === technicianId)) {
      throw new RangeError('This technician has no report data for the selected dates.');
    }
    const result = await db.prepare(technicianDailySql())
      .bind(technicianId, range.startDate, range.endDate).all<DailyLabor>();
    daily = result.results.map(row => ({
      date: row.labor_date,
      ...trackedProductivity(Number(row.direct_hours || 0), Number(row.indirect_hours || 0)),
      repairCount: Number(row.direct_repair_count || 0),
      indirectActivities: Number(row.indirect_activity_count || 0),
      noTimerHours: Math.round(Number(row.no_timer_hours || 0) * 100) / 100,
    }));
  }

  return {
    range,
    metric: 'logged-time productivity',
    formula: 'direct hours / (direct hours + indirect hours) * 100',
    summary: {
      ...fleetMetrics,
      techniciansWithHours: sums.techniciansWithHours,
      techniciansListed: technicians.length,
      timeEntries: sums.timeEntries,
      noTimerHours: Math.round(sums.withoutTimestamps * 100) / 100,
      runningTimers: sums.running,
    },
    technicians,
    selectedTechnicianId: technicianId ?? null,
    daily,
    updatedAt: new Date().toISOString(),
  };
}
