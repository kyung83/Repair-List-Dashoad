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

    const equipment = await env.DB.prepare(`
      SELECT id, equipment_type
      FROM equipment
      WHERE unit = ? AND active = 1 AND archived_at IS NULL
    `).bind(unitNumber).first<{ id: number; equipment_type: string }>();
    if (!equipment) throw new Error(`${unitType === 'truck' ? 'Truck' : 'Trailer'} "${unitNumber}" was not found.`);
    if (equipment.equipment_type !== unitType) {
      throw new Error(`"${unitNumber}" is on file as a ${equipment.equipment_type}, not a ${unitType}.`);
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
