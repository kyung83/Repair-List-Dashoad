import { env } from 'cloudflare:workers';
import { completeRepair, getDashboardData, saveRepair } from '@/lib/dashboard-db';
import {
  hasGeotabCredential,
  markGeotabDefectRepaired,
  syncGeotabDvir,
} from '@/lib/geotab-direct';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const geotabConfigured = await hasGeotabCredential(env);
    if (url.searchParams.get('sync') === '1' && geotabConfigured) {
      await syncGeotabDvir(env);
    }
    const payload = await getDashboardData(env.DB, geotabConfigured);
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
    if (action === 'syncGeotab') return Response.json(await syncGeotabDvir(env));
    return Response.json({ error: 'Unknown repair action' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_api_post_failed', error: String(error) }));
    return Response.json({
      error: error instanceof Error ? error.message : 'Repair action failed',
    }, { status: 400 });
  }
}
