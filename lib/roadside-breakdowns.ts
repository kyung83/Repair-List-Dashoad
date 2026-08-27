import { env } from 'cloudflare:workers';
import { notifyBreakdownGroup } from '@/lib/notifications';
import { resolveBreakdownGeotabSnapshot } from '@/lib/breakdown-geotab-snapshot';

export type BreakdownStage = 1 | 2 | 3 | 4 | 5;
export type UnitType = 'truck' | 'trailer';

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

export type CreateBreakdownInput = {
  unitType: UnitType;
  unitNumber: string;
  driverName?: string;
  state?: string;
  city?: string;
  repairCategory: string;
  description: string;
  photoObjectKeys?: string[];
};

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
  if (!geotabSnapshot && (!manualDriver || !manualState || !manualCity)) {
    throw new ManualBreakdownSnapshotRequiredError();
  }

  const driverName = geotabSnapshot?.driverName || manualDriver;
  const state = geotabSnapshot?.state || manualState;
  const city = geotabSnapshot?.city || manualCity;
  const snapshotSource = geotabSnapshot ? 'geotab' : 'manual-fallback';
  const snapshotCapturedAt = geotabSnapshot?.capturedAt || new Date().toISOString();

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

  if (input.photoObjectKeys?.length) {
    const batch = input.photoObjectKeys.map(key =>
      env.DB.prepare(`INSERT INTO attachments (repair_id, object_key, file_name, content_type) VALUES (?, ?, ?, ?)`)
        .bind(repairId, key, key.split('/').pop() ?? key, 'application/octet-stream')
    );
    await env.DB.batch(batch);
  }

  const unitLabel = input.unitType === 'truck' ? 'Truck' : 'Trailer';
  const message = `ROADSIDE BREAKDOWN\n\nDriver: ${driverName}\n${unitLabel}: ${input.unitNumber}\nLocation: ${city}, ${state}\nCategory: ${input.repairCategory}\n${input.description}\n\nReply ${breakdownId} to claim this breakdown.`;
  const emailHtml = message.replace(/\n/g, '<br>');
  await notifyBreakdownGroup(breakdownId, 'Breakdown Alerts', message, `Breakdown Reported - ${driverName}`, emailHtml);

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
      UPDATE repairs SET outside_cost = ?, updated_at = CURRENT_TIMESTAMP
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
}

/** Matches an inbound SMS body against an open, unclaimed breakdown ID -- same rule as today's Apps Script webhook. */
export async function findClaimableBreakdownFromSmsBody(body: string): Promise<number | null> {
  const id = Number(String(body).trim());
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await env.DB.prepare(`SELECT id FROM roadside_breakdowns WHERE id = ? AND claimed_by_user_id IS NULL`).bind(id).first<{ id: number }>();
  return row ? row.id : null;
}
