import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  createGeotabClient,
  geotabGet,
  geotabObjectId,
  geotabRecord,
  geotabText,
  type GeotabJsonRecord,
} from '@/lib/geotab-client';
import { syncGeotabFleetMaster } from '@/lib/geotab-fleet';

type SyncUser = Awaited<ReturnType<typeof getSessionUser>>;

type SkippedRow = {
  equipment_id: number;
  unit: string;
  vin: string | null;
  current_mileage: number | null;
  mileage_updated_at: string | null;
  geotab_device_id: string;
  geotab_name: string | null;
  serial_number: string | null;
  last_seen_at: string | null;
};

type OwnerRow = {
  geotab_device_id: string;
  equipment_id: number;
  unit: string;
};

type Candidate = {
  deviceId: string;
  name: string;
  serialNumber: string;
  vin: string;
  assignedEquipmentId: number | null;
  assignedUnit: string;
};

type CurrentAssignmentRow = {
  equipment_id: number;
  unit: string;
  vin: string | null;
  geotab_device_id: string;
};

function dateValue(value: unknown) {
  const raw = geotabText(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeDevice(device: GeotabJsonRecord, now = Date.now()) {
  const id = geotabObjectId(device);
  if (!id || id.toLowerCase() === 'nodeviceid') return false;
  const activeFrom = dateValue(geotabGet(device, 'activeFrom', 'ActiveFrom'));
  const activeTo = dateValue(geotabGet(device, 'activeTo', 'ActiveTo'));
  return (activeFrom == null || activeFrom <= now) && (activeTo == null || activeTo > now);
}

function validVin(value: unknown) {
  const vin = geotabText(value).trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return '';
  if (/^([A-Z0-9])\1{16}$/.test(vin)) return '';
  return vin;
}

function deviceCandidate(device: GeotabJsonRecord, owners: Map<string, OwnerRow>): Candidate | null {
  const deviceId = geotabObjectId(device);
  const vin = validVin(geotabGet(device, 'vehicleIdentificationNumber', 'VehicleIdentificationNumber'));
  if (!deviceId || !vin || !activeDevice(device)) return null;
  const owner = owners.get(deviceId);
  return {
    deviceId,
    name: geotabText(geotabGet(device, 'name', 'Name')).trim() || deviceId,
    serialNumber: geotabText(geotabGet(device, 'serialNumber', 'SerialNumber')).trim(),
    vin,
    assignedEquipmentId: owner ? Number(owner.equipment_id) : null,
    assignedUnit: owner?.unit || '',
  };
}

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Authentication required.' }, { status: 401 }) };
  if (user.role !== 'manager' && user.role !== 'admin') {
    return { user: null, response: Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 }) };
  }
  return { user, response: null };
}

