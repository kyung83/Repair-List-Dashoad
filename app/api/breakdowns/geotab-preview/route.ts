import { previewBreakdownGeotab } from '@/lib/roadside-breakdowns';

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== requestUrl.origin) {
      return Response.json({ error: 'Cross-site Geotab preview rejected.' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    }

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
