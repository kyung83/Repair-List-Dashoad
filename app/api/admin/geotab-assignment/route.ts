import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type AssignmentRow = {
  assignment_id: number;
  equipment_id: number;
  unit: string;
  equipment_type: string | null;
  equipment_vin: string | null;
  equipment_active: number;
  archived_at: string | null;
  geotab_device_id: string;
  serial_number: string | null;
  geotab_name: string | null;
  vin_seen: string | null;
  assigned_at: string;
  last_seen_at: string;
};

type TargetRow = {
  id: number;
  unit: string;
  equipment_type: string | null;
  vin: string | null;
  current_device_id: string | null;
  current_device_name: string | null;
};

function cleanSearch(value: string) {
  return value.replace(/[%_]/g, '').trim().slice(0, 120);
}

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Authentication required.' }, { status: 401 }) };
  if (user.role !== 'admin') return { user: null, response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  return { user, response: null };
}

function assignmentDto(row: AssignmentRow) {
  return {
    assignmentId: Number(row.assignment_id),
    equipmentId: Number(row.equipment_id),
    unit: row.unit,
    equipmentType: row.equipment_type ?? '',
    equipmentVin: row.equipment_vin ?? '',
    equipmentActive: Boolean(row.equipment_active),
    archivedAt: row.archived_at,
    geotabDeviceId: row.geotab_device_id,
    serialNumber: row.serial_number ?? '',
    geotabName: row.geotab_name ?? '',
    vinSeen: row.vin_seen ?? '',
    assignedAt: row.assigned_at,
    lastSeenAt: row.last_seen_at,
  };
}

