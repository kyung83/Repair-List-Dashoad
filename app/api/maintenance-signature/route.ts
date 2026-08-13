import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type EventType = 'pm' | 'annual';
type Point = { x: number; y: number };
type RepairRow = { id: number; technician_id: number | null; source: string; status: string };
type SignoffRow = {
  run_id: number;
  event_type: EventType;
  status: string;
  signature_strokes: string | null;
  signed_by_user_id: number | null;
  signed_at: string | null;
  pm_brake_notes: string | null;
  pm_comments: string | null;
  pm_tire_data_json: string | null;
  signer_name: string | null;
};

const tireKeys = [
  'a1_l_tread','a1_r_tread','a1_l_psi','a1_r_psi',
  'a2_ol_tread','a2_il_tread','a2_ir_tread','a2_or_tread','a2_ol_psi','a2_il_psi','a2_ir_psi','a2_or_psi',
  'a3_ol_tread','a3_il_tread','a3_ir_tread','a3_or_tread','a3_ol_psi','a3_il_psi','a3_ir_psi','a3_or_psi',
] as const;

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Maintenance work order was not found.');
  return id;
}

function eventType(source: string): EventType {
  if (source === 'scheduled-pm') return 'pm';
  if (source === 'scheduled-annual') return 'annual';
  throw new Error('Technician signoff is only available for scheduled PM and Annual work orders.');
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

async function loadRepair(id: number) {
  const row = await env.DB.prepare(`
    SELECT id, technician_id, COALESCE(source,'manual') AS source, COALESCE(status,'') AS status
    FROM repairs WHERE id = ?
  `).bind(id).first<RepairRow>();
  if (!row) throw new Error('Maintenance work order was not found.');
  eventType(row.source);
  return row;
}

function requireAccess(user: AppUser, repair: RepairRow) {
  if (user.role === 'manager' || user.role === 'admin') return;
  if (user.role !== 'mechanic' || !user.technicianId || Number(repair.technician_id ?? 0) !== Number(user.technicianId)) {
    throw new Error('This PM/Annual is not assigned to you.');
  }
}

function parseStrokes(value: unknown): Point[][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 80) throw new Error('Draw your signature before signing.');
  let points = 0;
  const strokes = value.map((stroke) => {
    if (!Array.isArray(stroke) || stroke.length < 1 || stroke.length > 1200) throw new Error('Signature data is invalid.');
    return stroke.map((raw) => {
      const item = raw as Record<string, unknown>;
      const x = Number(item?.x);
      const y = Number(item?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('Signature data is invalid.');
      points += 1;
      return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
    });
  });
  if (points < 3 || points > 5000) throw new Error('Draw your signature before signing.');
  return strokes;
}

function normalizeTireData(value: unknown) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Record<string, string> = {};
  for (const key of tireKeys) {
    const text = String(source[key] ?? '').trim().slice(0, 12);
    if (text) result[key] = text;
  }
  return result;
}

async function loadSignoff(id: number) {
  const row = await env.DB.prepare(`
    SELECT c.id AS run_id, c.event_type, c.status, c.signature_strokes,
           c.signed_by_user_id, c.signed_at, c.pm_brake_notes, c.pm_comments, c.pm_tire_data_json,
           COALESCE(t.name, u.display_name, '') AS signer_name
    FROM maintenance_checklist_runs c
    LEFT JOIN app_users u ON u.id = c.signed_by_user_id
    LEFT JOIN technicians t ON t.id = u.technician_id
    WHERE c.repair_id = ?
  `).bind(id).first<SignoffRow>();
  if (!row) return null;
  let strokes: Point[][] = [];
  let tireData: Record<string, string> = {};
  try { strokes = row.signature_strokes ? JSON.parse(row.signature_strokes) as Point[][] : []; } catch { strokes = []; }
  try { tireData = row.pm_tire_data_json ? JSON.parse(row.pm_tire_data_json) as Record<string, string> : {}; } catch { tireData = {}; }
  return {
    runId: row.run_id,
    eventType: row.event_type,
    status: row.status,
    signed: Boolean(row.signed_by_user_id && row.signed_at && strokes.length),
    signer: row.signer_name ?? '',
    signedAt: row.signed_at ?? '',
    strokes,
    brakeNotes: row.pm_brake_notes ?? '',
    comments: row.pm_comments ?? '',
    tireData,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const id = numericRepairId(url.searchParams.get('repairId'));
    const repair = await loadRepair(id);
    requireAccess(user, repair);
    const signoff = await loadSignoff(id);
    return Response.json(signoff ?? { eventType: eventType(repair.source), status: 'not_started', signed: false, signer: '', signedAt: '', strokes: [], brakeNotes: '', comments: '', tireData: {} }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Technician signoff could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const id = numericRepairId(body.repairId);
    const repair = await loadRepair(id);
    requireAccess(user, repair);
    const run = await env.DB.prepare(`SELECT id, event_type, status FROM maintenance_checklist_runs WHERE repair_id = ?`).bind(id).first<{id:number;event_type:EventType;status:string}>();
    if (!run) throw new Error('Start the PM/Annual inspection before signing it.');
    if (run.status !== 'in_progress') throw new Error('This PM/Annual has already been signed off for completion.');

    const action = String(body.action ?? 'sign');
    if (action === 'clear') {
      await env.DB.prepare(`
        UPDATE maintenance_checklist_runs
        SET signature_strokes = NULL, signed_by_user_id = NULL, signed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'in_progress'
      `).bind(run.id).run();
      return Response.json({ ok: true, ...(await loadSignoff(id)) });
    }
    if (action !== 'sign') throw new Error('Unknown technician signoff action.');

    const strokes = parseStrokes(body.strokes);
    const brakeNotes = String(body.brakeNotes ?? '').trim().slice(0, 4000);
    const comments = String(body.comments ?? '').trim().slice(0, 4000);
    const tireData = normalizeTireData(body.tireData);

    await env.DB.prepare(`
      UPDATE maintenance_checklist_runs
      SET signature_strokes = ?, signed_by_user_id = ?, signed_at = CURRENT_TIMESTAMP,
          pm_brake_notes = ?, pm_comments = ?, pm_tire_data_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'in_progress'
    `).bind(JSON.stringify(strokes), user.id, brakeNotes || null, comments || null, JSON.stringify(tireData), run.id).run();

    await env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
      VALUES (?, ?, ?, 'maintenance_signed', ?)
    `).bind(id, user.id, user.technicianId ?? null, `${run.event_type === 'annual' ? 'Annual inspection' : 'PM'} electronically signed by ${user.displayName}.`).run();

    return Response.json({ ok: true, ...(await loadSignoff(id)) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_signoff_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Technician signoff failed.' }, { status: 400 });
  }
}
