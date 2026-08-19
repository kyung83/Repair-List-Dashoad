import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getGeotabGpsHealth } from '@/lib/geotab-gps-shadow';

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
