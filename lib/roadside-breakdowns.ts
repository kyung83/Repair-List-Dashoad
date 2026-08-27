import { env } from 'cloudflare:workers';
import { notifyBreakdownEmailGroup, notifyBreakdownGroup } from '@/lib/notifications';
import { resolveBreakdownGeotabSnapshot } from '@/lib/breakdown-geotab-snapshot';
import { normalizeTirePositions } from '@/lib/tire-position-rules.js';

export type BreakdownStage = 1 | 2 | 3 | 4 | 5;
export type UnitType = 'truck' | 'trailer';
export type BreakdownSnapshotVerification = 'verified' | 'corrected' | 'unavailable';
export type ReportedTireDetail = { positionCode: string; tireSize: string };

const BREAKDOWN_ALERT_GROUP = 'Breakdown Alerts';

export class ManualBreakdownSnapshotRequiredError extends Error {
  readonly manualFallbackRequired = true;
  constructor() {
    super('Geotab could not confirm a current driver and location. Enter the driver and location manually to continue.');
    this.name = 'ManualBreakdownSnapshotRequiredError';
  }
}

export type BreakdownRow = {
  id: number;
  repair_id: number;
  equipment_id: number;
  unit: string;
  equipment_type: string;
  driver_name: string;
  state: string;
  city: string;
  repair_category: string;
  repair_needed: string | null;
  description: string;
  stage: BreakdownStage;
  status: string;
  service_provider: string | null;
  service_provider_phone: string | null;
  eta: string | null;
  claimed_by_user_id: number | null;
  claimed_by: string | null;
  on_location_at: string | null;
  cost: number | null;
  snapshot_source: string;
  geotab_driver_id: string | null;
  driver_observed_at: string | null;
  geotab_device_id: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_observed_at: string | null;
  gps_source: string | null;
  snapshot_captured_at: string | null;
  created_at: string;
  updated_at: string;
};

const LIST_SELECT = `
  SELECT
    b.id, b.repair_id, b.equipment_id,
    e.unit AS unit, e.equipment_type AS equipment_type,
    b.driver_name, b.state, b.city, b.repair_category, b.repair_needed, b.description,
    b.stage, b.status, b.service_provider, b.service_provider_phone, b.eta,
    b.claimed_by_user_id, u.display_name AS claimed_by, b.on_location_at,
    r.outside_cost AS cost,
    b.snapshot_source, b.geotab_driver_id, b.driver_observed_at, b.geotab_device_id,
    b.latitude, b.longitude, b.gps_observed_at, b.gps_source, b.snapshot_captured_at,
    b.created_at, b.updated_at
  FROM roadside_breakdowns b
  JOIN repairs r ON r.id = b.repair_id
  JOIN equipment e ON e.id = b.equipment_id
  LEFT JOIN app_users u ON u.id = b.claimed_by_user_id
`;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parsedTimestamp(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function easternTimestamp(value: unknown) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(parsedTimestamp(value));
}

export async function listBreakdowns(opts: { openOnly?: boolean } = {}): Promise<BreakdownRow[]> {
  const where = opts.openOnly ? `WHERE b.stage < 5` : '';
  const result = await env.DB.prepare(`${LIST_SELECT} ${where} ORDER BY b.created_at DESC`).all<BreakdownRow>();
  return result.results;
}

export async function getBreakdown(id: number): Promise<BreakdownRow | null> {
  const row = await env.DB.prepare(`${LIST_SELECT} WHERE b.id = ?`).bind(id).first<BreakdownRow>();
  return row ?? null;
}

/** Finds active equipment by unit number and confirms it matches the type the driver picked (truck vs trailer). */
async function resolveUnit(unit: string, unitType: UnitType): Promise<number> {
  const row = await env.DB.prepare(`SELECT id, equipment_type FROM equipment WHERE unit = ? AND active = 1`)
    .bind(unit.trim()).first<{ id: number; equipment_type: string }>();
  if (!row) throw new Error(`${unitType === 'truck' ? 'Truck' : 'Trailer'} "${unit}" was not found. Check the number and try again.`);
  if (row.equipment_type !== unitType) {
    throw new Error(`"${unit}" is on file as a ${row.equipment_type}, not a ${unitType}. Double-check the number.`);
  }
  return row.id;
}

export async function previewBreakdownGeotab(unitNumber: string, unitType: UnitType) {
  const equipmentId = await resolveUnit(unitNumber, unitType);
  return resolveBreakdownGeotabSnapshot(env, { equipmentId, unitType });
}

