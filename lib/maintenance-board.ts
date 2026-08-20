import { completeAnnual } from './annual-schedules';

type MaintenanceRow = {
  id: number;
  unit: string;
  equipment_type: string;
  current_mileage: number | null;
  mileage_updated_at: string | null;
  geotab_tracked: number;
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

type PmCompletionRow = {
  id: number;
  current_mileage: number | null;
  sequence_json: string;
  pm_type: string | null;
};

type MaintenanceRepair = {
  id: string;
  unit: string;
  issue: string;
  parts: string;
  status: string;
  driver: string;
  location: string;
  equipmentType: string;
  relatedGeotabDefectId: string;
  usedParts: never[];
  maintenanceKind: 'pm' | 'annual';
};

const DAY_MS = 24 * 60 * 60 * 1000;
const GEOTAB_MILEAGE_STALE_HOURS = 6;

function daysUntil(date: string | null, intervalDays: number | null) {
  if (!date || !intervalDays) return null;
  const start = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(start)) return null;
  const due = start + intervalDays * DAY_MS;
  return Math.ceil((due - Date.now()) / DAY_MS);
}

function timestampMs(value: string | null) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function mileageAgeHours(value: string | null) {
  const updated = timestampMs(value);
  if (updated == null) return null;
  return Math.max(0, (Date.now() - updated) / 3_600_000);
}

function staleMileageDescription(updatedAt: string | null) {
  const hours = mileageAgeHours(updatedAt);
  if (hours == null) return 'Geotab mileage has never been verified';
  if (hours < 1) return 'Geotab mileage is less than an hour old';
  if (hours < 24) return `Geotab mileage was last verified ${Math.floor(hours)} hour(s) ago`;
  return `Geotab mileage was last verified ${Math.floor(hours / 24)} day(s) ago`;
}

