import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getGeotabGpsHealth } from '@/lib/geotab-gps-shadow';
import { retryGeotabGpsForEquipment } from '@/lib/geotab-gps-manual-retry';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    if (user.role !== 'manager' && user.role !== 'admin') {
      return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });
    }
    const health = await getGeotabGpsHealth(env.DB);
    return Response.json(health, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_health_load_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab health could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Administrator access is required.' }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== 'retryGps') return Response.json({ error: 'Unsupported Geotab health action.' }, { status: 400 });
    const equipmentId = Number(body.equipmentId);
    if (!Number.isInteger(equipmentId) || equipmentId <= 0) return Response.json({ error: 'A valid equipment ID is required.' }, { status: 400 });
    const result = await retryGeotabGpsForEquipment(env, equipmentId);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_health_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab action could not be completed.' }, { status: 500 });
  }
}