export type CreateBreakdownInput = {
  unitType: UnitType;
  unitNumber: string;
  driverName?: string;
  state?: string;
  city?: string;
  snapshotVerification?: BreakdownSnapshotVerification;
  repairCategory: string;
  description: string;
  tireDetails?: ReportedTireDetail[];
  photoObjectKeys?: string[];
};

function validatedTireDetails(input: CreateBreakdownInput) {
  const isTires = input.repairCategory.trim().toUpperCase() === 'TIRES';
  const raw = Array.isArray(input.tireDetails) ? input.tireDetails : [];
  if (!isTires) return [] as ReportedTireDetail[];
  if (!raw.length) throw new Error('Choose at least one tire position and enter its tire size.');

  const normalized = normalizeTirePositions(raw.map((item) => item.positionCode), input.unitType);
  if (normalized.invalid.length) {
    throw new Error(`Invalid tire position for this ${input.unitType}: ${normalized.invalid.join(', ')}.`);
  }

  const byCode = new Map<string, string>();
  for (const item of raw) {
    const code = String(item.positionCode ?? '').trim().toUpperCase();
    const size = String(item.tireSize ?? '').trim().slice(0, 40);
    if (!code) continue;
    if (!size) throw new Error(`Enter the tire size for ${code}.`);
    byCode.set(code, size);
  }

  const details = normalized.positions.map((positionCode) => ({ positionCode, tireSize: byCode.get(positionCode) || '' }));
  if (details.some((item) => !item.tireSize)) throw new Error('Every selected tire position needs a tire size.');
  return details;
}

/**
 * Creates the repairs row plus the roadside_breakdowns detail row. The affected
 * unit is always the selected equipment_id. For trailers, Geotab may privately
 * resolve the currently attached tractor to obtain its driver, but that tractor
 * is never written as another repair/breakdown unit.
 */
