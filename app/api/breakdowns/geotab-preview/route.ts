import { previewBreakdownGeotab } from '@/lib/roadside-breakdowns';

/**
 * PUBLIC and intentionally narrow. This read-only endpoint exposes only the
 * driver/location snapshot for the explicitly selected active unit. Do not
 * compare Origin to request.url here: the same Worker can be reached through
 * different first-party browser/proxy hostnames, especially on mobile.
 */
export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const unitType = String(requestUrl.searchParams.get('unitType') ?? '').trim().toLowerCase();
    const unitNumber = String(requestUrl.searchParams.get('unitNumber') ?? '').trim().slice(0, 20);
    if (unitType !== 'truck' && unitType !== 'trailer') throw new Error('Pick Truck or Trailer.');
    if (!unitNumber) throw new Error('Unit # is required.');

    const snapshot = await previewBreakdownGeotab(unitNumber, unitType as 'truck' | 'trailer');
    if (!snapshot) {
      return Response.json({ available: false }, { headers: { 'cache-control': 'no-store' } });
    }

    return Response.json({
      available: true,
      driverName: snapshot.driverName,
      city: snapshot.city,
      state: snapshot.state,
      observedAt: snapshot.gpsObservedAt,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}
