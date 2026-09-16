import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type ItemRow = {
  id: number;
  technician_id: number | null;
  run_status: string;
  allow_pass: number;
  allow_fail: number;
  allow_na: number;
  require_notes: number;
  require_photo: number;
  require_measurement: number;
  measurement_label: string | null;
  measurement_unit: string | null;
  measurement_value: string | null;
};

function positiveId(value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Checklist item was not found.');
  return id;
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

async function loadItem(id: number) {
  const row = await env.DB.prepare(`
    SELECT i.id, r.technician_id, c.status AS run_status,
           i.allow_pass, i.allow_fail, i.allow_na,
           i.require_notes, i.require_photo, i.require_measurement,
           i.measurement_label, i.measurement_unit, i.measurement_value
    FROM maintenance_checklist_items i
    JOIN maintenance_checklist_runs c ON c.id = i.checklist_run_id
    JOIN repairs r ON r.id = c.repair_id
    WHERE i.id = ?
  `).bind(id).first<ItemRow>();
  if (!row) throw new Error('Checklist item was not found.');
  return row;
}

function requireAccess(user: AppUser, item: ItemRow) {
  if (user.role === 'manager' || user.role === 'admin') return;
  if (user.role !== 'mechanic' || !user.technicianId || Number(item.technician_id ?? 0) !== Number(user.technicianId)) {
    throw new Error('This inspection is not assigned to you.');
  }
}

function payload(item: ItemRow) {
  return {
    itemId: item.id,
    allowPass: Boolean(item.allow_pass),
    allowFail: Boolean(item.allow_fail),
    allowNa: Boolean(item.allow_na),
    requireNotes: Boolean(item.require_notes),
    requirePhoto: Boolean(item.require_photo),
    requireMeasurement: Boolean(item.require_measurement),
    measurementLabel: item.measurement_label ?? '',
    measurementUnit: item.measurement_unit ?? '',
    measurementValue: item.measurement_value ?? '',
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const item = await loadItem(positiveId(url.searchParams.get('itemId')));
    requireAccess(user, item);
    return Response.json(payload(item), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checklist item could not be loaded.';
    const status = message === 'Authentication required.' ? 401 : message.includes('not assigned') ? 403 : 400;
    return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    if (String(body.action ?? '') !== 'setMeasurement') {
      return Response.json({ error: 'Unknown checklist item action.' }, { status: 400 });
    }
    const id = positiveId(body.itemId);
    const item = await loadItem(id);
    requireAccess(user, item);
    if (item.run_status === 'completed') throw new Error('Completed checklists cannot be changed.');

    const raw = String(body.measurementValue ?? '').trim();
    if (raw) {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) throw new Error('Enter a valid numeric measurement.');
    }
    if (Boolean(item.require_measurement) && !raw) throw new Error('A measurement is required for this checklist item.');

    await env.DB.prepare(`
      UPDATE maintenance_checklist_items
      SET measurement_value = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(raw || null, user.id, id).run();
    return Response.json({ ok: true, ...payload(await loadItem(id)) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checklist measurement could not be saved.';
    const status = message === 'Authentication required.' ? 401 : message.includes('not assigned') ? 403 : 400;
    return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
