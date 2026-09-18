import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { getAssignedChecklistTemplate } from '@/lib/maintenance-checklist-templates';

type EventType = 'pm' | 'annual';
type MileageSource = 'Geotab' | 'Geotab Stale' | 'Manual' | 'Verified Manual' | 'Unavailable';
type RepairRow = {
  id: number;
  equipment_id: number | null;
  technician_id: number | null;
  source: string;
  status: string;
  unit: string;
  equipment_type: string | null;
  current_mileage: number | null;
  mileage_updated_at: string | null;
  geotab_device_id: string | null;
  mileage_interval: number | null;
};
type RunRow = {
  id: number;
  repair_id: number;
  equipment_id: number;
  event_type: EventType;
  status: 'in_progress' | 'ready' | 'completed';
  mileage_at_start: number | null;
  mileage_at_completion: number | null;
  mileage_source: string | null;
  mileage_updated_at: string | null;
  started_at: string;
  ready_at: string | null;
  completed_at: string | null;
  template_id: number | null;
  template_version: number | null;
};
type ItemRow = {
  id: number;
  item_number: number;
  section: string;
  item_text: string;
  result: 'pending' | 'pass' | 'fail' | 'na';
  notes: string | null;
  updated_at: string;
  corrective_repair_id: number | null;
  corrective_repair_status: string | null;
};
type PhotoRow = {
  id: number;
  checklist_item_id: number;
  object_key: string;
  file_name: string | null;
  content_type: string | null;
  created_at: string;
};
type MutableItemRow = {
  id: number;
  item_text: string;
  result: 'pending' | 'pass' | 'fail' | 'na';
  allow_pass: number;
  allow_fail: number;
  allow_na: number;
  require_notes: number;
  require_photo: number;
  require_measurement: number;
  measurement_value: string | null;
  has_photo: number;
};
type CompletionValidationRow = {
  total: number | null;
  pending: number | null;
  failed: number | null;
  invalid_result: number | null;
  missing_notes: number | null;
  missing_measurement: number | null;
  missing_photo: number | null;
};

const GEOTAB_MILEAGE_STALE_HOURS = 6;

function repairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Maintenance work order was not found.');
  return id;
}

function eventType(source: string): EventType {
  if (source === 'scheduled-pm') return 'pm';
  if (source === 'scheduled-annual') return 'annual';
  throw new Error('Checklists are only available for scheduled PM and annual work orders.');
}

function canManage(user: AppUser) {
  return user.role === 'manager' || user.role === 'admin';
}

function timestampMs(value: string | null) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function geotabMileageFresh(repair: RepairRow) {
  if (!repair.geotab_device_id || repair.current_mileage == null) return false;
  const updated = timestampMs(repair.mileage_updated_at);
  if (updated == null) return false;
  return (Date.now() - updated) / 3_600_000 <= GEOTAB_MILEAGE_STALE_HOURS;
}

function liveMileageSource(repair: RepairRow): MileageSource {
  if (!repair.geotab_device_id) return repair.current_mileage == null ? 'Unavailable' : 'Manual';
  return geotabMileageFresh(repair) ? 'Geotab' : repair.current_mileage == null ? 'Unavailable' : 'Geotab Stale';
}

function storedMileageSource(value: string | null, fallback: MileageSource): MileageSource {
  if (value === 'Geotab' || value === 'Geotab Stale' || value === 'Manual' || value === 'Verified Manual' || value === 'Unavailable') return value;
  return fallback;
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

async function loadRepair(id: number) {
  const row = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.source,'manual') AS source,
           COALESCE(r.status,'') AS status, COALESCE(e.unit,'') AS unit, e.equipment_type,
           e.current_mileage, e.mileage_updated_at, e.geotab_device_id,
           s.mileage_interval
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    LEFT JOIN equipment_pm_settings s ON s.equipment_id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<RepairRow>();
  if (!row) throw new Error('Maintenance work order was not found.');
  eventType(row.source);
  if (!row.equipment_id) throw new Error('This maintenance work order is not linked to equipment.');
  return row;
}

