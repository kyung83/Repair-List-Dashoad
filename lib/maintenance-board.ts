import { completeAnnual } from './annual-schedules';
import { recordPmCompletion } from './pm-schedules';

type MaintenanceRow = {
  id: number;
  unit: string;
  equipment_type: string;
  current_mileage: number | null;
  driver: string | null;
  location: string | null;
  profile_name: string | null;
  mileage_interval: number | null;
  time_interval_days: number | null;
  pm_type: string | null;
  last_mileage: number | null;
  service_date: string | null;
  annual_interval_days: number | null;
  annual_active: number | null;
  annual_date: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(date: string | null, intervalDays: number | null) {
  if (!date || !intervalDays) return null;
  const start = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(start)) return null;
  const due = start + intervalDays * DAY_MS;
  return Math.ceil((due - Date.now()) / DAY_MS);
}

function maintenanceType(row: MaintenanceRow) {
  return row.equipment_type === 'trailer' ? 'Trailer' : 'Truck';
}

export async function getMaintenanceBoardItems(db: D1Database) {
  const result = await db.prepare(`
    SELECT e.id, e.unit, e.equipment_type, e.current_mileage, e.driver, e.location,
           p.name AS profile_name, s.mileage_interval, s.time_interval_days,
           ps.pm_type, ps.last_mileage, COALESCE(ps.service_date, e.service_date) AS service_date,
           a.interval_days AS annual_interval_days, a.active AS annual_active,
           COALESCE(ps.annual_date, e.annual_date) AS annual_date
    FROM equipment e
    LEFT JOIN equipment_pm_settings s ON s.equipment_id = e.id
    LEFT JOIN pm_profiles p ON p.id = s.profile_id
    LEFT JOIN pm_status ps ON ps.equipment_id = e.id
    LEFT JOIN equipment_annual_settings a ON a.equipment_id = e.id
    WHERE e.active = 1
    ORDER BY e.unit
  `).all<MaintenanceRow>();

  const repairs: Array<Record<string, unknown>> = [];

  for (const row of result.results) {
    if (row.profile_name) {
      const mileageDue = row.mileage_interval != null && row.last_mileage != null
        ? Number(row.last_mileage) + Number(row.mileage_interval)
        : null;
      const milesRemaining = mileageDue != null && row.current_mileage != null
        ? mileageDue - Number(row.current_mileage)
        : null;
      const timeRemaining = daysUntil(row.service_date, row.time_interval_days == null ? null : Number(row.time_interval_days));
      const overdue = (milesRemaining != null && milesRemaining <= 0) || (timeRemaining != null && timeRemaining <= 0);
      const dueSoon = (milesRemaining != null && milesRemaining <= 1000) || (timeRemaining != null && timeRemaining <= 30);

      if (overdue || dueSoon) {
        const nextType = row.pm_type || (row.profile_name.includes('40') ? '40' : 'Service');
        const dueBits: string[] = [];
        if (mileageDue != null) dueBits.push(`${mileageDue.toLocaleString()} mi`);
        if (timeRemaining != null) dueBits.push(timeRemaining <= 0 ? `${Math.abs(timeRemaining)} day(s) overdue` : `in ${timeRemaining} day(s)`);
        repairs.push({
          id: `pm-${row.id}`,
          unit: row.unit,
          issue: `${nextType} PM due${dueBits.length ? ` — ${dueBits.join(' or ')}` : ''}`,
          parts: '',
          status: overdue ? 'PM Overdue' : 'PM Due Soon',
          driver: row.driver ?? '',
          location: row.location ?? '',
          maintenanceKind: 'pm',
          equipmentType: maintenanceType(row),
        });
      }
    }

    if (row.annual_active !== 0 && row.annual_interval_days != null && row.annual_date) {
      const annualRemaining = daysUntil(row.annual_date, Number(row.annual_interval_days));
      if (annualRemaining != null && annualRemaining <= 45) {
        repairs.push({
          id: `annual-${row.id}`,
          unit: row.unit,
          issue: annualRemaining <= 0
            ? `Annual / inspection overdue by ${Math.abs(annualRemaining)} day(s)`
            : `Annual / inspection due in ${annualRemaining} day(s)`,
          parts: '',
          status: annualRemaining <= 0 ? 'Annual Overdue' : 'Annual Due Soon',
          driver: row.driver ?? '',
          location: row.location ?? '',
          maintenanceKind: 'annual',
          equipmentType: maintenanceType(row),
        });
      }
    }
  }

  return repairs;
}

export async function completeMaintenanceBoardItem(db: D1Database, idValue: unknown) {
  const id = String(idValue ?? '');
  const pmMatch = id.match(/^pm-(\d+)$/);
  if (pmMatch) return recordPmCompletion(db, { equipmentId: Number(pmMatch[1]) });

  const annualMatch = id.match(/^annual-(\d+)$/);
  if (annualMatch) return completeAnnual(db, { equipmentId: Number(annualMatch[1]) });

  return null;
}
