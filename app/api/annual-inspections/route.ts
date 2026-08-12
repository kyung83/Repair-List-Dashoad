import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

const CARRIER_NAME = 'Northern Logistics Worldwide';

type AnnualHeaderRow = {
  run_id: number;
  repair_id: number;
  checklist_status: string;
  repair_status: string;
  ready_at: string | null;
  completed_at: string | null;
  mileage_at_completion: number | null;
  unit: string;
  vin: string | null;
  license_plate: string | null;
  license_state: string | null;
  model_year: number | null;
  make: string | null;
  model: string | null;
  location: string;
  inspector_name: string | null;
};

type AnnualItemRow = {
  item_number: number;
  section: string;
  item_text: string;
  result: 'pending' | 'pass' | 'fail' | 'na';
  notes: string | null;
  corrective_repair_id: number | null;
  corrective_title: string | null;
  corrective_description: string | null;
  corrective_status: string | null;
  corrective_completed_at: string | null;
};

function repairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  if (!Number.isInteger(id) || id <= 0) throw new Error('Annual inspection was not found.');
  return id;
}

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

function reportNumber(runId: number) {
  return `NLW-ANNUAL-${String(runId).padStart(6, '0')}`;
}

async function listForms() {
  const result = await env.DB.prepare(`
    SELECT c.id AS run_id, c.repair_id, c.status AS checklist_status,
           COALESCE(r.status,'') AS repair_status, c.ready_at, c.completed_at,
           c.mileage_at_completion,
           COALESCE(e.unit,'') AS unit, e.vin, e.license_plate, e.license_state,
           e.model_year, e.make, e.model,
           COALESCE(NULLIF(r.location,''), NULLIF(e.location,''), '') AS location,
           COALESCE(t.name, u.display_name, '') AS inspector_name
    FROM maintenance_checklist_runs c
    JOIN repairs r ON r.id = c.repair_id
    JOIN equipment e ON e.id = c.equipment_id
    LEFT JOIN app_users u ON u.id = COALESCE(c.ready_by_user_id, c.started_by_user_id)
    LEFT JOIN technicians t ON t.id = u.technician_id
    WHERE c.event_type = 'annual'
      AND c.status = 'completed'
      AND r.source = 'scheduled-annual'
      AND lower(COALESCE(r.status,'')) LIKE '%complete%'
    ORDER BY COALESCE(c.completed_at, c.ready_at, c.started_at) DESC, c.id DESC
    LIMIT 1000
  `).all<AnnualHeaderRow>();

  return result.results.map((row) => ({
    reportNumber: reportNumber(row.run_id),
    runId: row.run_id,
    repairId: `repair-${row.repair_id}`,
    inspectionDate: String(row.completed_at ?? row.ready_at ?? '').slice(0, 10),
    completedAt: row.completed_at ?? '',
    certifiedAt: row.ready_at ?? row.completed_at ?? '',
    unit: row.unit,
    vin: row.vin ?? '',
    plate: [row.license_plate, row.license_state].filter(Boolean).join(' / '),
    modelYear: row.model_year,
    make: row.make ?? '',
    model: row.model ?? '',
    location: row.location,
    inspector: row.inspector_name ?? '',
    mileage: row.mileage_at_completion == null ? null : Number(row.mileage_at_completion),
    printUrl: `/annual-inspections/print?repairId=${encodeURIComponent(`repair-${row.repair_id}`)}`,
  }));
}

async function detailFor(id: number) {
  const row = await env.DB.prepare(`
    SELECT c.id AS run_id, c.repair_id, c.status AS checklist_status,
           COALESCE(r.status,'') AS repair_status, c.ready_at, c.completed_at,
           c.mileage_at_completion,
           COALESCE(e.unit,'') AS unit, e.vin, e.license_plate, e.license_state,
           e.model_year, e.make, e.model,
           COALESCE(NULLIF(r.location,''), NULLIF(e.location,''), '') AS location,
           COALESCE(t.name, u.display_name, '') AS inspector_name
    FROM maintenance_checklist_runs c
    JOIN repairs r ON r.id = c.repair_id
    JOIN equipment e ON e.id = c.equipment_id
    LEFT JOIN app_users u ON u.id = COALESCE(c.ready_by_user_id, c.started_by_user_id)
    LEFT JOIN technicians t ON t.id = u.technician_id
    WHERE c.repair_id = ?
      AND c.event_type = 'annual'
      AND r.source = 'scheduled-annual'
    LIMIT 1
  `).bind(id).first<AnnualHeaderRow>();
  if (!row) throw new Error('Annual inspection was not found.');
  if (row.checklist_status !== 'completed' || !String(row.repair_status).toLowerCase().includes('complete')) {
    throw new Error('This annual inspection is not completed yet. Complete the Annual work order before printing the final form.');
  }

  const items = await env.DB.prepare(`
    SELECT i.item_number, i.section, i.item_text, i.result, i.notes,
           cr.id AS corrective_repair_id, cr.title AS corrective_title,
           cr.description AS corrective_description, cr.status AS corrective_status,
           cr.completed_at AS corrective_completed_at
    FROM maintenance_checklist_items i
    LEFT JOIN repairs cr
      ON cr.maintenance_checklist_item_id = i.id
     AND cr.source = 'maintenance-checklist'
    WHERE i.checklist_run_id = ?
    ORDER BY i.item_number
  `).bind(row.run_id).all<AnnualItemRow>();

  if (items.results.some((item) => item.result === 'pending' || item.result === 'fail')) {
    throw new Error('The stored Annual record still contains an unresolved inspection item and cannot be certified for printing.');
  }

  return {
    reportNumber: reportNumber(row.run_id),
    runId: row.run_id,
    repairId: `repair-${row.repair_id}`,
    carrierName: CARRIER_NAME,
    inspectionDate: String(row.completed_at ?? row.ready_at ?? '').slice(0, 10),
    completedAt: row.completed_at ?? '',
    certifiedAt: row.ready_at ?? row.completed_at ?? '',
    inspector: row.inspector_name ?? '',
    vehicle: {
      unit: row.unit,
      vin: row.vin ?? '',
      plate: row.license_plate ?? '',
      plateState: row.license_state ?? '',
      modelYear: row.model_year,
      make: row.make ?? '',
      model: row.model ?? '',
      location: row.location,
      mileage: row.mileage_at_completion == null ? null : Number(row.mileage_at_completion),
    },
    items: items.results.map((item) => ({
      number: item.item_number,
      section: item.section,
      text: item.item_text,
      result: item.result,
      notes: item.notes ?? '',
      correctiveRepair: item.corrective_repair_id == null ? null : {
        id: `repair-${item.corrective_repair_id}`,
        title: item.corrective_title ?? '',
        description: item.corrective_description ?? '',
        status: item.corrective_status ?? '',
        completedAt: item.corrective_completed_at ?? '',
      },
    })),
    certification: `I certify that this vehicle has passed the required periodic inspection and that this report accurately and completely records the inspection performed.`,
  };
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const requested = url.searchParams.get('repairId');
    if (!requested) {
      return Response.json({ forms: await listForms(), updatedAt: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json(await detailFor(repairId(requested)), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'annual_inspection_get_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Annual inspection could not be loaded.' }, { status: 400 });
  }
}