function targetDto(row: TargetRow) {
  return {
    id: Number(row.id),
    unit: row.unit,
    equipmentType: row.equipment_type ?? '',
    vin: row.vin ?? '',
    currentDeviceId: row.current_device_id ?? '',
    currentDeviceName: row.current_device_name ?? '',
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;

    const url = new URL(request.url);
    const assignmentSearch = cleanSearch(String(url.searchParams.get('q') ?? ''));
    const targetSearch = cleanSearch(String(url.searchParams.get('targetQ') ?? ''));

    let assignments: ReturnType<typeof assignmentDto>[] = [];
    if (assignmentSearch) {
      const like = `%${assignmentSearch}%`;
      const result = await env.DB.prepare(`
        SELECT
          a.id AS assignment_id,
          a.equipment_id,
          e.unit,
          e.equipment_type,
          e.vin AS equipment_vin,
          e.active AS equipment_active,
          e.archived_at,
          a.geotab_device_id,
          a.serial_number,
          a.geotab_name,
          a.vin_seen,
          a.assigned_at,
          a.last_seen_at
        FROM equipment_geotab_devices a
        JOIN equipment e ON e.id = a.equipment_id
        WHERE a.current = 1
          AND (
            e.unit LIKE ? COLLATE NOCASE
            OR COALESCE(e.vin, '') LIKE ? COLLATE NOCASE
            OR a.geotab_device_id LIKE ? COLLATE NOCASE
            OR COALESCE(a.geotab_name, '') LIKE ? COLLATE NOCASE
            OR COALESCE(a.serial_number, '') LIKE ? COLLATE NOCASE
            OR COALESCE(a.vin_seen, '') LIKE ? COLLATE NOCASE
          )
        ORDER BY e.active DESC, e.archived_at IS NULL DESC, e.unit COLLATE NOCASE
        LIMIT 50
      `).bind(like, like, like, like, like, like).all<AssignmentRow>();
      assignments = result.results.map(assignmentDto);
    }

    let targets: ReturnType<typeof targetDto>[] = [];
    if (targetSearch) {
      const like = `%${targetSearch}%`;
      const result = await env.DB.prepare(`
        SELECT
          e.id,
          e.unit,
          e.equipment_type,
          e.vin,
          a.geotab_device_id AS current_device_id,
          a.geotab_name AS current_device_name
        FROM equipment e
        LEFT JOIN equipment_geotab_devices a
          ON a.equipment_id = e.id
         AND a.current = 1
        WHERE e.active = 1
          AND e.archived_at IS NULL
          AND (
            e.unit LIKE ? COLLATE NOCASE
            OR COALESCE(e.vin, '') LIKE ? COLLATE NOCASE
          )
        ORDER BY e.unit COLLATE NOCASE, e.id
        LIMIT 50
      `).bind(like, like).all<TargetRow>();
      targets = result.results.map(targetDto);
    }

    return Response.json({ assignments, targets }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_assignment_search_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab assignment search failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (String(body.action ?? '') !== 'reassign') {
      return Response.json({ error: 'Unknown Geotab assignment action.' }, { status: 400 });
    }

    const geotabDeviceId = String(body.geotabDeviceId ?? '').trim().slice(0, 160);
    const sourceEquipmentId = Number(body.sourceEquipmentId);
    const targetEquipmentId = Number(body.targetEquipmentId);
    if (!geotabDeviceId) throw new Error('Geotab device ID is required.');
    if (!Number.isInteger(sourceEquipmentId) || sourceEquipmentId <= 0) throw new Error('Current equipment assignment is required.');
    if (!Number.isInteger(targetEquipmentId) || targetEquipmentId <= 0) throw new Error('Choose the correct target unit.');

    const source = await env.DB.prepare(`
      SELECT
        a.id AS assignment_id,
        a.equipment_id,
        e.unit,
        a.geotab_device_id,
        a.serial_number,
        a.geotab_name,
        a.vin_seen
      FROM equipment_geotab_devices a
      JOIN equipment e ON e.id = a.equipment_id
      WHERE a.current = 1 AND a.geotab_device_id = ?
      LIMIT 1
    `).bind(geotabDeviceId).first<{
      assignment_id: number;
      equipment_id: number;
      unit: string;
      geotab_device_id: string;
      serial_number: string | null;
      geotab_name: string | null;
      vin_seen: string | null;
    }>();
    if (!source) throw new Error('That Geotab device no longer has a current assignment. Refresh and search again.');
    if (Number(source.equipment_id) !== sourceEquipmentId) {
      throw new Error(`That device is now assigned to ${source.unit}. Refresh before moving it.`);
    }
    if (sourceEquipmentId === targetEquipmentId) {
      return Response.json({ ok: true, unchanged: true, message: `${source.unit} is already the current assignment.` });
    }

    const target = await env.DB.prepare(`
      SELECT
        e.id,
        e.unit,
        e.active,
        e.archived_at,
        a.geotab_device_id AS current_device_id,
        a.geotab_name AS current_device_name
      FROM equipment e
      LEFT JOIN equipment_geotab_devices a
        ON a.equipment_id = e.id
       AND a.current = 1
      WHERE e.id = ?
      LIMIT 1
    `).bind(targetEquipmentId).first<{
      id: number;
      unit: string;
      active: number;
      archived_at: string | null;
      current_device_id: string | null;
      current_device_name: string | null;
    }>();
    if (!target) throw new Error('Target equipment was not found.');
    if (!target.active || target.archived_at) throw new Error('The target unit must be active and not archived.');
    if (target.current_device_id && target.current_device_id !== geotabDeviceId) {
      const label = target.current_device_name || target.current_device_id;
      throw new Error(`${target.unit} already has Geotab device ${label}. Change or remove that assignment first so two devices are not silently swapped.`);
    }

    const linkedBy = `admin-diagnostics:${auth.user.id}`;
    const resolutionNote = `Geotab device reassigned in Diagnostics from ${source.unit} (#${sourceEquipmentId}) to ${target.unit} (#${targetEquipmentId}).`;

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE equipment_geotab_devices
        SET current = 0,
            ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
            last_seen_at = CURRENT_TIMESTAMP
        WHERE current = 1 AND geotab_device_id = ?
      `).bind(geotabDeviceId),
      env.DB.prepare(`
        UPDATE equipment
        SET geotab_device_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND geotab_device_id = ?
      `).bind(sourceEquipmentId, geotabDeviceId),
      env.DB.prepare(`
        UPDATE equipment_geotab_devices
        SET current = 1,
            ended_at = NULL,
            assigned_at = CURRENT_TIMESTAMP,
            last_seen_at = CURRENT_TIMESTAMP,
            serial_number = COALESCE(?, serial_number),
            geotab_name = COALESCE(?, geotab_name),
            vin_seen = COALESCE(?, vin_seen),
            linked_by = ?
        WHERE id = (
          SELECT id
          FROM equipment_geotab_devices
          WHERE equipment_id = ? AND geotab_device_id = ?
          ORDER BY id DESC
          LIMIT 1
        )
      `).bind(source.serial_number, source.geotab_name, source.vin_seen, linkedBy, targetEquipmentId, geotabDeviceId),
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
        targetEquipmentId,
        geotabDeviceId,
        source.serial_number,
        source.geotab_name,
        source.vin_seen,
        linkedBy,
        targetEquipmentId,
        geotabDeviceId,
      ),
      env.DB.prepare(`
        UPDATE equipment
        SET geotab_device_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND active = 1 AND archived_at IS NULL
      `).bind(geotabDeviceId, targetEquipmentId),
      env.DB.prepare(`
        UPDATE geotab_reconciliation_queue
        SET status = 'resolved',
            resolved_equipment_id = ?,
            resolved_at = CURRENT_TIMESTAMP,
            resolved_by_user_id = ?,
            resolution_note = ?
        WHERE geotab_device_id = ? AND status = 'open'
      `).bind(targetEquipmentId, auth.user.id, resolutionNote, geotabDeviceId),
    ]);

    const verified = await env.DB.prepare(`
      SELECT d.equipment_id, e.unit
      FROM equipment_geotab_devices d
      JOIN equipment e ON e.id = d.equipment_id
      WHERE d.current = 1 AND d.geotab_device_id = ?
      LIMIT 1
    `).bind(geotabDeviceId).first<{ equipment_id: number; unit: string }>();
    if (!verified || Number(verified.equipment_id) !== targetEquipmentId) {
      throw new Error('The assignment move did not verify. No success was reported.');
    }

    return Response.json({
      ok: true,
      geotabDeviceId,
      fromEquipmentId: sourceEquipmentId,
      fromUnit: source.unit,
      toEquipmentId: targetEquipmentId,
      toUnit: target.unit,
      message: `${source.geotab_name || geotabDeviceId} moved from ${source.unit} to ${target.unit}.`,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_assignment_reassign_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab assignment could not be changed.' }, { status: 400 });
  }
}
