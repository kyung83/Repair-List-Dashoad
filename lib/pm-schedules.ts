export const PM_CATEGORIES = [
  'Shuttle Trucks',
  'Tractors',
  'Company Vehicles',
  'Forklifts',
  'Gliders',
  'Switchers',
  'Trailers',
] as const;

type PmProfileRow = {
  id: number;
  name: string;
  sequence_json: string;
};

type PmEquipmentRow = {
  id: number;
  unit: string;
  category: string;
  equipment_type: string;
  current_mileage: number | null;
  mileage_updated_at: string | null;
  geotab_device_id: string | null;
  make: string | null;
  model: string | null;
  driver: string | null;
  location: string | null;
  profile_id: number | null;
  profile_name: string | null;
  mileage_interval: number | null;
  time_interval_days: number | null;
  annual_required: number | null;
  pm_type: string | null;
  last_mileage: number | null;
  service_date: string | null;
  annual_date: string | null;
};

type PmCompletionRow = {
  equipment_id: number;
  current_mileage: number | null;
  geotab_device_id: string | null;
  mileage_interval: number | null;
  profile_id: number;
  sequence_json: string;
  pm_type: string | null;
};

type PmBaselineRow = {
  id: number;
  equipment_type: string;
  current_mileage: number | null;
  last_mileage: number | null;
  service_date: string | null;
  annual_date: string | null;
};

const PM_ID_BATCH_SIZE = 75;