function requireWorkAccess(user: AppUser, repair: RepairRow) {
  if (canManage(user)) return;
  if (user.role !== 'mechanic' || !user.technicianId) throw new Error('Technician access is required.');
  if (Number(repair.technician_id ?? 0) !== Number(user.technicianId)) {
    throw new Error('This maintenance work order is not assigned to you.');
  }
}

async function loadRun(id: number) {
  return env.DB.prepare(`
    SELECT id, repair_id, equipment_id, event_type, status,
           mileage_at_start, mileage_at_completion, mileage_source, mileage_updated_at,
           started_at, ready_at, completed_at, template_id, template_version
    FROM maintenance_checklist_runs
    WHERE repair_id = ?
  `).bind(id).first<RunRow>();
}

async function ensureRun(user: AppUser, repair: RepairRow) {
  requireWorkAccess(user, repair);
  if (String(repair.status).toLowerCase().includes('complete')) throw new Error('That maintenance work order is already completed.');

  // A run that already existed before this deployment is intentionally left alone.
  // Its own item rows remain the source of truth for the rest of that inspection.
  const existing = await loadRun(repair.id);
  if (existing) return existing;

  const kind = eventType(repair.source);
  const source = liveMileageSource(repair);
  const appliesTo = String(repair.equipment_type ?? '').toLowerCase() === 'trailer' ? 'trailer' : 'truck';
  const template = await getAssignedChecklistTemplate(env.DB, kind, appliesTo);

  // D1 batch executes these statements atomically. The unique repair_id on the run
  // plus INSERT OR IGNORE makes simultaneous opens converge on one snapshot. The
  // item INSERT selects only the template id stored on that run, so a concurrent
  // publish cannot mix two template versions into one PM/Annual inspection.
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO maintenance_checklist_runs (
        repair_id, equipment_id, event_type, mileage_at_start, mileage_source,
        mileage_updated_at, started_by_user_id, started_at, updated_at,
        template_id, template_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
    `).bind(
      repair.id,
      repair.equipment_id,
      kind,
      repair.current_mileage,
      source,
      repair.mileage_updated_at,
      user.id,
      template.id,
      template.version,
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO maintenance_checklist_items (
        checklist_run_id, item_number, section, item_text, result,
        allow_pass, allow_fail, allow_na,
        require_notes, require_photo, require_measurement,
        measurement_label, measurement_unit, updated_at
      )
      SELECT
        r.id,
        i.position,
        i.section,
        i.item_text,
        'pending',
        i.allow_pass,
        i.allow_fail,
        i.allow_na,
        i.require_notes,
        i.require_photo,
        i.require_measurement,
        i.measurement_label,
        i.measurement_unit,
        CURRENT_TIMESTAMP
      FROM maintenance_checklist_runs r
      JOIN maintenance_checklist_template_items i ON i.template_id = ?
      WHERE r.repair_id = ?
        AND r.template_id = ?
        AND i.enabled = 1
      ORDER BY i.position
    `).bind(template.id, repair.id, template.id),
  ]);

  const run = await loadRun(repair.id);
  if (!run) throw new Error('Checklist could not be started.');
  return run;
}

function validateItemAnswer(item: MutableItemRow, result: string, notes: string) {
  if (result === 'pending') return;
  if (result === 'pass' && !Boolean(item.allow_pass)) throw new Error('Pass is not allowed for this checklist item.');
  if (result === 'fail' && !Boolean(item.allow_fail)) throw new Error('Fail is not allowed for this checklist item.');
  if (result === 'na' && !Boolean(item.allow_na)) throw new Error('N/A is not allowed for this checklist item.');
  if (result === 'fail' && !notes) throw new Error('Add a note explaining a failed inspection item.');
  if (Boolean(item.require_notes) && !notes) throw new Error('A note is required for this checklist item.');
  if (Boolean(item.require_measurement) && !String(item.measurement_value ?? '').trim()) {
    throw new Error('A measurement is required for this checklist item.');
  }
  if (Boolean(item.require_photo) && !Boolean(item.has_photo)) {
    throw new Error('A photo is required for this checklist item.');
  }
}

