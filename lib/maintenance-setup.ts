import { PM_CATEGORIES } from './pm-schedules';

type ProfileRow = { id: number; name: string; sequence_json: string };
type PresetRow = {
  category: string;
  profile_id: number | null;
  profile_name: string | null;
  mileage_interval: number | null;
  time_interval_days: number | null;
  annual_interval_days: number | null;
};
type EquipmentRow = {
  id: number;
  unit: string;
  category: string;
  equipment_type: string;
  current_mileage: number | null;
  geotab_device_id: string | null;
  make: string | null;
  model: string | null;
  driver: string | null;
  location: string | null;
  profile_id: number | null;
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

type ApplyPreset = {
  category: string;
  profileId: number | null;
  sequence: string[];
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  annualIntervalDays: number | null;
};

type PresetEquipmentRow = {
  id: number;
  equipment_type: string;
  current_mileage: number | null;
  last_mileage: number | null;
  service_date: string | null;
};

type CorrectionEquipmentRow = {
  id: number;
  equipment_type: string;
  profile_id: number | null;
  sequence_json: string | null;
};

const SQL_ID_BATCH_SIZE = 75;

function sequence(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function positiveOptional(value: unknown, label: string) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive whole number.`);
  return number;
}

function nonNegativeOptional(value: unknown, label: string) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be zero or a positive whole number.`);
  return number;
}

