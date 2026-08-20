import { PM_CATEGORIES } from './pm-schedules';
import {
  archiveEquipmentMasterItem as archiveBase,
  getEquipmentMaster,
  restoreEquipmentMasterItem,
} from './equipment-master';

const EQUIPMENT_TYPES = ['truck', 'trailer', 'vehicle', 'forklift', 'glider', 'switcher', 'other'] as const;
const TRAILER_BASE_TYPES = ['Flat Bed', 'Step Deck', 'Conestoga', 'Dry Van'] as const;
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

async function setTracking(db: D1Database, equipmentId: number, enabled: boolean, deviceIdValue: unknown) {
  if (!enabled) {
    await db.batch([
      db.prepare(`
        UPDATE equipment_geotab_devices
        SET current = 0,
            ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
            last_seen_at = CURRENT_TIMESTAMP
        WHERE equipment_id = ? AND current = 1
      `).bind(equipmentId),
      db.prepare(`
        UPDATE equipment SET geotab_device_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(equipmentId),
    ]);
    return;
  }

  const deviceId = text(deviceIdValue, 160);
  if (!deviceId) throw new Error('Choose a Geotab device before enabling Geotab tracking.');

  const existing = await db.prepare(`
    SELECT a.equipment_id, e.unit, e.active, e.archived_at
    FROM equipment_geotab_devices a
    JOIN equipment e ON e.id = a.equipment_id
    WHERE a.current = 1 AND a.geotab_device_id = ?
  `).bind(deviceId).first<{ equipment_id: number; unit: string; active: number; archived_at: string | null }>();

  if (existing && existing.equipment_id !== equipmentId && existing.active === 1 && !existing.archived_at) {
    throw new Error(`That Geotab device is already assigned to ${existing.unit}.`);
  }

  if (existing && existing.equipment_id !== equipmentId) {
    await db.prepare(`
      UPDATE equipment_geotab_devices
      SET current = 0,
          ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
          last_seen_at = CURRENT_TIMESTAMP
      WHERE current = 1 AND geotab_device_id = ?
    `).bind(deviceId).run();
  }

  const same = await db.prepare(`
    SELECT id FROM equipment_geotab_devices
    WHERE equipment_id = ? AND geotab_device_id = ? AND current = 1
  `).bind(equipmentId, deviceId).first<{ id: number }>();

  if (!same) {
    await db.prepare(`
      UPDATE equipment_geotab_devices
      SET current = 0,
          ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
          last_seen_at = CURRENT_TIMESTAMP
      WHERE equipment_id = ? AND current = 1
    `).bind(equipmentId).run();

    await db.prepare(`
      INSERT INTO equipment_geotab_devices (
        equipment_id, geotab_device_id, assigned_at, last_seen_at, current, linked_by
      ) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'equipment-master')
    `).bind(equipmentId, deviceId).run();
  }

  await db.prepare(`
    UPDATE equipment SET geotab_device_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(deviceId, equipmentId).run();
}

export { getEquipmentMaster, restoreEquipmentMasterItem };

export async function saveEquipmentMasterItem(db: D1Database, body: Record<string, unknown>) {
  const id = body.id == null || String(body.id).trim() === '' ? null : positiveId(body.id);
  const unitInput = text(body.unit, 100);
  if (!unitInput) throw new Error('Unit number / asset name is required.');
  const type = equipmentType(body.equipmentType);
  const category = categoryFor(type, body.category);
  const trailerClassification = trailerClassificationFor(type, body.trailerType);
  const modelYear = optionalWholeNumber(body.modelYear, 'Model year', 1900, 2100);
  const requestedMileage = optionalWholeNumber(body.currentMileage, 'Mileage', 0);
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
  const trackingChoiceProvided = Object.prototype.hasOwnProperty.call(body, 'trackWithGeotab');

  if (id == null) {
    const trackWithGeotab = body.trackWithGeotab === true;
    const currentMileage = trackWithGeotab ? null : requestedMileage;
    const result = await db.prepare(`
      INSERT INTO equipment (
        unit, category, equipment_type, trailer_type, trailer_subtype, active,
        current_mileage, mileage_updated_at,
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
    const equipmentId = Number(result.meta.last_row_id);
    if (trackingChoiceProvided) await setTracking(db, equipmentId, trackWithGeotab, body.geotabDeviceId);
    return { ok: true, id: equipmentId, created: true, source: trackWithGeotab ? 'Geotab' : 'Manual' };
  }

  const current = await db.prepare(`
    SELECT e.id, e.current_mileage, e.geotab_device_id,
           EXISTS(
             SELECT 1 FROM equipment_geotab_devices a
             WHERE a.equipment_id = e.id AND a.current = 1
           ) AS tracked
    FROM equipment e
    WHERE e.id = ?
  `).bind(id).first<{ id: number; current_mileage: number | null; geotab_device_id: string | null; tracked: number }>();
  if (!current) throw new Error('Equipment was not found.');

  const trackWithGeotab = trackingChoiceProvided ? body.trackWithGeotab === true : Boolean(current.tracked || current.geotab_device_id);
  const currentMileage = trackWithGeotab ? current.current_mileage : requestedMileage;

  await db.prepare(`
    UPDATE equipment
    SET unit = ?, category = ?, equipment_type = ?, trailer_type = ?, trailer_subtype = ?,
        current_mileage = ?,
        mileage_updated_at = CASE
          WHEN ? = 1 THEN mileage_updated_at
          WHEN ? IS NULL THEN NULL
          ELSE CURRENT_TIMESTAMP
        END,
        vin = ?, license_plate = ?, license_state = ?, model_year = ?,
        make = ?, model = ?, engine = ?, purchase_date = ?, purchase_price = ?, purchased_from = ?,
        driver = ?, location = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    unitInput,
    category,
    type,
    trailerClassification.trailerType,
    trailerClassification.trailerSubtype,
    currentMileage,
    trackWithGeotab ? 1 : 0,
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

  if (trackingChoiceProvided) await setTracking(db, id, trackWithGeotab, body.geotabDeviceId);
  return { ok: true, id, created: false, source: trackWithGeotab ? 'Geotab' : 'Manual' };
}

export async function archiveEquipmentMasterItem(db: D1Database, body: Record<string, unknown>) {
  const id = positiveId(body.id);
  const result = await archiveBase(db, body);
  await db.prepare(`
    UPDATE equipment_geotab_devices
    SET current = 0,
        ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
        last_seen_at = CURRENT_TIMESTAMP
    WHERE equipment_id = ? AND current = 1
  `).bind(id).run();
  return result;
}
