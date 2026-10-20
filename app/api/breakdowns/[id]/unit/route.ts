import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type OperatorRole = 'dispatch' | 'manager' | 'admin';
type UnitType = 'truck' | 'trailer';

function cleanUnit(value: unknown) {
  return String(value ?? '').trim().slice(0, 40);
}

function normalizedType(value: unknown): UnitType {
  return String(value ?? '').trim().toLowerCase() === 'trailer' ? 'trailer' : 'truck';
}

function desiredType(value: unknown, existing: UnitType): UnitType {
  if (value === undefined || value === null || value === '') return existing;
  const next = String(value).trim().toLowerCase();
  if (next !== 'truck' && next !== 'trailer') throw new Error('Choose Truck or Trailer for the corrected breakdown.');
  return next;
}

function unitKey(value: unknown, unitType: UnitType) {
  const raw = cleanUnit(value).toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  if (!compact) return '';

  if (unitType === 'trailer') {
    const numeric = compact.match(/^(?:TRL|TRAILER)?0*(\d+)$/);
    if (numeric) return String(Number(numeric[1]));
    return compact;
  }

  // Truck master equipment commonly carries suffixes such as 227(DC).
  // Dispatch normally knows the road unit simply as 227, so treat the
  // leading truck number as the stable identity for correction lookup.
  const numeric = raw.match(/^0*(\d+)(?:\D|$)/);
  if (numeric) return String(Number(numeric[1]));
  return compact;
}

function label(unitType: UnitType) {
  return unitType === 'trailer' ? 'Trailer' : 'Truck';
}

async function requireOperator(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!(['dispatch', 'manager', 'admin'] as OperatorRole[]).includes(user.role as OperatorRole)) {
    throw new Error('Dispatch, manager, or administrator access is required.');
  }
  return user;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireOperator(request);
    const { id } = await params;
    const breakdownId = Number(id);
    if (!Number.isInteger(breakdownId) || breakdownId <= 0) throw new Error('Invalid breakdown number.');

    const body = await request.json<{ unitType?: unknown; unitNumber?: unknown; trailerNumber?: unknown }>();

    const current = await env.DB.prepare(`
      SELECT b.id,b.repair_id,b.stage,b.equipment_id,e.unit,e.equipment_type,COALESCE(r.source,'') AS repair_source
      FROM roadside_breakdowns b
      JOIN equipment e ON e.id=b.equipment_id
      JOIN repairs r ON r.id=b.repair_id
      WHERE b.id=?
    `).bind(breakdownId).first<{
      id:number;
      repair_id:number;
      stage:number;
      equipment_id:number;
      unit:string;
      equipment_type:string;
      repair_source:string;
    }>();

    if (!current) return Response.json({ error: 'Breakdown not found.' }, { status: 404 });

    if (current.repair_source !== 'roadside-breakdown') throw new Error('The linked repair is not a roadside breakdown.');
    const previousUnitType = normalizedType(current.equipment_type);
    const unitType = desiredType(body.unitType, previousUnitType);
    const requested = cleanUnit(body.unitNumber ?? body.trailerNumber);
    const wantedKey = unitKey(requested, unitType);
    if (!wantedKey) throw new Error(`Enter the correct ${unitType} number.`);

    if (Number(current.stage) >= 5 && user.role !== 'manager' && user.role !== 'admin') {
      throw new Error('Completed breakdown equipment can only be corrected by a manager or administrator from Breakdown Reports.');
    }

    const typeSql = unitType === 'trailer'
      ? "lower(trim(COALESCE(equipment_type,'')))='trailer'"
      : "lower(trim(COALESCE(equipment_type,''))) IN ('truck','vehicle','glider','switcher')";

    const result = await env.DB.prepare(`
      SELECT id,unit,equipment_type
      FROM equipment
      WHERE active=1
        AND archived_at IS NULL
        AND ${typeSql}
      ORDER BY id
    `).all<{ id:number; unit:string; equipment_type:string }>();

    const matches = result.results.filter((row) => unitKey(row.unit, unitType) === wantedKey);
    if (!matches.length) {
      throw new Error(`${label(unitType)} "${requested}" was not found in active equipment.`);
    }
    if (matches.length > 1) {
      throw new Error(`${label(unitType)} "${requested}" matches more than one active equipment record. Resolve the duplicate equipment first.`);
    }

    const target = matches[0];
    if (target.id === current.equipment_id) {
      return Response.json({
        ok: true,
        changed: false,
        unitType,
        previousUnitType,
        unitNumber: String(target.unit || '').trim(),
        previousUnitNumber: String(current.unit || '').trim(),
      }, { headers: { 'cache-control': 'no-store' } });
    }

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE roadside_breakdowns
        SET equipment_id=?,
            snapshot_source='unit-corrected',
            geotab_driver_id=NULL,
            driver_observed_at=NULL,
            geotab_device_id=NULL,
            latitude=NULL,
            longitude=NULL,
            gps_observed_at=NULL,
            gps_source=NULL,
            snapshot_captured_at=NULL,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(target.id, breakdownId),
      env.DB.prepare(`
        UPDATE repairs
        SET equipment_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(target.id, current.repair_id),
    ]);

    return Response.json({
      ok: true,
      changed: true,
      unitType,
      unitNumber: String(target.unit || '').trim(),
      previousUnitNumber: String(current.unit || '').trim(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: String((error as Error)?.message ?? error) },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
