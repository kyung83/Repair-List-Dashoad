import { PM_CATEGORIES } from './pm-schedules';

type EquipmentMasterRow = {
  id: number;
  unit: string;
  category: string;
  equipment_type: string;
  trailer_type: string | null;
  trailer_subtype: string | null;
  active: number;
  current_mileage: number | null;
  service_date: string | null;
  annual_date: string | null;
  notes: string | null;
  geotab_device_id: string | null;
  geotab_trailer_id: string | null;
  driver: string | null;
  location: string | null;
  vin: string | null;
  license_plate: string | null;
  license_state: string | null;
  model_year: number | null;
  make: string | null;
  model: string | null;
  engine: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  purchased_from: string | null;
  mileage_updated_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  repair_count: number;
  maintenance_event_count: number;
  historical_ro_count: number;
  expense_count: number;
  last_repair_date: string | null;
};

const EQUIPMENT_TYPES = ['truck', 'trailer', 'vehicle', 'forklift', 'glider', 'switcher', 'other'] as const;
const TRAILER_BASE_TYPES = ['Flat Bed', 'Step Deck', 'Conestoga', 'Dry Van'] as const;
const TRAILER_TYPES = ['Flat Bed', 'Step Deck', 'Conestoga', 'Conestoga Step Deck', 'Dry Van'] as const;
const MAX_TEXT = 500;

function text(value: unknown, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveId(value: unknown, label = 'Equipment') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is required.`);
  return id;
}

function optionalWholeNumber(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} is invalid.`);
  return number;
}

