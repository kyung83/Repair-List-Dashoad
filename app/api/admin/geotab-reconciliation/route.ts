import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type EquipmentRow = {
  id: number;
  unit: string;
  equipment_type: string | null;
  geotab_device_id: string | null;
  vin: string | null;
  current_mileage: number | null;
  mileage_updated_at: string | null;
  active: number;
  archived_at: string | null;
  repair_count: number;
  completed_repair_count: number;
};

type QueueRow = {
  geotab_device_id: string;
  serial_number: string | null;
  geotab_name: string;
  vin: string | null;
  reason: string;
  candidate_equipment_ids: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

type MileageRow = {
  id: number;
  equipment_id: number;
  unit: string;
  geotab_device_id: string;
  serial_number: string | null;
  previous_mileage: number | null;
  incoming_mileage: number;
  raw_mileage: number | null;
  adjusted_mileage: number | null;
  previous_updated_at: string | null;
  reason: string;
  created_at: string;
  mileage_offset: number | null;
};

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (user.role !== 'admin') {
    return { user: null, response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  }
  return { user, response: null };
}

function equipmentDto(row: EquipmentRow) {
  return {
    id: Number(row.id),
    unit: row.unit,
    equipmentType: row.equipment_type ?? '',
    geotabDeviceId: row.geotab_device_id,
    vin: row.vin,
    currentMileage: row.current_mileage === null ? null : Number(row.current_mileage),
    mileageUpdatedAt: row.mileage_updated_at,
    active: Boolean(row.active),
    archivedAt: row.archived_at,
    repairCount: Number(row.repair_count ?? 0),
    completedRepairCount: Number(row.completed_repair_count ?? 0),
  };
}

function parseCandidateIds(value: string | null) {
  if (!value) return [] as number[];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

async function equipmentRowsByIds(ids: number[]) {
  if (!ids.length) return [] as EquipmentRow[];
  const placeholders = ids.map(() => '?').join(',');
  const result = await env.DB.prepare(`
    SELECT
      e.id, e.unit, e.equipment_type, e.geotab_device_id, e.vin,
      e.current_mileage, e.mileage_updated_at, e.active, e.archived_at,
      (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id = e.id) AS repair_count,
      (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id = e.id AND r.status = 'Completed') AS completed_repair_count
    FROM equipment e
    WHERE e.id IN (${placeholders})
    ORDER BY e.active DESC, repair_count DESC, e.unit COLLATE NOCASE, e.id
  `).bind(...ids).all<EquipmentRow>();
  return result.results;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const url = new URL(request.url);
    const search = String(url.searchParams.get('q') ?? '').trim();

    const [queueResult, mileageResult, forkResult] = await Promise.all([
      env.DB.prepare(`
        SELECT geotab_device_id, serial_number, geotab_name, vin, reason,
               candidate_equipment_ids, first_seen_at, last_seen_at
        FROM geotab_reconciliation_queue
        WHERE status = 'open'
        ORDER BY last_seen_at DESC, geotab_name COLLATE NOCASE
        LIMIT 200
      `).all<QueueRow>(),
      env.DB.prepare(`
        SELECT
          a.id, a.equipment_id, e.unit, a.geotab_device_id, a.serial_number,
          a.previous_mileage, a.incoming_mileage, a.raw_mileage, a.adjusted_mileage,
          a.previous_updated_at, a.reason, a.created_at,
          d.mileage_offset
        FROM geotab_mileage_anomalies a
        JOIN equipment e ON e.id = a.equipment_id
        LEFT JOIN equipment_geotab_devices d
          ON d.equipment_id = a.equipment_id
         AND d.geotab_device_id = a.geotab_device_id
         AND d.current = 1
        WHERE a.status = 'pending'
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 200
      `).all<MileageRow>(),
      env.DB.prepare(`
        SELECT
          e.id, e.unit, e.equipment_type, e.geotab_device_id, e.vin,
          e.current_mileage, e.mileage_updated_at, e.active, e.archived_at,
          (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id = e.id) AS repair_count,
          (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id = e.id AND r.status = 'Completed') AS completed_repair_count
        FROM equipment e
        WHERE e.geotab_device_id IS NOT NULL
          AND TRIM(e.geotab_device_id) <> ''
          AND e.geotab_device_id IN (
            SELECT geotab_device_id
            FROM equipment
            WHERE geotab_device_id IS NOT NULL AND TRIM(geotab_device_id) <> ''
            GROUP BY geotab_device_id
            HAVING COUNT(*) > 1
          )
        ORDER BY e.geotab_device_id, e.active DESC, repair_count DESC, e.id
        LIMIT 1000
      `).all<EquipmentRow>(),
    ]);

    const candidateIds = [...new Set(queueResult.results.flatMap((row) => parseCandidateIds(row.candidate_equipment_ids)))];
    const candidateRows = await equipmentRowsByIds(candidateIds);
    const candidateById = new Map(candidateRows.map((row) => [Number(row.id), equipmentDto(row)]));

    const forkGroups = new Map<string, ReturnType<typeof equipmentDto>[]>();
    for (const row of forkResult.results) {
      const deviceId = row.geotab_device_id ?? '';
      const group = forkGroups.get(deviceId) ?? [];
      group.push(equipmentDto(row));
      forkGroups.set(deviceId, group);
    }

    let equipmentSearch: ReturnType<typeof equipmentDto>[] = [];
    if (search.length >= 2) {
      const like = `%${search.replace(/[%_]/g, '')}%`;
      const result = await env.DB.prepare(`
        SELECT
          e.id, e.unit, e.equipment_type, e.geotab_device_id, e.vin,
          e.current_mileage, e.mileage_updated_at, e.active, e.archived_at,
          (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id = e.id) AS repair_count,
          (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id = e.id AND r.status = 'Completed') AS completed_repair_count
        FROM equipment e
        WHERE e.unit LIKE ? COLLATE NOCASE
           OR COALESCE(e.vin, '') LIKE ? COLLATE NOCASE
           OR COALESCE(e.geotab_device_id, '') LIKE ? COLLATE NOCASE
        ORDER BY e.active DESC, e.unit COLLATE NOCASE
        LIMIT 25
      `).bind(like, like, like).all<EquipmentRow>();
      equipmentSearch = result.results.map(equipmentDto);
    }

    return Response.json({
      identityQueue: queueResult.results.map((row) => ({
        geotabDeviceId: row.geotab_device_id,
        serialNumber: row.serial_number,
        geotabName: row.geotab_name,
        vin: row.vin,
        reason: row.reason,
        candidateEquipmentIds: parseCandidateIds(row.candidate_equipment_ids),
        candidates: parseCandidateIds(row.candidate_equipment_ids)
          .map((id) => candidateById.get(id))
          .filter(Boolean),
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
      })),
      mileageQueue: mileageResult.results.map((row) => ({
        id: Number(row.id),
        equipmentId: Number(row.equipment_id),
        unit: row.unit,
        geotabDeviceId: row.geotab_device_id,
        serialNumber: row.serial_number,
        previousMileage: row.previous_mileage === null ? null : Number(row.previous_mileage),
        incomingMileage: Number(row.incoming_mileage),
        rawMileage: row.raw_mileage === null ? null : Number(row.raw_mileage),
        adjustedMileage: row.adjusted_mileage === null ? null : Number(row.adjusted_mileage),
        previousUpdatedAt: row.previous_updated_at,
        reason: row.reason,
        createdAt: row.created_at,
        mileageOffset: row.mileage_offset === null ? 0 : Number(row.mileage_offset),
      })),
      historicalForks: [...forkGroups.entries()].map(([geotabDeviceId, rows]) => ({ geotabDeviceId, rows })),
      equipmentSearch,
      summary: {
        identityOpen: queueResult.results.length,
        mileageOpen: mileageResult.results.length,
        historicalForkGroups: forkGroups.size,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_reconciliation_load_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab review could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const note = String(body.note ?? '').trim().slice(0, 500) || null;

    if (action === 'resolveIdentity') {
      const geotabDeviceId = String(body.geotabDeviceId ?? '').trim();
      const equipmentId = Number(body.equipmentId);
      if (!geotabDeviceId) throw new Error('Geotab device ID is required.');
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) throw new Error('Choose a valid equipment record.');

      const [queue, equipment, activeOwner, currentAssignmentOwner] = await Promise.all([
        env.DB.prepare(`
          SELECT geotab_device_id, serial_number, geotab_name, vin
          FROM geotab_reconciliation_queue
          WHERE geotab_device_id = ? AND status = 'open'
        `).bind(geotabDeviceId).first<{
          geotab_device_id: string; serial_number: string | null; geotab_name: string; vin: string | null;
        }>(),
        env.DB.prepare(`
          SELECT id, unit, archived_at FROM equipment WHERE id = ?
        `).bind(equipmentId).first<{ id: number; unit: string; archived_at: string | null }>(),
        env.DB.prepare(`
          SELECT id, unit FROM equipment
          WHERE geotab_device_id = ? AND active = 1 AND id <> ?
          ORDER BY id LIMIT 1
        `).bind(geotabDeviceId, equipmentId).first<{ id: number; unit: string }>(),
        env.DB.prepare(`
          SELECT d.equipment_id, e.unit
          FROM equipment_geotab_devices d
          JOIN equipment e ON e.id = d.equipment_id
          WHERE d.geotab_device_id = ? AND d.current = 1 AND d.equipment_id <> ?
          ORDER BY d.id DESC LIMIT 1
        `).bind(geotabDeviceId, equipmentId).first<{ equipment_id: number; unit: string }>(),
      ]);
      if (!queue) throw new Error('That Geotab review item is no longer open.');
      if (!equipment) throw new Error('Equipment record was not found.');
      if (equipment.archived_at) throw new Error('Restore the archived equipment record before linking a live Geotab device to it.');
      if (currentAssignmentOwner) {
        throw new Error(`This device is already assigned to ${currentAssignmentOwner.unit}. Resolve that assignment before moving it.`);
      }
      if (activeOwner) {
        throw new Error(`This device is already active on ${activeOwner.unit}. Resolve that historical fork before moving it.`);
      }

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE equipment_geotab_devices
          SET current = 0, ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP), last_seen_at = CURRENT_TIMESTAMP
          WHERE current = 1 AND equipment_id = ? AND geotab_device_id <> ?
        `).bind(equipmentId, geotabDeviceId),
        env.DB.prepare(`
          UPDATE equipment_geotab_devices
          SET current = 1,
              ended_at = NULL,
              serial_number = COALESCE(?, serial_number),
              geotab_name = COALESCE(?, geotab_name),
              vin_seen = COALESCE(?, vin_seen),
              linked_by = 'admin-review',
              last_seen_at = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id
            FROM equipment_geotab_devices
            WHERE equipment_id = ? AND geotab_device_id = ?
            ORDER BY id DESC
            LIMIT 1
          )
        `).bind(queue.serial_number, queue.geotab_name, queue.vin, equipmentId, geotabDeviceId),
        env.DB.prepare(`
          INSERT INTO equipment_geotab_devices (
            equipment_id, geotab_device_id, serial_number, geotab_name, vin_seen,
            assigned_at, last_seen_at, current, linked_by
          )
          SELECT ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'admin-review'
          WHERE NOT EXISTS (
            SELECT 1 FROM equipment_geotab_devices
            WHERE equipment_id = ? AND geotab_device_id = ? AND current = 1
          )
        `).bind(
          equipmentId, geotabDeviceId, queue.serial_number, queue.geotab_name, queue.vin,
          equipmentId, geotabDeviceId,
        ),
        env.DB.prepare(`
          UPDATE equipment
          SET geotab_device_id = ?, active = 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND archived_at IS NULL
            AND EXISTS (
              SELECT 1 FROM equipment_geotab_devices
              WHERE equipment_id = ? AND geotab_device_id = ? AND current = 1
            )
        `).bind(geotabDeviceId, equipmentId, equipmentId, geotabDeviceId),
        env.DB.prepare(`
          UPDATE geotab_reconciliation_queue
          SET status = 'resolved', resolved_equipment_id = ?, resolved_at = CURRENT_TIMESTAMP,
              resolved_by_user_id = ?, resolution_note = ?
          WHERE geotab_device_id = ?
            AND status = 'open'
            AND EXISTS (
              SELECT 1 FROM equipment_geotab_devices
              WHERE equipment_id = ? AND geotab_device_id = ? AND current = 1
            )
        `).bind(equipmentId, auth.user.id, note, geotabDeviceId, equipmentId, geotabDeviceId),
      ]);
      return Response.json({ ok: true, geotabDeviceId, equipmentId });
    }

    if (action === 'calibrateMileage') {
      const anomalyId = Number(body.anomalyId);
      const trustedMileage = Number(body.trustedMileage);
      if (!Number.isInteger(anomalyId) || anomalyId <= 0) throw new Error('Mileage review item could not be resolved.');
      if (!Number.isFinite(trustedMileage) || trustedMileage < 0) throw new Error('Trusted mileage must be zero or greater.');
      const anomaly = await env.DB.prepare(`
        SELECT id, equipment_id, geotab_device_id, incoming_mileage, raw_mileage
        FROM geotab_mileage_anomalies
        WHERE id = ? AND status = 'pending'
      `).bind(anomalyId).first<{
        id: number; equipment_id: number; geotab_device_id: string; incoming_mileage: number; raw_mileage: number | null;
      }>();
      if (!anomaly) throw new Error('That mileage review item is no longer pending.');
      const assignment = await env.DB.prepare(`
        SELECT id FROM equipment_geotab_devices
        WHERE equipment_id = ? AND geotab_device_id = ? AND current = 1
      `).bind(anomaly.equipment_id, anomaly.geotab_device_id).first<{ id: number }>();
      if (!assignment) throw new Error('The Geotab device is no longer the current assignment for this unit.');
      const rawMileage = anomaly.raw_mileage === null ? Number(anomaly.incoming_mileage) : Number(anomaly.raw_mileage);
      const offset = Math.round(trustedMileage) - rawMileage;
      const trusted = Math.round(trustedMileage);

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE equipment_geotab_devices
          SET mileage_offset = ?, mileage_calibrated_at = CURRENT_TIMESTAMP,
              mileage_calibrated_by_user_id = ?, last_seen_at = CURRENT_TIMESTAMP
          WHERE id = ? AND current = 1
        `).bind(offset, auth.user.id, assignment.id),
        env.DB.prepare(`
          UPDATE equipment
          SET current_mileage = ?, mileage_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(trusted, anomaly.equipment_id),
        env.DB.prepare(`
          UPDATE geotab_mileage_anomalies
          SET status = 'accepted', trusted_mileage = ?, reviewed_at = CURRENT_TIMESTAMP,
              reviewed_by_user_id = ?, review_note = ?
          WHERE id = ? AND status = 'pending'
        `).bind(trusted, auth.user.id, note, anomalyId),
      ]);
      return Response.json({ ok: true, anomalyId, trustedMileage: trusted, mileageOffset: offset });
    }

    if (action === 'dismissMileage') {
      const anomalyId = Number(body.anomalyId);
      if (!Number.isInteger(anomalyId) || anomalyId <= 0) throw new Error('Mileage review item could not be resolved.');
      const result = await env.DB.prepare(`
        UPDATE geotab_mileage_anomalies
        SET status = 'dismissed', reviewed_at = CURRENT_TIMESTAMP,
            reviewed_by_user_id = ?, review_note = ?
        WHERE id = ? AND status = 'pending'
      `).bind(auth.user.id, note, anomalyId).run();
      if (!result.meta.changes) throw new Error('That mileage review item is no longer pending.');
      return Response.json({ ok: true, anomalyId });
    }

    return Response.json({ error: 'Unknown Geotab review action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_reconciliation_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab review action failed.' }, { status: 400 });
  }
}