async function validateRunForCompletion(runId: number) {
  const validation = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN i.result = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN i.result = 'fail' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE
        WHEN (i.result = 'pass' AND i.allow_pass = 0)
          OR (i.result = 'fail' AND i.allow_fail = 0)
          OR (i.result = 'na' AND i.allow_na = 0)
        THEN 1 ELSE 0 END) AS invalid_result,
      SUM(CASE
        WHEN i.result <> 'pending' AND i.require_notes = 1
          AND COALESCE(TRIM(i.notes), '') = ''
        THEN 1 ELSE 0 END) AS missing_notes,
      SUM(CASE
        WHEN i.result <> 'pending' AND i.require_measurement = 1
          AND COALESCE(TRIM(i.measurement_value), '') = ''
        THEN 1 ELSE 0 END) AS missing_measurement,
      SUM(CASE
        WHEN i.result <> 'pending' AND i.require_photo = 1
          AND NOT EXISTS (
            SELECT 1 FROM maintenance_checklist_photos p
            WHERE p.checklist_item_id = i.id
          )
        THEN 1 ELSE 0 END) AS missing_photo
    FROM maintenance_checklist_items i
    WHERE i.checklist_run_id = ?
  `).bind(runId).first<CompletionValidationRow>();

  if (Number(validation?.total ?? 0) <= 0) throw new Error('This checklist has no inspection items.');
  if (Number(validation?.pending ?? 0) > 0) throw new Error('Finish every checklist item before completing this maintenance job.');
  if (Number(validation?.failed ?? 0) > 0) throw new Error('Failed checklist items must be corrected and changed to Pass before this maintenance job can be completed.');
  if (Number(validation?.invalid_result ?? 0) > 0) throw new Error('One or more checklist answers are not allowed by this inspection version.');
  if (Number(validation?.missing_notes ?? 0) > 0) throw new Error('Add the required notes before completing this maintenance job.');
  if (Number(validation?.missing_measurement ?? 0) > 0) throw new Error('Enter the required measurements before completing this maintenance job.');
  if (Number(validation?.missing_photo ?? 0) > 0) throw new Error('Add the required photos before completing this maintenance job.');
}

function photoUrl(key: string) {
  return `/api/photos/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function correctiveRepairTitle(kind: EventType, itemNumber: number, itemText: string, notes: string) {
  const label = kind === 'annual' ? 'Annual inspection' : 'PM';
  return `${label} checklist #${itemNumber} failed: ${itemText}${notes ? ` - ${notes}` : ''}`.slice(0, 500);
}