export async function createBreakdown(input: CreateBreakdownInput) {
  const equipmentId = await resolveUnit(input.unitNumber, input.unitType);
  const geotabSnapshot = await resolveBreakdownGeotabSnapshot(env, {
    equipmentId,
    unitType: input.unitType,
  });

  const manualDriver = String(input.driverName ?? '').trim().slice(0, 120);
  const manualState = String(input.state ?? '').trim().toUpperCase().slice(0, 2);
  const manualCity = String(input.city ?? '').trim().slice(0, 120);
  const wantsCorrection = input.snapshotVerification === 'corrected';
  const hasManualSnapshot = Boolean(manualDriver && manualState && manualCity);

  if (wantsCorrection && !hasManualSnapshot) {
    throw new Error('Enter the corrected driver, city, and state before submitting.');
  }
  if (!geotabSnapshot && !hasManualSnapshot) {
    throw new ManualBreakdownSnapshotRequiredError();
  }

  const driverName = wantsCorrection ? manualDriver : (geotabSnapshot?.driverName || manualDriver);
  const state = wantsCorrection ? manualState : (geotabSnapshot?.state || manualState);
  const city = wantsCorrection ? manualCity : (geotabSnapshot?.city || manualCity);
  const snapshotSource = geotabSnapshot
    ? (wantsCorrection ? 'geotab-corrected' : 'geotab')
    : 'manual-fallback';
  const snapshotCapturedAt = geotabSnapshot?.capturedAt || new Date().toISOString();
  const tireDetails = validatedTireDetails(input);

  const title = `Roadside breakdown - ${driverName}: ${input.repairCategory}`.slice(0, 500);

  const insertedRepair = await env.DB.prepare(`
    INSERT INTO repairs (equipment_id, title, description, status, priority, source, driver, location)
    VALUES (?, ?, ?, 'open', 'urgent', 'roadside-breakdown', ?, ?)
  `).bind(equipmentId, title, input.description, driverName, `${city}, ${state}`).run();
  const repairId = Number(insertedRepair.meta.last_row_id ?? 0);
  if (!repairId) throw new Error('Could not create the repair record for this breakdown.');

  const insertedBreakdown = await env.DB.prepare(`
    INSERT INTO roadside_breakdowns (
      repair_id, equipment_id, driver_name, state, city, repair_category, description, stage, status,
      snapshot_source, geotab_driver_id, driver_observed_at, geotab_device_id,
      latitude, longitude, gps_observed_at, gps_source, snapshot_captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'reported', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    repairId,
    equipmentId,
    driverName,
    state,
    city,
    input.repairCategory,
    input.description,
    snapshotSource,
    geotabSnapshot?.geotabDriverId ?? null,
    geotabSnapshot?.driverObservedAt ?? null,
    geotabSnapshot?.geotabDeviceId ?? null,
    geotabSnapshot?.latitude ?? null,
    geotabSnapshot?.longitude ?? null,
    geotabSnapshot?.gpsObservedAt ?? null,
    geotabSnapshot?.gpsSource ?? null,
    snapshotCapturedAt,
  ).run();
  const breakdownId = Number(insertedBreakdown.meta.last_row_id ?? 0);
  if (!breakdownId) throw new Error('Could not create the breakdown record.');

  if (tireDetails.length) {
    await env.DB.batch(tireDetails.map((item) => env.DB.prepare(`
      INSERT INTO roadside_breakdown_tires (breakdown_id, repair_id, position_code, tire_size)
      VALUES (?, ?, ?, ?)
    `).bind(breakdownId, repairId, item.positionCode, item.tireSize)));
  }

  if (input.photoObjectKeys?.length) {
    const batch = input.photoObjectKeys.map(key =>
      env.DB.prepare(`INSERT INTO attachments (repair_id, object_key, file_name, content_type) VALUES (?, ?, ?, ?)`)
        .bind(repairId, key, key.split('/').pop() ?? key, 'application/octet-stream')
    );
    await env.DB.batch(batch);
  }

  const created = await getBreakdown(breakdownId);
  const submittedAt = easternTimestamp(created?.created_at || new Date().toISOString());
  const unitLabel = input.unitType === 'truck' ? 'Truck' : 'Trailer';
  const tireMessage = tireDetails.length
    ? `\nTires: ${tireDetails.map((item) => `${item.positionCode} - ${item.tireSize}`).join(', ')}`
    : '';
  const message = `ROADSIDE BREAKDOWN\n\nSubmitted: ${submittedAt}\nDriver: ${driverName}\n${unitLabel}: ${input.unitNumber}\nLocation: ${city}, ${state}\nCategory: ${input.repairCategory}${tireMessage}\n${input.description}\n\nReply ${breakdownId} to claim this breakdown.`;
  const tireHtml = tireDetails.length
    ? `<br><strong>Tires:</strong> ${escapeHtml(tireDetails.map((item) => `${item.positionCode} - ${item.tireSize}`).join(', '))}`
    : '';
  const emailHtml = [
    '<strong>ROADSIDE BREAKDOWN</strong>',
    '',
    `<strong>Submitted:</strong> ${escapeHtml(submittedAt)}`,
    `<strong>Driver:</strong> ${escapeHtml(driverName)}`,
    `<strong>${unitLabel}:</strong> ${escapeHtml(input.unitNumber)}`,
    `<strong>Location:</strong> ${escapeHtml(`${city}, ${state}`)}`,
    `<strong>Category:</strong> ${escapeHtml(input.repairCategory)}${tireHtml}`,
    `<strong>Description:</strong> ${escapeHtml(input.description)}`,
    `<strong>Breakdown #:</strong> ${breakdownId}`,
  ].join('<br>');
  await notifyBreakdownGroup(breakdownId, BREAKDOWN_ALERT_GROUP, message, `Breakdown - ${driverName}`, emailHtml);

  return { breakdownId, repairId, snapshotSource };
}

/** First-reply-wins claim, mirroring the current Twilio SMS-reply behavior. Returns false if already claimed. */
export async function claimBreakdown(breakdownId: number, userId: number | null, claimedByLabel: string) {
  const existing = await env.DB.prepare(`SELECT claimed_by_user_id, status FROM roadside_breakdowns WHERE id = ?`).bind(breakdownId).first<{ claimed_by_user_id: number | null; status: string }>();
  if (!existing) throw new Error('Breakdown not found.');
  if (existing.claimed_by_user_id) return { claimed: false, reason: 'already_claimed' as const };

  await env.DB.prepare(`
    UPDATE roadside_breakdowns
    SET claimed_by_user_id = ?, claimed_at = CURRENT_TIMESTAMP, status = 'assigned', stage = 2, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND claimed_by_user_id IS NULL
  `).bind(userId, breakdownId).run();

  const reload = await env.DB.prepare(`SELECT claimed_by_user_id FROM roadside_breakdowns WHERE id = ?`).bind(breakdownId).first<{ claimed_by_user_id: number | null }>();
  if (reload?.claimed_by_user_id !== userId) return { claimed: false, reason: 'already_claimed' as const };

  await env.DB.prepare(`UPDATE repairs SET status='in_progress', updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT repair_id FROM roadside_breakdowns WHERE id=?)`).bind(breakdownId).run();
  void claimedByLabel;
  return { claimed: true as const };
}