async function dbNow() {
  const row = await env.DB.prepare(`SELECT CURRENT_TIMESTAMP AS now`).first<{ now: string }>();
  return row?.now || new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

async function loadDeviceContext() {
  const [devices, ownerResult] = await Promise.all([
    (await createGeotabClient(env)).call<GeotabJsonRecord[]>('Get', { typeName: 'Device' }),
    env.DB.prepare(`
      SELECT d.geotab_device_id, d.equipment_id, e.unit
      FROM equipment_geotab_devices d
      JOIN equipment e ON e.id = d.equipment_id
      WHERE d.current = 1
    `).all<OwnerRow>(),
  ]);
  const owners = new Map(ownerResult.results.map((row) => [row.geotab_device_id, row]));
  const candidatesByVin = new Map<string, Candidate[]>();
  const devicesById = new Map<string, GeotabJsonRecord>();
  for (const raw of devices) {
    const device = geotabRecord(raw);
    const id = geotabObjectId(device);
    if (id) devicesById.set(id, device);
    const candidate = deviceCandidate(device, owners);
    if (!candidate) continue;
    const list = candidatesByVin.get(candidate.vin) || [];
    list.push(candidate);
    candidatesByVin.set(candidate.vin, list);
  }
  return { devicesById, candidatesByVin, owners };
}

async function skippedAssignmentsSince(startedAt: string) {
  const result = await env.DB.prepare(`
    SELECT
      a.equipment_id,
      e.unit,
      e.vin,
      e.current_mileage,
      e.mileage_updated_at,
      a.geotab_device_id,
      a.geotab_name,
      a.serial_number,
      a.last_seen_at
    FROM equipment_geotab_devices a
    JOIN equipment e ON e.id = a.equipment_id
    WHERE a.current = 1
      AND e.active = 1
      AND e.archived_at IS NULL
      AND lower(COALESCE(e.equipment_type, '')) <> 'trailer'
      AND (a.last_seen_at IS NULL OR a.last_seen_at < ?)
    ORDER BY e.unit COLLATE NOCASE, e.id
  `).bind(startedAt).all<SkippedRow>();
  return result.results;
}

async function buildReview(startedAt: string) {
  const [skipped, context] = await Promise.all([
    skippedAssignmentsSince(startedAt),
    loadDeviceContext(),
  ]);

  return skipped.map((row) => {
    const vin = validVin(row.vin);
    const candidates = vin ? (context.candidatesByVin.get(vin) || []) : [];
    const unassigned = candidates.filter((candidate) => candidate.assignedEquipmentId == null);
    const suggestion = unassigned.length === 1 ? unassigned[0] : null;
    let reason = 'Assigned Geotab device was not active in the current Device list.';
    if (!vin) reason += ' This unit does not have a valid VIN for an automatic exact-VIN suggestion.';
    else if (unassigned.length > 1) reason += ` ${unassigned.length} unassigned active devices share this VIN, so no automatic choice was made.`;
    else if (unassigned.length === 0 && candidates.length === 1 && candidates[0].assignedEquipmentId != null) {
      reason += ` The active exact-VIN device is currently assigned to ${candidates[0].assignedUnit}.`;
    } else if (unassigned.length === 0 && candidates.length === 0) {
      reason += ' No active exact-VIN replacement device was found.';
    }

    return {
      equipmentId: Number(row.equipment_id),
      unit: row.unit,
      vin: row.vin || '',
      currentMileage: row.current_mileage == null ? null : Number(row.current_mileage),
      mileageUpdatedAt: row.mileage_updated_at,
      staleDeviceId: row.geotab_device_id,
      staleDeviceName: row.geotab_name || '',
      staleSerialNumber: row.serial_number || '',
      lastSeenAt: row.last_seen_at,
      reason,
      activeVinCandidates: candidates.length,
      unassignedVinCandidates: unassigned.length,
      suggestion,
    };
  });
}

async function syncAndReview(user: NonNullable<SyncUser>) {
  const startedAt = await dbNow();
  const fleet = await syncGeotabFleetMaster(env);
  const skippedAssignments = await buildReview(startedAt);
  return {
    ok: true,
    fleet,
    skippedAssignments,
    canRepairAssignments: user.role === 'admin',
  };
}

async function repairExactVinAssignment(user: NonNullable<SyncUser>, body: Record<string, unknown>) {
  if (user.role !== 'admin') throw new Error('Administrator access is required to replace a Geotab device assignment.');
  const equipmentId = Number(body.equipmentId);
  const staleDeviceId = String(body.staleDeviceId || '').trim();
  const replacementDeviceId = String(body.replacementDeviceId || '').trim();
  if (!Number.isInteger(equipmentId) || equipmentId <= 0) throw new Error('Unit is invalid.');
  if (!staleDeviceId || !replacementDeviceId) throw new Error('Both the stale and replacement Geotab device IDs are required.');
  if (staleDeviceId === replacementDeviceId) throw new Error('Replacement device must be different from the stale device.');

  const assignment = await env.DB.prepare(`
    SELECT a.equipment_id, e.unit, e.vin, a.geotab_device_id
    FROM equipment_geotab_devices a
    JOIN equipment e ON e.id = a.equipment_id
    WHERE a.current = 1
      AND a.equipment_id = ?
      AND a.geotab_device_id = ?
      AND e.active = 1
      AND e.archived_at IS NULL
    LIMIT 1
  `).bind(equipmentId, staleDeviceId).first<CurrentAssignmentRow>();
  if (!assignment) throw new Error('That stale assignment is no longer current. Run Sync Geotab again.');

  const equipmentVin = validVin(assignment.vin);
  if (!equipmentVin) throw new Error(`${assignment.unit} does not have a valid VIN, so an automatic device replacement is not safe.`);

  const context = await loadDeviceContext();
  const stale = context.devicesById.get(staleDeviceId);
  if (stale && activeDevice(stale)) throw new Error('The current device is active again. Run Sync Geotab before changing the assignment.');

  const exactCandidates = (context.candidatesByVin.get(equipmentVin) || [])
    .filter((candidate) => candidate.assignedEquipmentId == null);
  if (exactCandidates.length !== 1 || exactCandidates[0].deviceId !== replacementDeviceId) {
    throw new Error('The replacement is no longer the one unique unassigned active Geotab device with this exact VIN. Run Sync Geotab again.');
  }
  const replacement = exactCandidates[0];

  const linkedBy = `pm-schedules-exact-vin:${user.id}`;
  const resolutionNote = `Inactive Geotab device ${staleDeviceId} replaced with active exact-VIN device ${replacementDeviceId} for ${assignment.unit}.`;

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE equipment_geotab_devices
      SET current = 0,
          ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
      WHERE current = 1
        AND equipment_id = ?
        AND geotab_device_id = ?
    `).bind(equipmentId, staleDeviceId),
    env.DB.prepare(`
      UPDATE equipment_geotab_devices
      SET current = 1,
          ended_at = NULL,
          assigned_at = CURRENT_TIMESTAMP,
          last_seen_at = CURRENT_TIMESTAMP,
          serial_number = COALESCE(NULLIF(?, ''), serial_number),
          geotab_name = COALESCE(NULLIF(?, ''), geotab_name),
          vin_seen = ?,
          linked_by = ?
      WHERE id = (
        SELECT id
        FROM equipment_geotab_devices
        WHERE equipment_id = ? AND geotab_device_id = ?
        ORDER BY id DESC
        LIMIT 1
      )
    `).bind(replacement.serialNumber, replacement.name, replacement.vin, linkedBy, equipmentId, replacementDeviceId),
    env.DB.prepare(`
      INSERT INTO equipment_geotab_devices (
        equipment_id, geotab_device_id, serial_number, geotab_name, vin_seen,
        assigned_at, last_seen_at, current, linked_by
      )
      SELECT ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM equipment_geotab_devices
        WHERE equipment_id = ? AND geotab_device_id = ? AND current = 1
      )
    `).bind(
      equipmentId,
      replacementDeviceId,
      replacement.serialNumber || null,
      replacement.name,
      replacement.vin,
      linkedBy,
      equipmentId,
      replacementDeviceId,
    ),
    env.DB.prepare(`
      UPDATE equipment
      SET geotab_device_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND active = 1 AND archived_at IS NULL
    `).bind(replacementDeviceId, equipmentId),
    env.DB.prepare(`
      UPDATE geotab_reconciliation_queue
      SET status = 'resolved',
          resolved_equipment_id = ?,
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by_user_id = ?,
          resolution_note = ?
      WHERE geotab_device_id = ? AND status = 'open'
    `).bind(equipmentId, user.id, resolutionNote, replacementDeviceId),
  ]);

  const result = await syncAndReview(user);
  return {
    ...result,
    message: `${assignment.unit} now uses active Geotab device ${replacement.name || replacementDeviceId}. Mileage was re-synced immediately.`,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireManager(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || 'sync');
    if (action === 'sync') return Response.json(await syncAndReview(auth.user), { headers: { 'cache-control': 'no-store' } });
    if (action === 'repairExactVinAssignment') {
      return Response.json(await repairExactVinAssignment(auth.user, body), { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json({ error: 'Unknown Geotab PM sync action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'pm_geotab_sync_review_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Geotab PM sync failed.';
    const status = /Authentication required|Manager or administrator access|Administrator access/.test(message) ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