async function syncCorrectiveRepair(
  user: AppUser,
  repair: RepairRow,
  itemNumber: number,
  item: MutableItemRow,
  result: string,
  notes: string,
) {
  const equipmentId = Number(repair.equipment_id);
  const kind = eventType(repair.source);

  if (result === 'fail') {
    const title = correctiveRepairTitle(kind, itemNumber, item.item_text, notes);
    const inserted = await env.DB.prepare(`
      INSERT OR IGNORE INTO repairs (
        equipment_id, title, description, status, source, technician_id,
        maintenance_checklist_item_id, opened_at, updated_at
      ) VALUES (?, ?, ?, 'New', 'maintenance-checklist', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(equipmentId, title, notes || null, repair.technician_id, item.id).run();

    await env.DB.prepare(`
      UPDATE repairs
      SET title = ?, description = ?,
          status = CASE
            WHEN lower(COALESCE(status,'')) LIKE '%complete%' THEN 'New'
            ELSE status
          END,
          technician_id = COALESCE(technician_id, ?),
          completed_at = CASE
            WHEN lower(COALESCE(status,'')) LIKE '%complete%' THEN NULL
            ELSE completed_at
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE maintenance_checklist_item_id = ?
        AND equipment_id = ?
        AND source = 'maintenance-checklist'
    `).bind(title, notes || null, repair.technician_id, item.id, equipmentId).run();

    const corrective = await env.DB.prepare(`
      SELECT id FROM repairs
      WHERE maintenance_checklist_item_id = ? AND equipment_id = ?
      LIMIT 1
    `).bind(item.id, equipmentId).first<{ id: number }>();
    if (!corrective) throw new Error('The corrective repair could not be attached to this failed checklist item.');

    if (item.result !== 'fail') {
      const action = Number(inserted.meta.changes ?? 0) > 0
        ? 'created_from_maintenance_checklist'
        : 'reopened_from_maintenance_checklist';
      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        corrective.id,
        user.id,
        user.technicianId,
        action,
        `${kind === 'annual' ? 'Annual' : 'PM'} checklist item #${itemNumber} failed on unit ${repair.unit || equipmentId}.`.slice(0, 500),
      ).run();
    }
    return;
  }

  if (item.result === 'fail' && (result === 'pass' || result === 'na')) {
    const corrective = await env.DB.prepare(`
      SELECT id FROM repairs
      WHERE maintenance_checklist_item_id = ?
        AND equipment_id = ?
        AND source = 'maintenance-checklist'
      LIMIT 1
    `).bind(item.id, equipmentId).first<{ id: number }>();
    if (!corrective) return;

    const completed = await env.DB.prepare(`
      UPDATE repairs
      SET status = 'Completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'
    `).bind(corrective.id).run();
    if (Number(completed.meta.changes ?? 0) > 0) {
      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'completed_from_maintenance_checklist', ?)
      `).bind(
        corrective.id,
        user.id,
        user.technicianId,
        `Checklist item #${itemNumber} changed from Fail to ${result === 'pass' ? 'Pass' : 'N/A'}.`.slice(0, 500),
      ).run();
    }
  }
}