function optionalMoney(value: unknown, label: string) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or greater.`);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function optionalDate(value: unknown, label: string) {
  const candidate = text(value, 10);
  if (!candidate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return candidate;
}

function equipmentType(value: unknown) {
  const candidate = text(value, 40).toLowerCase();
  if (!(EQUIPMENT_TYPES as readonly string[]).includes(candidate)) throw new Error('Choose a valid equipment type.');
  return candidate;
}

function trailerClassificationFor(type: string, value: unknown) {
  if (type !== 'trailer') return { trailerType: null, trailerSubtype: null };
  const candidate = text(value, 40);
  if (candidate === 'Conestoga Step Deck') return { trailerType: 'Conestoga', trailerSubtype: 'Step Deck' };
  if (!(TRAILER_BASE_TYPES as readonly string[]).includes(candidate)) throw new Error('Choose a valid trailer body type.');
  return { trailerType: candidate, trailerSubtype: null };
}

function categoryFor(type: string, value: unknown) {
  if (type === 'trailer') return 'Trailers';
  const candidate = text(value, 80);
  if (!candidate || candidate === 'Uncategorized') return 'fleet';
  if (!(PM_CATEGORIES as readonly string[]).includes(candidate)) throw new Error('Choose a valid PM / equipment group.');
  if (candidate === 'Trailers') throw new Error('Only trailers can use the Trailers group.');
  return candidate;
}

export async function getEquipmentMaster(db: D1Database) {
  const result = await db.prepare(`
    SELECT e.id, e.unit, e.category, e.equipment_type, e.trailer_type, e.trailer_subtype, e.active, e.current_mileage,
           e.service_date, e.annual_date, e.notes, e.geotab_device_id, e.geotab_trailer_id,
           e.driver, e.location, e.vin, e.license_plate, e.license_state, e.model_year,
           e.make, e.model, e.engine, e.purchase_date, e.purchase_price, e.purchased_from,
           e.mileage_updated_at, e.archived_at, e.archive_reason,
           (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id = e.id) AS repair_count,
           (SELECT COUNT(*) FROM maintenance_events m WHERE m.equipment_id = e.id) AS maintenance_event_count,
           (SELECT COUNT(*) FROM historical_repairs h WHERE h.equipment_id = e.id) AS historical_ro_count,
           (SELECT COUNT(*) FROM unit_expenses x WHERE x.equipment_id = e.id) AS expense_count,
           (SELECT MAX(COALESCE(r.completed_at, r.opened_at)) FROM repairs r WHERE r.equipment_id = e.id) AS last_repair_date
    FROM equipment e
    ORDER BY CASE WHEN e.active = 1 AND e.archived_at IS NULL THEN 0 ELSE 1 END,
             e.unit COLLATE NOCASE
  `).all<EquipmentMasterRow>();

  const equipment = result.results.map((row) => {
    const geotab = Boolean(row.geotab_device_id || row.geotab_trailer_id);
    const active = Boolean(row.active) && !row.archived_at;
    const archived = Boolean(row.archived_at) || !Boolean(row.active);
    const trailerType = row.trailer_type === 'Conestoga' && row.trailer_subtype === 'Step Deck'
      ? 'Conestoga Step Deck'
      : row.trailer_type ?? '';
    return {
      id: row.id,
      unit: row.unit,
      category: row.equipment_type === 'trailer'
        ? 'Trailers'
        : row.category && row.category.toLowerCase() !== 'fleet'
          ? row.category
          : 'Uncategorized',
      equipmentType: row.equipment_type,
      trailerType,
      active,
      archived,
      archivedAt: row.archived_at ?? '',
      archiveReason: row.archive_reason ?? (!row.active ? 'Inactive in source system' : ''),
      source: geotab ? 'Geotab' : 'Manual',
      geotabDeviceId: row.geotab_device_id ?? '',
      geotabTrailerId: row.geotab_trailer_id ?? '',
      currentMileage: row.current_mileage == null ? null : Number(row.current_mileage),
      mileageUpdatedAt: row.mileage_updated_at ?? '',
      serviceDate: row.service_date ?? '',
      annualDate: row.annual_date ?? '',
      notes: row.notes ?? '',
      driver: row.driver ?? '',
      location: row.location ?? '',
      vin: row.vin ?? '',
      licensePlate: row.license_plate ?? '',
      licenseState: row.license_state ?? '',
      modelYear: row.model_year == null ? null : Number(row.model_year),
      make: row.make ?? '',
      model: row.model ?? '',
      engine: row.engine ?? '',
      purchaseDate: row.purchase_date ?? '',
      purchasePrice: row.purchase_price == null ? null : Number(row.purchase_price),
      purchasedFrom: row.purchased_from ?? '',
      history: {
        repairs: Number(row.repair_count ?? 0),
        maintenanceEvents: Number(row.maintenance_event_count ?? 0),
        historicalRos: Number(row.historical_ro_count ?? 0),
        expenses: Number(row.expense_count ?? 0),
        lastRepairDate: row.last_repair_date ?? '',
      },
    };
  });

  return {
    equipment,
    categories: [...PM_CATEGORIES],
    equipmentTypes: [...EQUIPMENT_TYPES],
    trailerTypes: [...TRAILER_TYPES],
    summary: {
      total: equipment.length,
      active: equipment.filter((item) => item.active).length,
      archived: equipment.filter((item) => item.archived).length,
      geotab: equipment.filter((item) => item.source === 'Geotab').length,
      manual: equipment.filter((item) => item.source === 'Manual').length,
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function saveEquipmentMasterItem(db: D1Database, body: Record<string, unknown>) {
  const id = body.id == null || String(body.id).trim() === '' ? null : positiveId(body.id);
  const unitInput = text(body.unit, 100);
  if (!unitInput) throw new Error('Unit number / asset name is required.');
  const type = equipmentType(body.equipmentType);
  const category = categoryFor(type, body.category);
  const trailerClassification = trailerClassificationFor(type, body.trailerType);
  const modelYear = optionalWholeNumber(body.modelYear, 'Model year', 1900, 2100);
  const currentMileage = optionalWholeNumber(body.currentMileage, 'Mileage', 0);
  const vin = text(body.vin, 40).toUpperCase();
  const licensePlate = text(body.licensePlate, 40);
  const licenseState = text(body.licenseState, 20).toUpperCase();
  const make = text(body.make, 100);
  const model = text(body.model, 100);
  const engine = text(body.engine, 160);
  const purchaseDate = optionalDate(body.purchaseDate, 'Purchase date');
  const purchasePrice = optionalMoney(body.purchasePrice, 'Purchase price');
  const purchasedFrom = text(body.purchasedFrom, 200);
  const driver = text(body.driver, 160);
  const location = text(body.location, 160);
  const notes = text(body.notes, 2000);

  if (id == null) {
    const result = await db.prepare(`
      INSERT INTO equipment (
        unit, category, equipment_type, trailer_type, trailer_subtype, active, current_mileage, mileage_updated_at,
        vin, license_plate, license_state, model_year, make, model, engine,
        purchase_date, purchase_price, purchased_from,
        driver, location, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      unitInput,
      category,
      type,
      trailerClassification.trailerType,
      trailerClassification.trailerSubtype,
      currentMileage,
      currentMileage,
      vin || null,
      licensePlate || null,
      licenseState || null,
      modelYear,
      make || null,
      model || null,
      engine || null,
      purchaseDate,
      purchasePrice,
      purchasedFrom || null,
      driver || null,
      location || null,
      notes || null,
    ).run();
    return { ok: true, id: Number(result.meta.last_row_id), created: true, source: 'Manual' };
  }

  const current = await db.prepare(`
    SELECT id, unit, geotab_device_id, geotab_trailer_id
    FROM equipment
    WHERE id = ?
  `).bind(id).first<{ id: number; unit: string; geotab_device_id: string | null; geotab_trailer_id: string | null }>();
  if (!current) throw new Error('Equipment was not found.');

  const geotab = Boolean(current.geotab_device_id || current.geotab_trailer_id);
  const unit = geotab ? current.unit : unitInput;

  await db.prepare(`
    UPDATE equipment
    SET unit = ?, category = ?, equipment_type = ?, trailer_type = ?, trailer_subtype = ?, current_mileage = ?,
        mileage_updated_at = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
        vin = ?, license_plate = ?, license_state = ?, model_year = ?,
        make = ?, model = ?, engine = ?, purchase_date = ?, purchase_price = ?, purchased_from = ?,
        driver = ?, location = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    unit,
    category,
    type,
    trailerClassification.trailerType,
    trailerClassification.trailerSubtype,
    currentMileage,
    currentMileage,
    vin || null,
    licensePlate || null,
    licenseState || null,
    modelYear,
    make || null,
    model || null,
    engine || null,
    purchaseDate,
    purchasePrice,
    purchasedFrom || null,
    driver || null,
    location || null,
    notes || null,
    id,
  ).run();

  return { ok: true, id, created: false, source: geotab ? 'Geotab' : 'Manual' };
}

export async function archiveEquipmentMasterItem(db: D1Database, body: Record<string, unknown>) {
  const id = positiveId(body.id);
  const reason = text(body.reason, 1000);
  const result = await db.prepare(`
    UPDATE equipment
    SET active = 0,
        archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
        archive_reason = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(reason || null, id).run();
  if (!result.meta.changes) throw new Error('Equipment was not found.');
  return { ok: true, id, archived: true };
}

export async function restoreEquipmentMasterItem(db: D1Database, body: Record<string, unknown>) {
  const id = positiveId(body.id);
  const result = await db.prepare(`
    UPDATE equipment
    SET active = 1,
        archived_at = NULL,
        archive_reason = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(id).run();
  if (!result.meta.changes) throw new Error('Equipment was not found.');
  return { ok: true, id, archived: false };
}
