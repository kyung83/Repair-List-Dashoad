import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { syncGeotabDvir } from '@/lib/geotab';
import { syncGeotabFleetMaster } from '@/lib/geotab-fleet';
import {
  assignMaintenanceCategory,
  correctEquipmentMaintenance,
  getMaintenanceSetup,
  saveCategoryMaintenanceRule,
} from '@/lib/maintenance-setup';

type OpenPmRepairRow = {
  id: number;
  equipment_id: number;
};

type CustomRotationRow = {
  equipment_id: number;
  program_id: number;
  program_name: string;
  rotation_position: number;
  step_id: number;
  step_position: number;
  item_name: string;
};

type LegacyPmRow = {
  id: number;
  unit: string;
  driver: string | null;
  location: string | null;
  profile_name: string;
  sequence_json: string;
  pm_type: string | null;
};

function positiveId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is invalid.`);
  return id;
}

function parseSequence(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function pmTitle(value: string) {
  const name = value.trim() || 'Service';
  return /\bpm\b/i.test(name) ? name : `${name} PM`;
}

async function managerUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') {
    throw new Error('Manager or administrator access is required.');
  }
  return user;
}

async function openPmRepair(equipmentId: number) {
  return env.DB.prepare(`
    SELECT r.id, r.equipment_id
    FROM repairs r
    LEFT JOIN maintenance_program_steps s ON s.id = r.maintenance_program_step_id
    WHERE r.equipment_id = ?
      AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      AND (
        r.source = 'scheduled-pm'
        OR (r.source = 'custom-maintenance' AND s.step_type = 'rotation')
      )
    ORDER BY r.id DESC
    LIMIT 1
  `).bind(equipmentId).first<OpenPmRepairRow>();
}

async function loadCustomRotationRows() {
  return env.DB.prepare(`
    SELECT a.equipment_id, a.program_id, p.name AS program_name,
           a.rotation_position, s.id AS step_id, s.position AS step_position,
           i.name AS item_name
    FROM equipment_maintenance_programs a
    JOIN maintenance_programs p ON p.id = a.program_id AND p.active = 1
    JOIN maintenance_program_steps s
      ON s.program_id = a.program_id
     AND s.step_type = 'rotation'
     AND s.active = 1
    JOIN maintenance_items i ON i.id = s.maintenance_item_id AND i.active = 1
    ORDER BY a.equipment_id, s.position
  `).all<CustomRotationRow>();
}

function currentCustomRotations(rows: CustomRotationRow[]) {
  const byEquipment = new Map<number, CustomRotationRow[]>();
  for (const row of rows) {
    const list = byEquipment.get(Number(row.equipment_id)) ?? [];
    list.push(row);
    byEquipment.set(Number(row.equipment_id), list);
  }
  const current = new Map<number, CustomRotationRow>();
  for (const [equipmentId, steps] of byEquipment) {
    if (!steps.length) continue;
    const rawPosition = Number(steps[0].rotation_position ?? 0);
    const index = Math.max(0, rawPosition) % steps.length;
    current.set(equipmentId, steps[index]);
  }
  return current;
}

async function getEnhancedMaintenanceSetup() {
  const [setup, openRepairs, customRotationResult] = await Promise.all([
    getMaintenanceSetup(env.DB),
    env.DB.prepare(`
      SELECT r.id, r.equipment_id
      FROM repairs r
      LEFT JOIN maintenance_program_steps s ON s.id = r.maintenance_program_step_id
      WHERE r.equipment_id IS NOT NULL
        AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
        AND (
          r.source = 'scheduled-pm'
          OR (r.source = 'custom-maintenance' AND s.step_type = 'rotation')
        )
      ORDER BY r.id DESC
    `).all<OpenPmRepairRow>(),
    loadCustomRotationRows(),
  ]);

  const openByEquipment = new Map<number, string>();
  for (const row of openRepairs.results) {
    const equipmentId = Number(row.equipment_id);
    if (!openByEquipment.has(equipmentId)) openByEquipment.set(equipmentId, `repair-${row.id}`);
  }
  const currentRotations = currentCustomRotations(customRotationResult.results);

  return {
    ...setup,
    equipment: setup.equipment.map((item) => {
      const custom = currentRotations.get(item.id);
      return {
        ...item,
        openPmRepairId: openByEquipment.get(item.id) ?? null,
        customProgramId: custom?.program_id ?? null,
        customProgramName: custom?.program_name ?? '',
        customRotationStepId: custom?.step_id ?? null,
        customRotationItem: custom?.item_name ?? '',
      };
    }),
  };
}

async function createPmRepairNow(request: Request, body: Record<string, unknown>) {
  const user = await managerUser(request);
  const equipmentId = positiveId(body.equipmentId, 'Unit');

  const existing = await openPmRepair(equipmentId);
  if (existing) return { ok: true, existing: true, repairId: `repair-${existing.id}` };

  const equipment = await env.DB.prepare(`
    SELECT id, unit, COALESCE(driver,'') AS driver, COALESCE(location,'') AS location
    FROM equipment
    WHERE id = ? AND active = 1
  `).bind(equipmentId).first<{ id: number; unit: string; driver: string; location: string }>();
  if (!equipment) throw new Error('Unit was not found or is inactive.');

  const rotationResult = await env.DB.prepare(`
    SELECT a.equipment_id, a.program_id, p.name AS program_name,
           a.rotation_position, s.id AS step_id, s.position AS step_position,
           i.name AS item_name
    FROM equipment_maintenance_programs a
    JOIN maintenance_programs p ON p.id = a.program_id AND p.active = 1
    JOIN maintenance_program_steps s
      ON s.program_id = a.program_id
     AND s.step_type = 'rotation'
     AND s.active = 1
    JOIN maintenance_items i ON i.id = s.maintenance_item_id AND i.active = 1
    WHERE a.equipment_id = ?
    ORDER BY s.position
  `).bind(equipmentId).all<CustomRotationRow>();

  let title = '';
  let description = '';
  let maintenanceSourceId: string | null = null;
  let maintenanceProgramStepId: number | null = null;
  let pmType = '';
  let customRotation = false;

  if (rotationResult.results.length) {
    const steps = rotationResult.results;
    const position = Math.max(0, Number(steps[0].rotation_position ?? 0)) % steps.length;
    const step = steps[position];
    pmType = step.item_name;
    title = pmTitle(step.item_name);
    description = `Early rotational PM released from PM Schedule Setup. Program: ${step.program_name}. The rotation will advance only after the mechanic completes the PM checklist.`;
    maintenanceSourceId = `custom-rotation-${equipmentId}-${step.step_id}`;
    maintenanceProgramStepId = step.step_id;
    customRotation = true;
  } else {
    const legacy = await env.DB.prepare(`
      SELECT e.id, e.unit, e.driver, e.location,
             p.name AS profile_name, p.sequence_json, ps.pm_type
      FROM equipment e
      JOIN equipment_pm_settings s ON s.equipment_id = e.id
      JOIN pm_profiles p ON p.id = s.profile_id AND p.active = 1
      LEFT JOIN pm_status ps ON ps.equipment_id = e.id
      WHERE e.id = ? AND e.active = 1
    `).bind(equipmentId).first<LegacyPmRow>();
    if (!legacy) throw new Error('This unit does not have a PM schedule or custom rotational PM program assigned.');
    const sequence = parseSequence(legacy.sequence_json);
    if (!sequence.length) throw new Error('This PM schedule does not have any PM steps.');
    pmType = legacy.pm_type && sequence.includes(legacy.pm_type) ? legacy.pm_type : sequence[0];
    title = pmTitle(pmType);
    description = `Early ${pmType} PM released from PM Schedule Setup. The PM mileage/date baseline and rotation will update only after the mechanic completes the PM checklist.`;
  }

  const inserted = await env.DB.prepare(`
    INSERT INTO repairs (
      equipment_id, title, description, status, priority, source,
      driver, location, maintenance_source_id, maintenance_program_step_id,
      opened_at, updated_at
    )
    SELECT ?, ?, ?, 'New', '2', 'scheduled-pm', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1
      FROM repairs r
      LEFT JOIN maintenance_program_steps step ON step.id = r.maintenance_program_step_id
      WHERE r.equipment_id = ?
        AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
        AND (
          r.source = 'scheduled-pm'
          OR (r.source = 'custom-maintenance' AND step.step_type = 'rotation')
        )
    )
  `).bind(
    equipmentId,
    title,
    description,
    equipment.driver,
    equipment.location,
    maintenanceSourceId,
    maintenanceProgramStepId,
    equipmentId,
  ).run();

  const open = await openPmRepair(equipmentId);
  if (!open) throw new Error('PM repair job could not be created.');
  if (Number(inserted.meta.changes ?? 0) === 0) {
    return { ok: true, existing: true, repairId: `repair-${open.id}` };
  }

  await env.DB.prepare(`
    INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
    VALUES (?, ?, NULL, 'early_pm_created', ?)
  `).bind(
    open.id,
    user.id,
    `${user.displayName} released ${title} early for Unit ${equipment.unit} from PM Schedule Setup.`.slice(0, 500),
  ).run();

  return {
    ok: true,
    existing: false,
    repairId: `repair-${open.id}`,
    equipmentId,
    unit: equipment.unit,
    pmType,
    customRotation,
  };
}

export async function GET() {
  try {
    return Response.json(await getEnhancedMaintenanceSetup(), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_setup_get_failed', error: String(error) }));
    return Response.json({ error: 'Maintenance setup could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'createPmRepairNow') return Response.json(await createPmRepairNow(request, body));
    if (action === 'saveCategoryRule') return Response.json(await saveCategoryMaintenanceRule(env.DB, body));
    if (action === 'assignCategory') return Response.json(await assignMaintenanceCategory(env.DB, body));
    if (action === 'correctUnitMaintenance') return Response.json(await correctEquipmentMaintenance(env.DB, body));
    if (action === 'syncGeotab') {
      const fleet = await syncGeotabFleetMaster(env);
      const dvir = await syncGeotabDvir(env);
      return Response.json({ ok: true, fleet, dvir }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json({ error: 'Unknown maintenance setup action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_setup_post_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Maintenance setup action failed.';
    const status = /Authentication required|Manager or administrator access/.test(message) ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