async function payloadFor(repair: RepairRow) {
  const run = await loadRun(repair.id);
  const kind = eventType(repair.source);
  const fresh = geotabMileageFresh(repair);
  const liveSource = liveMileageSource(repair);
  const mileageStale = Boolean(repair.geotab_device_id) && !fresh;
  const mileageEntryAllowed = !repair.geotab_device_id || mileageStale;
  if (!run) {
    const appliesTo = String(repair.equipment_type ?? '').toLowerCase() === 'trailer' ? 'trailer' : 'truck';
    const template = await getAssignedChecklistTemplate(env.DB, kind, appliesTo);
    return {
      repairId: `repair-${repair.id}`,
      equipmentId: repair.equipment_id,
      unit: repair.unit,
      eventType: kind,
      started: false,
      status: 'not_started',
      currentMileage: repair.current_mileage,
      mileageSource: liveSource,
      mileageUpdatedAt: repair.mileage_updated_at,
      mileageEntryAllowed,
      mileageStale,
      items: template.items.filter((item) => item.enabled).map((item) => ({ number: item.position, section: item.section, text: item.text, id: null, result: 'pending', notes: '', photos: [], correctiveRepair: null })),
    };
  }

  const [items, photos] = await Promise.all([
    env.DB.prepare(`
      SELECT i.id, i.item_number, i.section, i.item_text, i.result, i.notes, i.updated_at,
             cr.id AS corrective_repair_id, cr.status AS corrective_repair_status
      FROM maintenance_checklist_items i
      LEFT JOIN repairs cr ON cr.maintenance_checklist_item_id = i.id
      WHERE i.checklist_run_id = ?
      ORDER BY i.item_number
    `).bind(run.id).all<ItemRow>(),
    env.DB.prepare(`
      SELECT id, checklist_item_id, object_key, file_name, content_type, created_at
      FROM maintenance_checklist_photos
      WHERE checklist_run_id = ?
      ORDER BY created_at, id
    `).bind(run.id).all<PhotoRow>(),
  ]);
  const photosByItem = new Map<number, PhotoRow[]>();
  for (const photo of photos.results) {
    const list = photosByItem.get(photo.checklist_item_id) ?? [];
    list.push(photo);
    photosByItem.set(photo.checklist_item_id, list);
  }
  const pending = items.results.filter((item) => item.result === 'pending').length;
  const failed = items.results.filter((item) => item.result === 'fail').length;
  const locked = run.status === 'ready' || run.status === 'completed';
  const displaySource = locked ? storedMileageSource(run.mileage_source, liveSource) : liveSource;
  return {
    repairId: `repair-${repair.id}`,
    equipmentId: repair.equipment_id,
    unit: repair.unit,
    eventType: kind,
    started: true,
    runId: run.id,
    status: run.status,
    currentMileage: locked ? run.mileage_at_completion : repair.current_mileage,
    mileageSource: displaySource,
    mileageUpdatedAt: locked ? run.mileage_updated_at : repair.mileage_updated_at,
    mileageEntryAllowed: !locked && mileageEntryAllowed,
    mileageStale,
    mileageAtStart: run.mileage_at_start,
    mileageAtCompletion: run.mileage_at_completion,
    startedAt: run.started_at,
    readyAt: run.ready_at,
    completedAt: run.completed_at,
    pendingCount: pending,
    failedCount: failed,
    items: items.results.map((item) => ({
      id: item.id,
      number: item.item_number,
      section: item.section,
      text: item.item_text,
      result: item.result,
      notes: item.notes ?? '',
      updatedAt: item.updated_at,
      correctiveRepair: item.corrective_repair_id == null ? null : {
        id: `repair-${item.corrective_repair_id}`,
        status: item.corrective_repair_status ?? '',
      },
      photos: (photosByItem.get(item.id) ?? []).map((photo) => ({
        id: photo.id,
        fileName: photo.file_name ?? 'Photo',
        contentType: photo.content_type ?? '',
        createdAt: photo.created_at,
        url: photoUrl(photo.object_key),
      })),
    })),
  };
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const repair = await loadRepair(repairId(url.searchParams.get('repairId')));
    return Response.json(await payloadFor(repair), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Checklist could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const contentType = request.headers.get('content-type') ?? '';
    let body: Record<string, unknown> = {};
    let form: FormData | null = null;
    if (contentType.includes('multipart/form-data')) {
      form = await request.formData();
      for (const [key, value] of form.entries()) if (typeof value === 'string') body[key] = value;
    } else {
      body = await request.json() as Record<string, unknown>;
    }

    const action = String(body.action ?? '');
    const id = repairId(body.repairId);
    const repair = await loadRepair(id);
    requireWorkAccess(user, repair);

    if (action === 'startChecklist') {
      await ensureRun(user, repair);
      return Response.json({ ok: true, ...(await payloadFor(repair)) });
    }

    if (action === 'setItem') {
      const run = await ensureRun(user, repair);
      if (run.status === 'completed') throw new Error('Completed checklists cannot be changed.');
      const itemNumber = Number(body.itemNumber ?? 0);
      const result = String(body.result ?? '');
      if (!Number.isInteger(itemNumber) || itemNumber <= 0) throw new Error('Checklist item was not found.');
      if (!['pending','pass','fail','na'].includes(result)) throw new Error('Choose Pass, Fail, or N/A.');
      const notes = String(body.notes ?? '').trim().slice(0, 1000);

      const item = await env.DB.prepare(`
        SELECT i.id, i.item_text, i.result,
               i.allow_pass, i.allow_fail, i.allow_na,
               i.require_notes, i.require_photo, i.require_measurement,
               i.measurement_value,
               EXISTS(
                 SELECT 1 FROM maintenance_checklist_photos p
                 WHERE p.checklist_item_id = i.id
               ) AS has_photo
        FROM maintenance_checklist_items i
        WHERE i.checklist_run_id = ? AND i.item_number = ?
      `).bind(run.id, itemNumber).first<MutableItemRow>();
      if (!item) throw new Error('Checklist item was not found.');
      validateItemAnswer(item, result, notes);

      const changed = await env.DB.prepare(`
        UPDATE maintenance_checklist_items
        SET result = ?, notes = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND checklist_run_id = ?
      `).bind(result, notes || null, user.id, item.id, run.id).run();
      if (!Number(changed.meta.changes ?? 0)) throw new Error('Checklist item was not found.');

      await syncCorrectiveRepair(user, repair, itemNumber, item, result, notes);
      await env.DB.prepare(`
        UPDATE maintenance_checklist_runs
        SET status = 'in_progress', ready_at = NULL, ready_by_user_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'ready'
      `).bind(run.id).run();
      return Response.json({ ok: true, ...(await payloadFor(repair)) });
    }

    if (action === 'uploadPhoto') {
      if (!form) throw new Error('Photo upload data is missing.');
      const run = await ensureRun(user, repair);
      if (run.status === 'completed') throw new Error('Completed checklists cannot be changed.');
      const itemNumber = Number(body.itemNumber ?? 0);
      const item = await env.DB.prepare(`
        SELECT id FROM maintenance_checklist_items WHERE checklist_run_id = ? AND item_number = ?
      `).bind(run.id, itemNumber).first<{ id: number }>();
      if (!item) throw new Error('Checklist item was not found.');
      const fileValue = form.get('photo');
      if (!fileValue || typeof fileValue === 'string') throw new Error('Choose a photo to upload.');
      const file = fileValue as File;
      if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('Checklist photos must be between 1 byte and 12 MB.');
      if (!String(file.type || '').toLowerCase().startsWith('image/')) throw new Error('Checklist uploads must be image files.');
      const cleanName = String(file.name || 'photo').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'photo';
      const contentType = String(file.type || '').trim().toLowerCase() || 'application/octet-stream';
      const bytes = await file.arrayBuffer();
      const key = `maintenance-checklists/${run.id}/${itemNumber}/${crypto.randomUUID()}-${cleanName}`;
      await env.FILES.put(key, bytes, { httpMetadata: { contentType } });
      try {
        await env.DB.prepare(`
          INSERT INTO maintenance_checklist_photos (
            checklist_run_id, checklist_item_id, object_key, file_name, content_type, uploaded_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(run.id, item.id, key, file.name || cleanName, contentType, user.id).run();
      } catch (error) {
        await env.FILES.delete(key);
        throw error;
      }
      return Response.json({ ok: true, ...(await payloadFor(repair)) });
    }

    if (action === 'removePhoto') {
      const run = await ensureRun(user, repair);
      if (run.status === 'completed') throw new Error('Completed checklists cannot be changed.');
      const photoId = Number(body.photoId ?? 0);
      const photo = await env.DB.prepare(`
        SELECT id, checklist_item_id, object_key
        FROM maintenance_checklist_photos
        WHERE id = ? AND checklist_run_id = ?
      `).bind(photoId, run.id).first<{ id: number; checklist_item_id: number; object_key: string }>();
      if (!photo) throw new Error('Checklist photo was not found.');

      // Delete the D1 row first and enforce the last-required-photo rule inside the
      // same DELETE statement. Concurrent deletes cannot both pass this condition.
      const removed = await env.DB.prepare(`
        DELETE FROM maintenance_checklist_photos
        WHERE id = ?
          AND checklist_run_id = ?
          AND (
            NOT EXISTS (
              SELECT 1
              FROM maintenance_checklist_items i
              WHERE i.id = maintenance_checklist_photos.checklist_item_id
                AND i.require_photo = 1
                AND i.result <> 'pending'
            )
            OR EXISTS (
              SELECT 1
              FROM maintenance_checklist_photos other
              WHERE other.checklist_item_id = maintenance_checklist_photos.checklist_item_id
                AND other.id <> maintenance_checklist_photos.id
            )
          )
      `).bind(photoId, run.id).run();
      if (!Number(removed.meta.changes ?? 0)) {
        throw new Error('This photo is required for the answered checklist item. Change the answer first or add another photo before removing it.');
      }

      // An R2 failure after the row is gone can leave only an unreferenced object,
      // which is safer than a database row pointing at a missing image.
      try {
        await env.FILES.delete(photo.object_key);
      } catch (error) {
        console.error(JSON.stringify({
          event: 'maintenance_checklist_orphaned_r2_photo',
          photoId: photo.id,
          checklistItemId: photo.checklist_item_id,
          objectKey: photo.object_key,
          error: String(error),
        }));
      }
      return Response.json({ ok: true, ...(await payloadFor(repair)) });
    }

    if (action === 'markReady') {
      const run = await ensureRun(user, repair);
      if (run.status === 'completed') throw new Error('This checklist is already completed.');

      // Validate the run's own item snapshot, never the currently published template.
      // That keeps an in-progress PM/Annual stable when a manager publishes a new version.
      await validateRunForCompletion(run.id);

      const suppliedText = body.mileage == null ? '' : String(body.mileage).trim();
      let suppliedMileage: number | null = null;
      if (suppliedText) {
        const supplied = Number(suppliedText);
        if (!Number.isInteger(supplied) || supplied < 0) throw new Error('Enter a valid current mileage.');
        suppliedMileage = supplied;
      }

      const tracked = Boolean(repair.geotab_device_id);
      const fresh = geotabMileageFresh(repair);
      let mileage = repair.current_mileage;
      let source: MileageSource = liveMileageSource(repair);
      let mileageUpdatedAt = repair.mileage_updated_at;

      if (tracked) {
        if (fresh && repair.current_mileage != null) {
          source = 'Geotab';
        } else if (suppliedMileage != null) {
          mileage = suppliedMileage;
          source = 'Verified Manual';
          mileageUpdatedAt = new Date().toISOString();
        } else if (repair.current_mileage != null) {
          source = 'Geotab Stale';
        } else {
          mileage = null;
          source = 'Unavailable';
          mileageUpdatedAt = null;
        }
      } else if (suppliedMileage != null) {
        mileage = suppliedMileage;
        source = 'Manual';
        mileageUpdatedAt = new Date().toISOString();
      } else if (repair.current_mileage == null) {
        source = 'Unavailable';
        mileageUpdatedAt = null;
      }

      const statements: D1PreparedStatement[] = [];
      if (!tracked && suppliedMileage != null) {
        statements.push(env.DB.prepare(`
          UPDATE equipment
          SET current_mileage = ?, mileage_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND active = 1 AND geotab_device_id IS NULL
        `).bind(suppliedMileage, repair.equipment_id));
      }
      statements.push(env.DB.prepare(`
        UPDATE maintenance_checklist_runs
        SET status = 'ready', mileage_at_completion = ?, mileage_source = ?, mileage_updated_at = ?,
            ready_by_user_id = ?, ready_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(mileage, source, mileageUpdatedAt, user.id, run.id));
      if (tracked && !fresh && suppliedMileage != null) {
        const previous = repair.current_mileage == null ? 'none' : `${Number(repair.current_mileage).toLocaleString()} mi`;
        statements.push(env.DB.prepare(`
          INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
          VALUES (?, ?, ?, 'verified_manual_mileage', ?)
        `).bind(
          id,
          user.id,
          user.technicianId ?? null,
          `${user.displayName} verified ${suppliedMileage.toLocaleString()} mi from the vehicle odometer because Geotab mileage was stale or unavailable. Last stored Geotab mileage: ${previous}.`.slice(0, 500),
        ));
      }
      await env.DB.batch(statements);
      return Response.json({ ok: true, ready: true, ...(await payloadFor(await loadRepair(id))) });
    }

    return Response.json({ error: 'Unknown maintenance checklist action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_checklist_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Checklist change failed.' }, { status: 400 });
  }
}
