import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { checklistFor } from '@/lib/maintenance-checklists';

type EventType = 'pm' | 'annual';
type RepairRow = {
  id: number;
  equipment_id: number | null;
  technician_id: number | null;
  source: string;
  status: string;
  unit: string;
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
};

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

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

async function loadRepair(id: number) {
  const row = await env.DB.prepare(`
    SELECT r.id, r.equipment_id, r.technician_id, COALESCE(r.source,'manual') AS source,
           COALESCE(r.status,'') AS status, COALESCE(e.unit,'') AS unit,
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
           started_at, ready_at, completed_at
    FROM maintenance_checklist_runs
    WHERE repair_id = ?
  `).bind(id).first<RunRow>();
}

async function ensureRun(user: AppUser, repair: RepairRow) {
  requireWorkAccess(user, repair);
  if (String(repair.status).toLowerCase().includes('complete')) throw new Error('That maintenance work order is already completed.');
  const kind = eventType(repair.source);
  const source = repair.geotab_device_id ? 'Geotab' : 'Manual';
  await env.DB.prepare(`
    INSERT OR IGNORE INTO maintenance_checklist_runs (
      repair_id, equipment_id, event_type, mileage_at_start, mileage_source,
      mileage_updated_at, started_by_user_id, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    repair.id,
    repair.equipment_id,
    kind,
    repair.current_mileage,
    source,
    repair.mileage_updated_at,
    user.id,
  ).run();

  const run = await loadRun(repair.id);
  if (!run) throw new Error('Checklist could not be started.');
  const template = checklistFor(kind);
  const statements = template.map((item) => env.DB.prepare(`
    INSERT OR IGNORE INTO maintenance_checklist_items (
      checklist_run_id, item_number, section, item_text, result, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `).bind(run.id, item.number, item.section, item.text));
  for (let index = 0; index < statements.length; index += 75) {
    await env.DB.batch(statements.slice(index, index + 75));
  }
  return run;
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
  if (!run) {
    return {
      repairId: `repair-${repair.id}`,
      equipmentId: repair.equipment_id,
      unit: repair.unit,
      eventType: kind,
      started: false,
      status: 'not_started',
      currentMileage: repair.current_mileage,
      mileageSource: repair.geotab_device_id ? 'Geotab' : 'Manual',
      mileageUpdatedAt: repair.mileage_updated_at,
      items: checklistFor(kind).map((item) => ({ ...item, id: null, result: 'pending', notes: '', photos: [], correctiveRepair: null })),
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
  return {
    repairId: `repair-${repair.id}`,
    equipmentId: repair.equipment_id,
    unit: repair.unit,
    eventType: kind,
    started: true,
    runId: run.id,
    status: run.status,
    currentMileage: repair.current_mileage,
    mileageSource: repair.geotab_device_id ? 'Geotab' : 'Manual',
    mileageUpdatedAt: repair.mileage_updated_at,
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
      if (result === 'fail' && !notes) throw new Error('Add a note explaining a failed inspection item.');

      const item = await env.DB.prepare(`
        SELECT id, item_text, result
        FROM maintenance_checklist_items
        WHERE checklist_run_id = ? AND item_number = ?
      `).bind(run.id, itemNumber).first<MutableItemRow>();
      if (!item) throw new Error('Checklist item was not found.');

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
      const key = `maintenance-checklists/${run.id}/${itemNumber}/${crypto.randomUUID()}-${cleanName}`;
      await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
      try {
        await env.DB.prepare(`
          INSERT INTO maintenance_checklist_photos (
            checklist_run_id, checklist_item_id, object_key, file_name, content_type, uploaded_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(run.id, item.id, key, file.name || cleanName, file.type || null, user.id).run();
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
        SELECT id, object_key FROM maintenance_checklist_photos
        WHERE id = ? AND checklist_run_id = ?
      `).bind(photoId, run.id).first<{ id: number; object_key: string }>();
      if (!photo) throw new Error('Checklist photo was not found.');
      await env.FILES.delete(photo.object_key);
      await env.DB.prepare('DELETE FROM maintenance_checklist_photos WHERE id = ? AND checklist_run_id = ?').bind(photoId, run.id).run();
      return Response.json({ ok: true, ...(await payloadFor(repair)) });
    }

    if (action === 'markReady') {
      const run = await ensureRun(user, repair);
      if (run.status === 'completed') throw new Error('This checklist is already completed.');
      const counts = await env.DB.prepare(`
        SELECT
          SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) AS failed
        FROM maintenance_checklist_items
        WHERE checklist_run_id = ?
      `).bind(run.id).first<{ pending: number | null; failed: number | null }>();
      if (Number(counts?.pending ?? 0) > 0) throw new Error('Finish every checklist item before completing this maintenance job.');
      if (Number(counts?.failed ?? 0) > 0) throw new Error('Failed checklist items must be corrected and changed to Pass before this maintenance job can be completed.');

      let mileage = repair.current_mileage;
      let source = repair.geotab_device_id ? 'Geotab' : 'Manual';
      let mileageUpdatedAt = repair.mileage_updated_at;
      if (!repair.geotab_device_id && body.mileage != null && String(body.mileage).trim() !== '') {
        const supplied = Number(body.mileage);
        if (!Number.isInteger(supplied) || supplied < 0) throw new Error('Enter a valid current mileage.');
        mileage = supplied;
        source = 'Manual';
        mileageUpdatedAt = new Date().toISOString();
        await env.DB.prepare(`
          UPDATE equipment
          SET current_mileage = ?, mileage_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND active = 1 AND geotab_device_id IS NULL
        `).bind(supplied, repair.equipment_id).run();
      }
      if (eventType(repair.source) === 'pm' && repair.mileage_interval != null && mileage == null) {
        throw new Error(repair.geotab_device_id
          ? 'Geotab has not supplied a current odometer yet. Wait for mileage to sync before completing this PM.'
          : 'Enter the current mileage before completing this PM.');
      }
      await env.DB.prepare(`
        UPDATE maintenance_checklist_runs
        SET status = 'ready', mileage_at_completion = ?, mileage_source = ?, mileage_updated_at = ?,
            ready_by_user_id = ?, ready_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(mileage, source, mileageUpdatedAt, user.id, run.id).run();
      return Response.json({ ok: true, ready: true, ...(await payloadFor(await loadRepair(id))) });
    }

    return Response.json({ error: 'Unknown maintenance checklist action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_checklist_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Checklist change failed.' }, { status: 400 });
  }
}
