// This module changes LOCAL hardware links only. It never deletes equipment,
// changes sale status or odometers, moves repair history, or calls MyGeotab.
export class GeotabReleaseError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function requireReleaseAdmin(user) {
  if (!user) throw new GeotabReleaseError('Authentication required.', 401);
  if (user.role !== 'admin' || user.dispatchAccess) {
    throw new GeotabReleaseError('Administrator access is required.', 403);
  }
}

const SELECT_LINK = `
  SELECT e.id, e.unit, e.vin, e.active, e.archived_at,
         COALESCE(e.geotab_device_id, '') AS legacy_device_id,
         a.id AS assignment_id, COALESCE(a.assigned_at, '') AS assignment_started_at,
         COALESCE(a.geotab_device_id, '') AS current_device_id,
         COALESCE(a.serial_number, '') AS serial_number
  FROM equipment e
  LEFT JOIN equipment_geotab_devices a ON a.equipment_id=e.id AND a.current=1
  WHERE e.merged_into_equipment_id IS NULL
`;

function version(row) {
  // A background mileage refresh must not invalidate this hardware-only version.
  return JSON.stringify([Number(row.id), row.unit, row.legacy_device_id,
    Number(row.assignment_id || 0), row.current_device_id, row.assignment_started_at]);
}

function dto(row) {
  return {
    equipmentId: Number(row.id), unit: row.unit, vin: row.vin || '',
    archived: !row.active || Boolean(row.archived_at),
    deviceId: row.current_device_id || row.legacy_device_id,
    assignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
    serialNumber: row.serial_number,
    legacyOnly: !row.current_device_id && Boolean(row.legacy_device_id),
    conflict: Boolean(row.current_device_id && row.legacy_device_id
      && row.current_device_id !== row.legacy_device_id),
    expectedVersion: version(row),
  };
}

export async function searchGeotabReleaseLinks(db, user, query) {
  requireReleaseAdmin(user);
  const q = String(query || '').trim().replace(/[%_]/g, '').slice(0, 120);
  if (!q) return [];
  const like = `%${q}%`;
  const result = await db.prepare(`${SELECT_LINK}
    AND (COALESCE(e.geotab_device_id,'')<>'' OR a.id IS NOT NULL)
    AND (e.unit LIKE ? COLLATE NOCASE OR COALESCE(e.vin,'') LIKE ? COLLATE NOCASE
      OR COALESCE(e.geotab_device_id,'') LIKE ? COLLATE NOCASE
      OR COALESCE(a.geotab_device_id,'') LIKE ? COLLATE NOCASE
      OR COALESCE(a.serial_number,'') LIKE ? COLLATE NOCASE)
    ORDER BY e.unit COLLATE NOCASE, e.id LIMIT 50
  `).bind(like, like, like, like, like).all();
  return result.results.map(dto);
}

export async function releaseGeotabDevice(db, user, body) {
  requireReleaseAdmin(user);
  const id = Number(body.equipmentId);
  const deviceId = String(body.geotabDeviceId || '').trim();
  if (!Number.isSafeInteger(id) || id <= 0) throw new GeotabReleaseError('Choose a valid equipment record.');
  if (!/^[a-z0-9._:-]{1,160}$/i.test(deviceId)) throw new GeotabReleaseError('Choose a valid Geotab device.');
  if (body.confirmedRemoved !== true) throw new GeotabReleaseError('Confirm that the GPS was physically removed.');
  const row = await db.prepare(`${SELECT_LINK} AND e.id=?`).bind(id).first();
  if (!row) throw new GeotabReleaseError('Equipment was not found or has been merged.', 404);
  const item = dto(row);
  if (!item.deviceId) throw new GeotabReleaseError('This unit has no GPS link to release. Refresh the device list.', 409);
  if (item.conflict) throw new GeotabReleaseError('This unit has conflicting device links. Correct its device assignment before releasing it.', 409);
  if (item.deviceId !== deviceId || body.expectedVersion !== item.expectedVersion) {
    throw new GeotabReleaseError('The GPS assignment changed. Search again before releasing it.', 409);
  }
  const eventId = crypto.randomUUID();
  const reason = String(body.reason || 'GPS physically removed for reuse').trim().slice(0, 500);
  let results;
  try {
    results = await db.batch([
      // CHECK failure rolls back the whole D1 batch if the source link changed
      // after the read above. Never close a different truck's assignment.
      db.prepare(`INSERT INTO geotab_device_release_events (
        id,equipment_id,unit,geotab_device_id,previous_assignment_id,
        previous_legacy_device_id,released_by_user_id,reason,guard_verified
      ) VALUES (?,?,?,?,?,?,?,?,CASE WHEN EXISTS (
        SELECT 1 FROM equipment e
        LEFT JOIN equipment_geotab_devices a ON a.equipment_id=e.id AND a.current=1
        WHERE e.id=? AND e.unit=? AND e.merged_into_equipment_id IS NULL
          AND COALESCE(e.geotab_device_id,'')=?
          AND COALESCE(a.id,0)=? AND COALESCE(a.geotab_device_id,'')=?
          AND COALESCE(a.assigned_at,'')=?
      ) THEN 1 ELSE 0 END)`)
        .bind(eventId,id,row.unit,deviceId,row.assignment_id,row.legacy_device_id || null,
          user.id,reason,id,row.unit,row.legacy_device_id,
          Number(row.assignment_id || 0),row.current_device_id,row.assignment_started_at),
      db.prepare(`UPDATE equipment_geotab_devices
        SET current=0, ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP)
        WHERE equipment_id=? AND id=? AND geotab_device_id=? AND current=1`)
        .bind(id,Number(row.assignment_id || 0),deviceId),
      db.prepare(`UPDATE equipment SET geotab_device_id=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND geotab_device_id=?`).bind(id,deviceId),
      db.prepare(`SELECT e.id,e.unit FROM equipment_geotab_devices a
        JOIN equipment e ON e.id=a.equipment_id
        WHERE a.current=1 AND a.geotab_device_id=? AND a.equipment_id<>?`)
        .bind(deviceId,id),
    ]);
  } catch (error) {
    if (/CHECK constraint failed.*guard_verified/i.test(String(error))) {
      throw new GeotabReleaseError('The GPS assignment changed while releasing it. Nothing was changed; search again.', 409);
    }
    throw error;
  }
  const owner = results[3]?.results?.[0];
  return {
    ok: true, equipmentId: id, unit: row.unit, geotabDeviceId: deviceId,
    alreadyAssignedTo: owner?.unit || '',
    message: owner
      ? `Removed the old GPS link from ${row.unit}. Its current assignment to ${owner.unit} was left unchanged.`
      : `GPS released from ${row.unit}. Its history and status are unchanged. Refresh Geotab devices on the replacement unit before assigning this GPS.`,
  };
}
