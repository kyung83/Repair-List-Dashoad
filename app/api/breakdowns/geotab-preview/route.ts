import { env } from 'cloudflare:workers';
import { resolveBreakdownGeotabPreview, type BreakdownUnitType } from '@/lib/breakdown-geotab-snapshot';

/**
 * PUBLIC and intentionally narrow. This read-only endpoint exposes only the
 * driver/location preview for the explicitly selected active unit. Driver and
 * location resolve independently so stale GPS cannot hide a valid Geotab driver.
 */
export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const unitType = String(requestUrl.searchParams.get('unitType') ?? '').trim().toLowerCase();
    const unitNumber = String(requestUrl.searchParams.get('unitNumber') ?? '').trim().slice(0, 20);
    if (unitType !== 'truck' && unitType !== 'trailer') throw new Error('Pick Truck or Trailer.');
    if (!unitNumber) throw new Error('Unit # is required.');

    const equipmentRows = await env.DB.prepare(`
      SELECT id, unit, equipment_type
      FROM equipment
      WHERE lower(trim(COALESCE(unit,''))) = lower(?)
        AND active = 1
        AND archived_at IS NULL
      ORDER BY id DESC
      LIMIT 4
    `).bind(unitNumber).all<{ id: number; unit: string; equipment_type: string }>();
    const typedEquipment = equipmentRows.results.filter(
      (row) => String(row.equipment_type || '').trim().toLowerCase() === unitType,
    );
    if (typedEquipment.length > 1) {
      throw new Error(`${unitType === 'truck' ? 'Truck' : 'Trailer'} "${unitNumber}" has duplicate active equipment records.`);
    }
    const equipment = typedEquipment[0];
    if (!equipment) {
      if (equipmentRows.results.length) {
        const actualType = String(equipmentRows.results[0].equipment_type || '').trim().toLowerCase() || 'other';
        throw new Error(`"${unitNumber}" is on file as a ${actualType}, not a ${unitType}.`);
      }
      throw new Error(`${unitType === 'truck' ? 'Truck' : 'Trailer'} "${unitNumber}" was not found.`);
    }

    const preview = await resolveBreakdownGeotabPreview(env, {
      equipmentId: equipment.id,
      unitType: unitType as BreakdownUnitType,
    });
    if (!preview) {
      return Response.json({
        available: false,
        driverAvailable: false,
        locationAvailable: false,
      }, { headers: { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' } });
    }

    return Response.json({
      available: true,
      driverAvailable: preview.driverAvailable,
      locationAvailable: preview.locationAvailable,
      driverName: preview.driverName,
      city: preview.city,
      state: preview.state,
      observedAt: preview.observedAt,
      partial: !(preview.driverAvailable && preview.locationAvailable),
    }, { headers: { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' } });
  } catch (error) {
    return Response.json(
      { error: String((error as Error)?.message ?? error) },
      { status: 400, headers: { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' } },
    );
  }
}