export type UpdateBreakdownInput = Partial<{
  stage: BreakdownStage;
  status: string;
  serviceProvider: string;
  serviceProviderPhone: string;
  eta: string;
  onLocation: boolean;
  cost: number;
}>;

export async function updateBreakdown(breakdownId: number, input: UpdateBreakdownInput) {
  const before = await getBreakdown(breakdownId);
  if (!before) throw new Error('Breakdown not found.');

  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.stage !== undefined) { sets.push('stage = ?'); values.push(input.stage); }
  if (input.status !== undefined) { sets.push('status = ?'); values.push(input.status); }
  if (input.serviceProvider !== undefined) { sets.push('service_provider = ?'); values.push(input.serviceProvider); }
  if (input.serviceProviderPhone !== undefined) { sets.push('service_provider_phone = ?'); values.push(input.serviceProviderPhone); }
  if (input.eta !== undefined) { sets.push('eta = ?'); values.push(input.eta); }
  if (input.onLocation) { sets.push("on_location_at = CURRENT_TIMESTAMP"); }
  if (!sets.length && input.cost === undefined) return;

  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    await env.DB.prepare(`UPDATE roadside_breakdowns SET ${sets.join(', ')} WHERE id = ?`).bind(...values, breakdownId).run();
  }

  if (input.cost !== undefined) {
    await env.DB.prepare(`
      UPDATE repairs SET outside_cost = ?, updated_at=CURRENT_TIMESTAMP
      WHERE id = (SELECT repair_id FROM roadside_breakdowns WHERE id = ?)
    `).bind(input.cost, breakdownId).run();
  }

  if (input.stage === 5) {
    await env.DB.prepare(`
      UPDATE repairs SET status='Completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id = (SELECT repair_id FROM roadside_breakdowns WHERE id = ?)
    `).bind(breakdownId).run();
    await env.DB.prepare(`UPDATE roadside_breakdowns SET status='complete' WHERE id = ?`).bind(breakdownId).run();
  }

  const after = await getBreakdown(breakdownId);
  if (!after) return;
  const providerChanged = input.serviceProvider !== undefined
    && String(before.service_provider || '').trim() !== String(after.service_provider || '').trim();
  const etaChanged = input.eta !== undefined
    && String(before.eta || '').trim() !== String(after.eta || '').trim();
  const provider = String(after.service_provider || '').trim();
  const eta = String(after.eta || '').trim();

  if ((providerChanged || etaChanged) && provider && eta) {
    const unitLabel = String(after.equipment_type || '').toLowerCase() === 'trailer' ? 'Trailer' : 'Truck';
    const submittedAt = easternTimestamp(after.created_at);
    const updatedAt = easternTimestamp(after.updated_at);
    const phoneLine = after.service_provider_phone
      ? `<strong>Provider Phone:</strong> ${escapeHtml(after.service_provider_phone)}<br>`
      : '';
    const updateHtml = [
      '<strong>ROADSIDE BREAKDOWN UPDATE</strong>',
      '',
      `<strong>Updated:</strong> ${escapeHtml(updatedAt)}`,
      `<strong>Original Submitted:</strong> ${escapeHtml(submittedAt)}`,
      `<strong>Driver:</strong> ${escapeHtml(after.driver_name)}`,
      `<strong>${unitLabel}:</strong> ${escapeHtml(after.unit)}`,
      `<strong>Location:</strong> ${escapeHtml(`${after.city}, ${after.state}`)}`,
      `<strong>Service Provider:</strong> ${escapeHtml(provider)}`,
      `${phoneLine}<strong>ETA:</strong> ${escapeHtml(eta)}`,
      `<strong>Breakdown #:</strong> ${after.id}`,
    ].join('<br>');
    await notifyBreakdownEmailGroup(
      breakdownId,
      BREAKDOWN_ALERT_GROUP,
      `Breakdown - ${after.driver_name}`,
      updateHtml,
    );
  }
}

/** Matches an inbound SMS body against an open, unclaimed breakdown ID -- same rule as today's Apps Script webhook. */
export async function findClaimableBreakdownFromSmsBody(body: string): Promise<number | null> {
  const id = Number(String(body).trim());
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await env.DB.prepare(`SELECT id FROM roadside_breakdowns WHERE id = ? AND claimed_by_user_id IS NULL`).bind(id).first<{ id: number }>();
  return row ? row.id : null;
}
