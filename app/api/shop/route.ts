import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { GET as originalGET, POST as originalPOST } from './original';

type Yard = '' | 'clare' | 'cadillac';
type ShopRepair = {
  id: string;
  equipmentId: number | null;
  technicianId: number | null;
  location?: string;
  status?: string;
  [key: string]: unknown;
};

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function normalizeYard(value: unknown): Yard {
  const yard = String(value ?? '').trim().toLowerCase();
  return yard === 'clare' || yard === 'cadillac' ? yard : '';
}

function deferred(status: unknown) {
  return String(status ?? '').toLowerCase().startsWith('deferred to next');
}

async function assignedYard(userId: number): Promise<Yard> {
  const row = await env.DB.prepare("SELECT COALESCE(yard, '') AS yard FROM app_users WHERE id = ?")
    .bind(userId)
    .first<{ yard: string }>();
  return normalizeYard(row?.yard);
}

async function isDeferredRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();
  return Boolean(row && deferred(row.status));
}

async function equipmentYards() {
  const rows = await env.DB.prepare(`
    SELECT id, COALESCE(current_yard, '') AS current_yard
    FROM equipment
    WHERE active = 1
  `).all<{ id: number; current_yard: string }>();
  return new Map(rows.results.map((row) => [Number(row.id), normalizeYard(row.current_yard)]));
}

function physicalYard(repair: ShopRepair, yards: Map<number, Yard>) {
  if (repair.equipmentId !== null) return yards.get(Number(repair.equipmentId)) ?? '';
  return normalizeYard(repair.location);
}

async function validateYardPickup(request: Request, body: Record<string, unknown>) {
  const action = String(body.action ?? '');
  if (action !== 'openRepair' && action !== 'claimRepair') return null;

  const user = await getSessionUser(env.DB, request);
  if (!user || user.role !== 'mechanic' || !user.technicianId) return null;

  const id = numericRepairId(body.repairId ?? body.id);
  if (!id) return null;
  const repair = await env.DB.prepare(`
    SELECT r.technician_id, r.equipment_id,
           COALESCE(e.current_yard, '') AS current_yard,
           COALESCE(r.location, '') AS repair_location
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<{
    technician_id: number | null;
    equipment_id: number | null;
    current_yard: string;
    repair_location: string;
  }>();
  if (!repair || repair.technician_id !== null) return null;

  const yard = await assignedYard(user.id);
  if (!yard) {
    return Response.json({ error: 'Your user account needs a yard assignment before you can pick up unassigned work.' }, { status: 409 });
  }
  const repairYard = repair.equipment_id !== null ? normalizeYard(repair.current_yard) : normalizeYard(repair.repair_location);
  if (repairYard !== yard) {
    const where = repairYard ? `${repairYard[0].toUpperCase()}${repairYard.slice(1)} yard` : 'outside your assigned yard';
    return Response.json({ error: `This repair is ${where}. You can only pick up unassigned work in your assigned yard.` }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  const response = await originalGET(request);
  if (!response.ok) return response;

  const payload = await response.json() as {
    user?: Record<string, unknown>;
    activeTimer?: { repairId?: string } | null;
    repairs?: ShopRepair[];
    [key: string]: unknown;
  };
  const activeRepairId = String(payload.activeTimer?.repairId ?? '');
  let repairs = (payload.repairs ?? []).filter((repair) => !deferred(repair.status));

  if (user && (user.role === 'mechanic' || user.role === 'manager')) {
    const [yard, yards] = await Promise.all([assignedYard(user.id), equipmentYards()]);
    if (yard) {
      repairs = repairs.filter((repair) => physicalYard(repair, yards) === yard || repair.id === activeRepairId);
    } else if (user.role === 'mechanic' && user.technicianId) {
      repairs = repairs.filter((repair) => Number(repair.technicianId ?? 0) === Number(user.technicianId) || repair.id === activeRepairId);
    } else {
      repairs = [];
    }
    payload.user = { ...(payload.user ?? {}), yard, yardAssigned: Boolean(yard) };
    payload.yardScope = { yard, yardAssigned: Boolean(yard) };
  }

  payload.repairs = repairs;
  return Response.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const clone = request.clone();
  try {
    const body = await clone.json() as Record<string, unknown>;
    if (await isDeferredRepair(body.repairId ?? body.id)) {
      return Response.json({ error: 'This repair is saved for a future PM/Annual and is not active shop work yet.' }, { status: 400 });
    }
    const yardError = await validateYardPickup(request.clone(), body);
    if (yardError) return yardError;
  } catch {
    // The original handler owns validation for malformed/non-JSON requests.
  }
  return originalPOST(request);
}