function parseSequence(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function recordMaintenanceEvent(
  db: D1Database,
  equipmentId: number,
  eventType: 'pm' | 'annual',
  eventDate: string,
  pmType: string | null,
  mileage: number | null,
  source = 'repair-board',
) {
  await db.prepare(`
    INSERT OR IGNORE INTO maintenance_events (
      equipment_id, event_type, pm_type, event_date, mileage, source
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(equipmentId, eventType, pmType, eventDate, mileage, source).run();
}

export async function getMaintenanceBoardItems(db: D1Database) {
  const result = await db.prepare(`
    SELECT e.id, e.unit, e.equipment_type, e.current_mileage, e.mileage_updated_at,
           EXISTS(
             SELECT 1 FROM equipment_geotab_devices d
             WHERE d.equipment_id = e.id AND d.current = 1
           ) AS geotab_tracked,
           e.driver, e.location,
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

  const repairs: MaintenanceRepair[] = [];

  for (const row of result.results) {
    if (row.profile_name) {
      const mileageDue = row.mileage_interval != null && row.last_mileage != null
        ? Number(row.last_mileage) + Number(row.mileage_interval)
        : null;
      const ageHours = mileageAgeHours(row.mileage_updated_at);
      const mileageStale = row.geotab_tracked === 1
        && mileageDue != null
        && (ageHours == null || ageHours > GEOTAB_MILEAGE_STALE_HOURS);
      const milesRemaining = !mileageStale && mileageDue != null && row.current_mileage != null
        ? mileageDue - Number(row.current_mileage)
        : null;
      const timeRemaining = daysUntil(row.service_date, row.time_interval_days == null ? null : Number(row.time_interval_days));
      const overdue = (milesRemaining != null && milesRemaining <= 0) || (timeRemaining != null && timeRemaining <= 0);
      const dueSoon = (milesRemaining != null && milesRemaining <= 1000) || (timeRemaining != null && timeRemaining <= 30);

      if (mileageStale || overdue || dueSoon) {
        const nextType = row.pm_type || (row.profile_name.includes('40') ? '40' : 'Service');
        const dueBits: string[] = [];
        if (mileageDue != null && !mileageStale) dueBits.push(`${mileageDue.toLocaleString()} mi`);
        if (timeRemaining != null) dueBits.push(timeRemaining <= 0 ? `${Math.abs(timeRemaining)} day(s) overdue` : `in ${timeRemaining} day(s)`);

        let issue = `${nextType} PM due${dueBits.length ? ` — ${dueBits.join(' or ')}` : ''}`;
        let status = overdue ? 'PM Overdue' : 'PM Due Soon';
        if (mileageStale) {
          const lastMileage = row.current_mileage == null ? 'unknown' : Number(row.current_mileage).toLocaleString();
          const nextMileage = mileageDue == null ? 'unknown' : mileageDue.toLocaleString();
          issue = `MILEAGE STALE — PM STATUS CANNOT BE VERIFIED — ${staleMileageDescription(row.mileage_updated_at)}. Last trusted mileage: ${lastMileage}. Next mileage PM: ${nextMileage}.`;
          if (timeRemaining != null) {
            issue += ` Time schedule is ${timeRemaining <= 0 ? `${Math.abs(timeRemaining)} day(s) overdue` : `due in ${timeRemaining} day(s)`}.`;
          }
          if (!overdue && !dueSoon) status = 'PM Mileage Stale';
        }

        repairs.push({
          id: `pm-${row.id}`,
          unit: row.unit,
          issue,
          parts: '',
          status,
          driver: row.driver ?? '',
          location: row.location ?? '',
          equipmentType: row.equipment_type,
          relatedGeotabDefectId: '',
          usedParts: [],
          maintenanceKind: 'pm',
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
          equipmentType: row.equipment_type,
          relatedGeotabDefectId: '',
          usedParts: [],
          maintenanceKind: 'annual',
        });
      }
    }
  }

  return repairs;
}

async function completePmFromBoard(db: D1Database, equipmentId: number) {
  const row = await db.prepare(`
    SELECT e.id, e.current_mileage, p.sequence_json, ps.pm_type
    FROM equipment e
    JOIN equipment_pm_settings s ON s.equipment_id = e.id
    JOIN pm_profiles p ON p.id = s.profile_id
    LEFT JOIN pm_status ps ON ps.equipment_id = e.id
    WHERE e.id = ? AND e.active = 1
  `).bind(equipmentId).first<PmCompletionRow>();
  if (!row) throw new Error('The PM schedule is no longer active.');

  const serviceSequence = parseSequence(row.sequence_json);
  if (!serviceSequence.length) throw new Error('The PM option has no service sequence.');
  const currentType = row.pm_type && serviceSequence.includes(row.pm_type) ? row.pm_type : serviceSequence[0];
  const currentIndex = Math.max(0, serviceSequence.indexOf(currentType));
  const nextPmType = serviceSequence[(currentIndex + 1) % serviceSequence.length];
  const completedDate = new Date().toISOString().slice(0, 10);

  await db.batch([
    db.prepare(`
      INSERT INTO pm_status (equipment_id, pm_type, status, last_mileage, service_date, updated_at)
      VALUES (?, ?, 'Current', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET
        pm_type = excluded.pm_type,
        status = 'Current',
        last_mileage = COALESCE(excluded.last_mileage, pm_status.last_mileage),
        service_date = excluded.service_date,
        updated_at = CURRENT_TIMESTAMP
    `).bind(equipmentId, nextPmType, row.current_mileage, completedDate),
    db.prepare(`
      UPDATE equipment SET service_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(completedDate, equipmentId),
  ]);

  await recordMaintenanceEvent(db, equipmentId, 'pm', completedDate, currentType, row.current_mileage);
  return { ok: true, equipmentId, completedPmType: currentType, nextPmType, mileage: row.current_mileage, completedDate };
}

export async function completeMaintenanceBoardItem(db: D1Database, idValue: unknown) {
  const id = String(idValue ?? '');
  const pmMatch = id.match(/^pm-(\d+)$/);
  if (pmMatch) return completePmFromBoard(db, Number(pmMatch[1]));

  const annualMatch = id.match(/^annual-(\d+)$/);
  if (annualMatch) {
    const equipmentId = Number(annualMatch[1]);
    const result = await completeAnnual(db, { equipmentId });
    await recordMaintenanceEvent(db, equipmentId, 'annual', result.completedDate, null, null);
    return result;
  }

  return null;
}
