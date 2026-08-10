import { env } from 'cloudflare:workers';
import { syncGeotabDvir } from '@/lib/geotab';
import { syncGeotabFleetMaster } from '@/lib/geotab-fleet';
import {
  assignMaintenanceCategory,
  correctEquipmentMaintenance,
  getMaintenanceSetup,
  saveCategoryMaintenanceRule,
} from '@/lib/maintenance-setup';

export async function GET() {
  try {
    return Response.json(await getMaintenanceSetup(env.DB), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_setup_get_failed', error: String(error) }));
    return Response.json({ error: 'Maintenance setup could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'saveCategoryRule') return Response.json(await saveCategoryMaintenanceRule(env.DB, body));
    if (action === 'assignCategory') return Response.json(await assignMaintenanceCategory(env.DB, body));
    if (action === 'correctUnitMaintenance') return Response.json(await correctEquipmentMaintenance(env.DB, body));
    if (action === 'syncGeotab') {
      const fleet = await syncGeotabFleetMaster(env);
      const dvir = await syncGeotabDvir(env);
      return Response.json({ ok: true, fleet, dvir }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json({ error: 'Unknown maintenance setup action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_setup_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Maintenance setup action failed.' }, { status: 400 });
  }
}
