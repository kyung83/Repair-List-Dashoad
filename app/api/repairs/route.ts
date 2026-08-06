import { env } from 'cloudflare:workers';
import { completeRepair, getDashboardData, saveRepair } from '@/lib/dashboard-db';
import { isGeotabConfigured, markGeotabDefectRepaired } from '@/lib/geotab';

export async function GET() {
  try {
    const payload = await getDashboardData(env.DB, isGeotabConfigured(env));
    return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_api_get_failed', error: String(error) }));
    return Response.json({ error: 'The repair database could not be read.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'saveRepair') return Response.json(await saveRepair(env.DB, body));
    if (action === 'completeRepair') return Response.json(await completeRepair(env.DB, body.id));
    if (action === 'markRepaired') {
      return Response.json(await markGeotabDefectRepaired(
        env,
        String(body.logId ?? ''),
        String(body.defectId ?? ''),
      ));
    }
    if (action === 'syncGeotab') {
      return Response.json({ error: 'Geotab imports remain disabled until dashboard access control is enabled.' }, { status: 503 });
    }
    return Response.json({ error: 'Unknown repair action' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_api_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Repair action failed' }, { status: 400 });
  }
}