function positive(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} is required.`);
  return number;
}

function optionalDate(value: unknown, label: string) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return text;
}

function selectedIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Select at least one unit.');
  const ids = [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Error('Select at least one unit.');
  if (ids.length > 2000) throw new Error('Select no more than 2,000 units at once.');
  return ids;
}

function validateCategory(value: unknown) {
  const category = String(value ?? '').trim();
  if (!(PM_CATEGORIES as readonly string[]).includes(category)) throw new Error('Choose a valid maintenance category.');
  return category;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += SQL_ID_BATCH_SIZE) {
    await db.batch(statements.slice(index, index + SQL_ID_BATCH_SIZE));
  }
}

async function loadActiveEquipmentByIds(db: D1Database, ids: number[]) {
  const rows: Array<{ id: number; equipment_type: string }> = [];
  for (let index = 0; index < ids.length; index += SQL_ID_BATCH_SIZE) {
    const chunk = ids.slice(index, index + SQL_ID_BATCH_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db.prepare(`
      SELECT id, equipment_type
      FROM equipment
      WHERE active = 1 AND id IN (${placeholders})
    `).bind(...chunk).all<{ id: number; equipment_type: string }>();
    rows.push(...result.results);
  }
  return rows;
}

async function loadPresetEquipmentRows(db: D1Database, ids: number[]) {
  const rows: PresetEquipmentRow[] = [];
  for (let index = 0; index < ids.length; index += SQL_ID_BATCH_SIZE) {
    const chunk = ids.slice(index, index + SQL_ID_BATCH_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db.prepare(`
      SELECT e.id, e.equipment_type, e.current_mileage,
             ps.last_mileage, COALESCE(ps.service_date, e.service_date) AS service_date
      FROM equipment e
      LEFT JOIN pm_status ps ON ps.equipment_id = e.id
      WHERE e.active = 1 AND e.id IN (${placeholders})
    `).bind(...chunk).all<PresetEquipmentRow>();
    rows.push(...result.results);
  }
  return rows;
}

async function applyPresetToIds(db: D1Database, preset: ApplyPreset, ids: number[]) {
  if (!ids.length) return;
  const rows = await loadPresetEquipmentRows(db, ids);

  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    if (preset.profileId == null) {
      statements.push(db.prepare('DELETE FROM equipment_pm_settings WHERE equipment_id = ?').bind(row.id));
    } else {
      statements.push(db.prepare(`
        INSERT INTO equipment_pm_settings (
          equipment_id, profile_id, mileage_interval, time_interval_days, annual_required, updated_at
        ) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(equipment_id) DO UPDATE SET
          profile_id = excluded.profile_id,
          mileage_interval = excluded.mileage_interval,
          time_interval_days = excluded.time_interval_days,
          annual_required = 0,
          updated_at = CURRENT_TIMESTAMP
      `).bind(row.id, preset.profileId, preset.mileageInterval, preset.timeIntervalDays));

      statements.push(db.prepare(`
        INSERT INTO pm_status (equipment_id, pm_type, status, last_mileage, service_date, updated_at)
        VALUES (?, ?, 'Scheduled', ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(equipment_id) DO UPDATE SET
          pm_type = excluded.pm_type,
          status = 'Scheduled',
          last_mileage = COALESCE(pm_status.last_mileage, excluded.last_mileage),
          service_date = COALESCE(pm_status.service_date, excluded.service_date),
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        row.id,
        preset.sequence[0] ?? '40',
        row.last_mileage ?? row.current_mileage,
        row.service_date ?? today(),
      ));
    }

    if (preset.annualIntervalDays == null) {
      statements.push(db.prepare(`
        UPDATE equipment_annual_settings
        SET active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE equipment_id = ?
      `).bind(row.id));
    } else {
      statements.push(db.prepare(`
        INSERT INTO equipment_annual_settings (equipment_id, interval_days, active, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(equipment_id) DO UPDATE SET
          interval_days = excluded.interval_days,
          active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(row.id, preset.annualIntervalDays));
    }
  }
  await runBatches(db, statements);
}

export async function getMaintenanceSetup(db: D1Database) {
  const [profiles, presets, equipment] = await Promise.all([
    db.prepare(`
      SELECT id, name, sequence_json
      FROM pm_profiles
      WHERE active = 1
      ORDER BY CASE name
        WHEN 'Rotating 40-20A-20B' THEN 0
        WHEN 'Strict 40 PM' THEN 1
        WHEN 'Strict 40 NY PM' THEN 1
        WHEN 'Trailer Service' THEN 2
        ELSE 3
      END, name
    `).all<ProfileRow>(),
    db.prepare(`
      SELECT c.category, c.profile_id, p.name AS profile_name,
             c.mileage_interval, c.time_interval_days, c.annual_interval_days
      FROM pm_category_presets c
      LEFT JOIN pm_profiles p ON p.id = c.profile_id
      WHERE c.active = 1
      ORDER BY c.category
    `).all<PresetRow>(),
    db.prepare(`
      SELECT e.id, e.unit, e.category, e.equipment_type, e.current_mileage, e.geotab_device_id,
             e.make, e.model, e.driver, e.location,
             s.profile_id, p.name AS profile_name, s.mileage_interval, s.time_interval_days,
             ps.pm_type, ps.last_mileage, COALESCE(ps.service_date, e.service_date) AS service_date,
             a.interval_days AS annual_interval_days, a.active AS annual_active,
             COALESCE(ps.annual_date, e.annual_date) AS annual_date
      FROM equipment e
      LEFT JOIN equipment_pm_settings s ON s.equipment_id = e.id
      LEFT JOIN pm_profiles p ON p.id = s.profile_id
      LEFT JOIN pm_status ps ON ps.equipment_id = e.id
      LEFT JOIN equipment_annual_settings a ON a.equipment_id = e.id
      WHERE e.active = 1
      ORDER BY CASE WHEN e.equipment_type = 'trailer' THEN 1 ELSE 0 END, e.unit
    `).all<EquipmentRow>(),
  ]);

  return {
    categories: [...PM_CATEGORIES],
    profiles: profiles.results.map((row) => ({
      id: row.id,
      name: row.name === 'Strict 40 NY PM' ? 'Strict 40 PM' : row.name,
      sequence: sequence(row.sequence_json),
    })),
    presets: presets.results.map((row) => ({
      category: row.category,
      profileId: row.profile_id,
      profileName: row.profile_name === 'Strict 40 NY PM' ? 'Strict 40 PM' : row.profile_name ?? '',
      mileageInterval: row.mileage_interval == null ? null : Number(row.mileage_interval),
      timeIntervalDays: row.time_interval_days == null ? null : Number(row.time_interval_days),
      annualIntervalDays: row.annual_interval_days == null ? null : Number(row.annual_interval_days),
    })),
    equipment: equipment.results.map((row) => ({
      id: row.id,
      unit: row.unit,
      category: row.equipment_type === 'trailer'
        ? 'Trailers'
        : row.category && row.category.toLowerCase() !== 'fleet' ? row.category : 'Uncategorized',
      equipmentType: row.equipment_type === 'trailer' ? 'Trailer' : 'Vehicle',
      currentMileage: row.current_mileage == null ? null : Number(row.current_mileage),
      mileageSource: row.geotab_device_id ? 'Geotab' : 'Manual',
      make: row.make ?? '',
      model: row.model ?? '',
      driver: row.driver ?? '',
      location: row.location ?? '',
      profileId: row.profile_id,
      profileName: row.profile_name === 'Strict 40 NY PM' ? 'Strict 40 PM' : row.profile_name ?? '',
      mileageInterval: row.mileage_interval == null ? null : Number(row.mileage_interval),
      timeIntervalDays: row.time_interval_days == null ? null : Number(row.time_interval_days),
      nextPmType: row.pm_type ?? '',
      lastMileage: row.last_mileage == null ? null : Number(row.last_mileage),
      lastServiceDate: row.service_date ?? '',
      annualIntervalDays: row.annual_interval_days == null || row.annual_active === 0 ? null : Number(row.annual_interval_days),
      lastAnnualDate: row.annual_date ?? '',
    })),
    updatedAt: new Date().toISOString(),
  };
}

export async function saveCategoryMaintenanceRule(db: D1Database, body: Record<string, unknown>) {
  const category = validateCategory(body.category);
  const profileId = body.profileId == null || String(body.profileId).trim() === '' ? null : positive(body.profileId, 'PM option');
  const mileageInterval = positiveOptional(body.mileageInterval, 'Mileage interval');
  const timeIntervalDays = positiveOptional(body.timeIntervalDays, 'Time interval');
  const annualIntervalDays = positiveOptional(body.annualIntervalDays, 'Annual interval');

  let profile: ProfileRow | null = null;
  let profileSequence: string[] = [];
  if (profileId != null) {
    profile = await db.prepare('SELECT id, name, sequence_json FROM pm_profiles WHERE id = ? AND active = 1')
      .bind(profileId).first<ProfileRow>();
    if (!profile) throw new Error('PM option was not found.');
    profileSequence = sequence(profile.sequence_json);
    if (!profileSequence.length) throw new Error('PM option has no service sequence.');
    if (mileageInterval == null && timeIntervalDays == null) throw new Error('Set mileage, time, or both for the PM rule.');
  }

  const isTrailerCategory = category === 'Trailers';
  const isTrailerProfile = profile?.name === 'Trailer Service';
  if (isTrailerCategory && profileId != null && !isTrailerProfile) throw new Error('Trailers must use Trailer Service or no PM option.');
  if (isTrailerCategory && mileageInterval != null) throw new Error('Trailer service uses time, not mileage.');
  if (!isTrailerCategory && isTrailerProfile) throw new Error('Trailer Service is only for trailers.');

  await db.prepare(`
    INSERT INTO pm_category_presets (
      category, profile_id, mileage_interval, time_interval_days, annual_interval_days, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(category) DO UPDATE SET
      profile_id = excluded.profile_id,
      mileage_interval = excluded.mileage_interval,
      time_interval_days = excluded.time_interval_days,
      annual_interval_days = excluded.annual_interval_days,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(category, profileId, mileageInterval, timeIntervalDays, annualIntervalDays).run();

  const matches = isTrailerCategory
    ? await db.prepare(`SELECT id FROM equipment WHERE active = 1 AND equipment_type = 'trailer'`).all<{ id: number }>()
    : await db.prepare(`SELECT id FROM equipment WHERE active = 1 AND category = ?`).bind(category).all<{ id: number }>();
  const ids = matches.results.map((row) => row.id);

  await applyPresetToIds(db, {
    category,
    profileId,
    sequence: profileSequence,
    mileageInterval,
    timeIntervalDays,
    annualIntervalDays,
  }, ids);

  return { ok: true, category, count: ids.length };
}

export async function assignMaintenanceCategory(db: D1Database, body: Record<string, unknown>) {
  const category = validateCategory(body.category);
  const ids = selectedIds(body.equipmentIds);
  const equipment = await loadActiveEquipmentByIds(db, ids);
  if (equipment.length !== ids.length) throw new Error('One or more selected units are no longer active.');

  if (category === 'Trailers' && equipment.some((row) => row.equipment_type !== 'trailer')) {
    throw new Error('Only trailers can be assigned to the Trailers category.');
  }
  if (category !== 'Trailers' && equipment.some((row) => row.equipment_type === 'trailer')) {
    throw new Error('Trailers stay in the Trailers category.');
  }

  if (category !== 'Trailers') {
    await runBatches(db, ids.map((id) => db.prepare(`
      UPDATE equipment SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(category, id)));
  }

  const preset = await db.prepare(`
    SELECT c.category, c.profile_id, p.sequence_json,
           c.mileage_interval, c.time_interval_days, c.annual_interval_days
    FROM pm_category_presets c
    LEFT JOIN pm_profiles p ON p.id = c.profile_id
    WHERE c.category = ? AND c.active = 1
  `).bind(category).first<{
    category: string;
    profile_id: number | null;
    sequence_json: string | null;
    mileage_interval: number | null;
    time_interval_days: number | null;
    annual_interval_days: number | null;
  }>();

  if (preset) {
    await applyPresetToIds(db, {
      category,
      profileId: preset.profile_id,
      sequence: preset.sequence_json ? sequence(preset.sequence_json) : [],
      mileageInterval: preset.mileage_interval == null ? null : Number(preset.mileage_interval),
      timeIntervalDays: preset.time_interval_days == null ? null : Number(preset.time_interval_days),
      annualIntervalDays: preset.annual_interval_days == null ? null : Number(preset.annual_interval_days),
    }, ids);
  }

  return { ok: true, category, count: ids.length, inheritedRule: Boolean(preset) };
}

export async function correctEquipmentMaintenance(db: D1Database, body: Record<string, unknown>) {
  const equipmentId = positive(body.equipmentId, 'Unit');
  const equipment = await db.prepare(`
    SELECT e.id, e.equipment_type, s.profile_id, p.sequence_json
    FROM equipment e
    LEFT JOIN equipment_pm_settings s ON s.equipment_id = e.id
    LEFT JOIN pm_profiles p ON p.id = s.profile_id
    WHERE e.id = ? AND e.active = 1
  `).bind(equipmentId).first<CorrectionEquipmentRow>();
  if (!equipment) throw new Error('Unit was not found.');

  const lastMileage = equipment.equipment_type === 'trailer'
    ? null
    : nonNegativeOptional(body.lastMileage, 'Last PM mileage');
  const lastServiceDate = optionalDate(body.lastServiceDate, 'Last PM/service date');
  const lastAnnualDate = optionalDate(body.lastAnnualDate, 'Last annual/inspection date');
  const nextPmType = String(body.nextPmType ?? '').trim() || null;

  const allowedSequence = equipment.sequence_json ? sequence(equipment.sequence_json) : [];
  if (nextPmType && !equipment.profile_id) throw new Error('Assign a PM rule before setting the next PM type.');
  if (nextPmType && allowedSequence.length && !allowedSequence.includes(nextPmType)) {
    throw new Error('Choose a next PM type from the unit\'s assigned PM sequence.');
  }

  await db.batch([
    db.prepare(`
      INSERT INTO pm_status (
        equipment_id, pm_type, status, last_mileage, service_date, annual_date, updated_at
      ) VALUES (?, ?, 'Current', ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET
        pm_type = excluded.pm_type,
        status = COALESCE(pm_status.status, 'Current'),
        last_mileage = excluded.last_mileage,
        service_date = excluded.service_date,
        annual_date = excluded.annual_date,
        updated_at = CURRENT_TIMESTAMP
    `).bind(equipmentId, nextPmType, lastMileage, lastServiceDate, lastAnnualDate),
    db.prepare(`
      UPDATE equipment
      SET service_date = ?, annual_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(lastServiceDate, lastAnnualDate, equipmentId),
  ]);

  return {
    ok: true,
    equipmentId,
    lastMileage,
    lastServiceDate,
    nextPmType,
    lastAnnualDate,
  };
}