function finiteInteger(value: unknown, label: string, options: { allowZero?: boolean } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < (options.allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${options.allowZero ? 'zero or a positive whole number' : 'a positive whole number'}.`);
  }
  return number;
}

function optionalInteger(value: unknown, label: string, options: { allowZero?: boolean } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return finiteInteger(value, label, options);
}

function dateOnly(value: unknown, label: string) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return text;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function sequenceFromJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function equipmentIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Select at least one vehicle.');
  const ids = [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
  if (!ids.length) throw new Error('Select at least one vehicle.');
  if (ids.length > 500) throw new Error('Select no more than 500 vehicles at once.');
  return ids;
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += PM_ID_BATCH_SIZE) {
    await db.batch(statements.slice(index, index + PM_ID_BATCH_SIZE));
  }
}

async function loadPmBaselines(db: D1Database, ids: number[]) {
  const rows: PmBaselineRow[] = [];
  for (let index = 0; index < ids.length; index += PM_ID_BATCH_SIZE) {
    const chunk = ids.slice(index, index + PM_ID_BATCH_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db.prepare(`
      SELECT e.id, e.equipment_type, e.current_mileage, ps.last_mileage,
             COALESCE(ps.service_date, e.service_date) AS service_date,
             COALESCE(ps.annual_date, e.annual_date) AS annual_date
      FROM equipment e
      LEFT JOIN pm_status ps ON ps.equipment_id = e.id
      WHERE e.active = 1 AND e.id IN (${placeholders})
    `).bind(...chunk).all<PmBaselineRow>();
    rows.push(...result.results);
  }
  return rows;
}

export async function getPmScheduleData(db: D1Database) {
  const [profilesResult, equipmentResult] = await Promise.all([
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
    `).all<PmProfileRow>(),
    db.prepare(`
      SELECT e.id, e.unit, e.category, e.equipment_type, e.current_mileage, e.mileage_updated_at,
             e.geotab_device_id, e.make, e.model, e.driver, e.location,
             s.profile_id, p.name AS profile_name, s.mileage_interval, s.time_interval_days, s.annual_required,
             ps.pm_type, ps.last_mileage,
             COALESCE(ps.service_date, e.service_date) AS service_date,
             COALESCE(ps.annual_date, e.annual_date) AS annual_date
      FROM equipment e
      LEFT JOIN equipment_pm_settings s ON s.equipment_id = e.id
      LEFT JOIN pm_profiles p ON p.id = s.profile_id
      LEFT JOIN pm_status ps ON ps.equipment_id = e.id
      WHERE e.active = 1
      ORDER BY CASE WHEN e.equipment_type = 'trailer' THEN 1 ELSE 0 END, e.unit
    `).all<PmEquipmentRow>(),
  ]);

  return {
    categories: [...PM_CATEGORIES],
    profiles: profilesResult.results.map((profile) => ({
      id: profile.id,
      name: profile.name === 'Strict 40 NY PM' ? 'Strict 40 PM' : profile.name,
      sequence: sequenceFromJson(profile.sequence_json),
    })),
    equipment: equipmentResult.results.map((row) => {
      const isTrailer = row.equipment_type === 'trailer';
      const storedCategory = String(row.category ?? '').trim();
      const category = isTrailer
        ? 'Trailers'
        : storedCategory && storedCategory.toLowerCase() !== 'fleet'
          ? storedCategory
          : 'Uncategorized';
      return {
        id: row.id,
        unit: row.unit,
        category,
        equipmentType: isTrailer ? 'Trailer' : 'Vehicle',
        currentMileage: row.current_mileage == null ? null : Number(row.current_mileage),
        mileageUpdatedAt: row.mileage_updated_at ?? '',
        mileageSource: row.geotab_device_id ? 'Geotab' : 'Manual',
        make: row.make ?? '',
        model: row.model ?? '',
        driver: row.driver ?? '',
        location: row.location ?? '',
        schedule: row.profile_id == null ? null : {
          profileId: row.profile_id,
          profileName: row.profile_name === 'Strict 40 NY PM' ? 'Strict 40 PM' : row.profile_name ?? '',
          mileageInterval: row.mileage_interval == null ? null : Number(row.mileage_interval),
          timeIntervalDays: row.time_interval_days == null ? null : Number(row.time_interval_days),
          annualRequired: row.annual_required == null ? true : Boolean(row.annual_required),
        },
        nextPmType: row.pm_type ?? '',
        lastMileage: row.last_mileage == null ? null : Number(row.last_mileage),
        lastServiceDate: row.service_date ?? '',
        lastAnnualDate: row.annual_date ?? '',
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

export async function applyPmSchedule(db: D1Database, body: Record<string, unknown>) {
  const ids = equipmentIds(body.equipmentIds);
  const profileId = finiteInteger(body.profileId, 'PM profile');
  const profile = await db.prepare(`
    SELECT id, name, sequence_json FROM pm_profiles WHERE id = ? AND active = 1
  `).bind(profileId).first<PmProfileRow>();
  if (!profile) throw new Error('PM profile was not found.');
  const sequence = sequenceFromJson(profile.sequence_json);
  if (!sequence.length) throw new Error('PM profile does not contain a service sequence.');

  const mileageInterval = optionalInteger(body.mileageInterval, 'Mileage interval');
  const timeIntervalDays = optionalInteger(body.timeIntervalDays, 'Time interval');
  const annualRequired = body.annualRequired === false ? 0 : 1;
  const overrideLastMileage = optionalInteger(body.lastMileage, 'Last PM mileage', { allowZero: true });
  const overrideServiceDate = dateOnly(body.lastServiceDate, 'Last PM/service date');
  const overrideAnnualDate = dateOnly(body.lastAnnualDate, 'Last annual date');

  if (mileageInterval == null && timeIntervalDays == null && annualRequired === 0) {
    throw new Error('Choose a mileage interval, time interval, or annual reminder.');
  }

  const baselines = await loadPmBaselines(db, ids);
  if (baselines.length !== ids.length) throw new Error('One or more selected units are no longer active.');

  const trailerRows = baselines.filter((row) => row.equipment_type === 'trailer');
  const vehicleRows = baselines.filter((row) => row.equipment_type !== 'trailer');
  const isTrailerProfile = profile.name === 'Trailer Service';
  if (isTrailerProfile && vehicleRows.length) throw new Error('Trailer Service can only be assigned to trailers.');
  if (!isTrailerProfile && trailerRows.length) throw new Error('Trailers must use the Trailer Service profile.');
  if (trailerRows.length && mileageInterval != null) throw new Error('Trailer service schedules use time and annual reminders, not mileage.');

  const statements: D1PreparedStatement[] = [];
  for (const row of baselines) {
    const baselineMileage = overrideLastMileage ?? row.last_mileage ?? row.current_mileage;
    const baselineServiceDate = overrideServiceDate ?? row.service_date ?? todayDate();
    const baselineAnnualDate = overrideAnnualDate ?? row.annual_date;

    statements.push(db.prepare(`
      INSERT INTO equipment_pm_settings (
        equipment_id, profile_id, mileage_interval, time_interval_days, annual_required, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        mileage_interval = excluded.mileage_interval,
        time_interval_days = excluded.time_interval_days,
        annual_required = excluded.annual_required,
        updated_at = CURRENT_TIMESTAMP
    `).bind(row.id, profileId, mileageInterval, timeIntervalDays, annualRequired));

    statements.push(db.prepare(`
      INSERT INTO pm_status (
        equipment_id, pm_type, status, last_mileage, service_date, annual_date, updated_at
      ) VALUES (?, ?, 'Scheduled', ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET
        pm_type = excluded.pm_type,
        status = 'Scheduled',
        last_mileage = COALESCE(excluded.last_mileage, pm_status.last_mileage),
        service_date = COALESCE(excluded.service_date, pm_status.service_date),
        annual_date = COALESCE(excluded.annual_date, pm_status.annual_date),
        updated_at = CURRENT_TIMESTAMP
    `).bind(row.id, sequence[0], baselineMileage, baselineServiceDate, baselineAnnualDate));
  }
  await runBatches(db, statements);
  return { ok: true, count: ids.length, profile: profile.name, nextPmType: sequence[0] };
}

export async function setPmEquipmentCategory(db: D1Database, body: Record<string, unknown>) {
  const equipmentId = finiteInteger(body.equipmentId, 'Vehicle');
  const category = String(body.category ?? '').trim();
  const validCategory = (PM_CATEGORIES as readonly string[]).includes(category) || category === 'Uncategorized';
  if (!validCategory) throw new Error('Choose a valid PM category.');

  const equipment = await db.prepare(`SELECT equipment_type FROM equipment WHERE id = ? AND active = 1`)
    .bind(equipmentId).first<{ equipment_type: string }>();
  if (!equipment) throw new Error('Vehicle was not found.');
  const isTrailer = equipment.equipment_type === 'trailer';
  if (isTrailer && category !== 'Trailers') throw new Error('Trailers stay in the Trailers category.');
  if (!isTrailer && category === 'Trailers') throw new Error('Only trailers can use the Trailers category.');

  await db.prepare(`
    UPDATE equipment SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(category === 'Uncategorized' ? 'fleet' : category, equipmentId).run();
  return { ok: true, equipmentId, category };
}

export async function updatePmMileage(db: D1Database, body: Record<string, unknown>) {
  const equipmentId = finiteInteger(body.equipmentId, 'Vehicle');
  const mileage = finiteInteger(body.mileage, 'Mileage', { allowZero: true });
  const result = await db.prepare(`
    UPDATE equipment
    SET current_mileage = ?, mileage_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND active = 1 AND geotab_device_id IS NULL
  `).bind(mileage, equipmentId).run();
  if (!result.meta.changes) throw new Error('Geotab mileage is automatic and cannot be overwritten here.');
  return { ok: true, equipmentId, mileage };
}

export async function recordPmCompletion(db: D1Database, body: Record<string, unknown>) {
  const equipmentId = finiteInteger(body.equipmentId, 'Vehicle');
  const row = await db.prepare(`
    SELECT e.id AS equipment_id, e.current_mileage, e.geotab_device_id,
           s.mileage_interval, s.profile_id, p.sequence_json, ps.pm_type
    FROM equipment e
    JOIN equipment_pm_settings s ON s.equipment_id = e.id
    JOIN pm_profiles p ON p.id = s.profile_id
    LEFT JOIN pm_status ps ON ps.equipment_id = e.id
    WHERE e.id = ? AND e.active = 1
  `).bind(equipmentId).first<PmCompletionRow>();
  if (!row) throw new Error('Assign a PM schedule before recording completion.');

  const sequence = sequenceFromJson(row.sequence_json);
  if (!sequence.length) throw new Error('PM profile does not contain a service sequence.');
  const currentType = row.pm_type && sequence.includes(row.pm_type) ? row.pm_type : sequence[0];
  const currentIndex = Math.max(0, sequence.indexOf(currentType));
  const nextPmType = sequence[(currentIndex + 1) % sequence.length];
  const suppliedMileage = optionalInteger(body.mileage, 'Mileage', { allowZero: true });
  const mileage = row.geotab_device_id ? row.current_mileage : suppliedMileage ?? row.current_mileage;
  if (row.mileage_interval != null && mileage == null) {
    throw new Error('Enter the current mileage before completing this mileage-based PM.');
  }
  const completedDate = dateOnly(body.date, 'Completion date') ?? todayDate();

  const statements = [
    db.prepare(`
      INSERT INTO pm_status (equipment_id, pm_type, status, last_mileage, service_date, updated_at)
      VALUES (?, ?, 'Current', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET
        pm_type = excluded.pm_type,
        status = 'Current',
        last_mileage = excluded.last_mileage,
        service_date = excluded.service_date,
        updated_at = CURRENT_TIMESTAMP
    `).bind(equipmentId, nextPmType, mileage, completedDate),
    db.prepare(`
      UPDATE equipment SET service_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(completedDate, equipmentId),
  ];
  if (!row.geotab_device_id && suppliedMileage != null) {
    statements.push(db.prepare(`
      UPDATE equipment
      SET current_mileage = ?, mileage_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(suppliedMileage, equipmentId));
  }
  await db.batch(statements);
  return { ok: true, equipmentId, completedPmType: currentType, nextPmType, mileage, completedDate };
}

export async function recordAnnualCompletion(db: D1Database, body: Record<string, unknown>) {
  const equipmentId = finiteInteger(body.equipmentId, 'Vehicle');
  const completedDate = dateOnly(body.date, 'Annual date') ?? todayDate();
  await db.batch([
    db.prepare(`
      INSERT INTO pm_status (equipment_id, annual_date, status, updated_at)
      VALUES (?, ?, 'Current', CURRENT_TIMESTAMP)
      ON CONFLICT(equipment_id) DO UPDATE SET
        annual_date = excluded.annual_date,
        status = 'Current',
        updated_at = CURRENT_TIMESTAMP
    `).bind(equipmentId, completedDate),
    db.prepare(`
      UPDATE equipment SET annual_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(completedDate, equipmentId),
  ]);
  return { ok: true, equipmentId, completedDate };
}

export async function clearPmSchedule(db: D1Database, body: Record<string, unknown>) {
  const ids = equipmentIds(body.equipmentIds);
  const statements = ids.map((id) => db.prepare(`DELETE FROM equipment_pm_settings WHERE equipment_id = ?`).bind(id));
  await runBatches(db, statements);
  return { ok: true, count: ids.length };
}
