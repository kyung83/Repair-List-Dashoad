import { env } from 'cloudflare:workers';
import { completeRepair, getDashboardData, saveRepair } from '@/lib/dashboard-db';
import { diagnoseGeotabConnection } from '@/lib/geotab-diagnostic';
import { isGeotabConfigured, markGeotabDefectRepaired, syncGeotabDvir } from '@/lib/geotab';
import { syncGeotabFleetMaster } from '@/lib/geotab-fleet';
import { completeMaintenanceBoardItem, getMaintenanceBoardItems } from '@/lib/maintenance-board';

function isMaintenanceId(value: unknown) {
  return /^(?:pm|annual)-\d+$/.test(String(value ?? ''));
}

function annualNotDueYet(status: unknown) {
  return String(status ?? '').trim().toLowerCase() === 'annual due soon';
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('checkGeotab') === '1') {
      const diagnostic = await diagnoseGeotabConnection(env);
      const status = diagnostic.ok ? 200 : diagnostic.authenticated ? 403 : 401;
      return Response.json(diagnostic, { status, headers: { 'cache-control': 'no-store' } });
    }

    const [payload, maintenanceRepairs] = await Promise.all([
      getDashboardData(env.DB, isGeotabConfigured(env)),
      getMaintenanceBoardItems(env.DB),
    ]);

    payload.dvir = payload.dvir.filter((defect) => !defect.repaired);
    payload.repairs = [
      ...maintenanceRepairs.filter((repair) => !annualNotDueYet(repair.status)),
      ...payload.repairs,
    ];

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
    if (action === 'saveRepair') {
      if (isMaintenanceId(body.id)) throw new Error('PM and annual cards are completed with the Complete button on the Repair Board.');
      return Response.json(await saveRepair(env.DB, body));
    }
    if (action === 'completeRepair') {
      const maintenance = await completeMaintenanceBoardItem(env.DB, body.id);
      if (maintenance) return Response.json({ ok: true, ...maintenance });
      return Response.json(await completeRepair(env.DB, body.id));
    }
    if (action === 'markRepaired') {
      return Response.json(await markGeotabDefectRepaired(
        env,
        String(body.logId ?? ''),
        String(body.defectId ?? ''),
      ));
    }
    if (action === 'syncGeotab') {
      // Device sync can see tracked trailers as Devices too. Run it first so the
      // Trailer collection is the final authority for equipment classification.
      const fleet = await syncGeotabFleetMaster(env);
      const dvir = await syncGeotabDvir(env);
      return Response.json({ ok: true, dvir, fleet }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json({ error: 'Unknown repair action' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'repair_api_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Repair action failed' }, { status: 400 });
  }
}
