import { env } from 'cloudflare:workers';
import {
  assignMaintenanceProgram,
  deactivateMaintenanceItem,
  deactivateMaintenanceProgram,
  getMaintenanceProgramSetup,
  removeMaintenanceProgramAssignment,
  saveMaintenanceItem,
  saveMaintenanceProgram,
} from '@/lib/maintenance-programs';

export async function GET() {
  try {
    return Response.json(await getMaintenanceProgramSetup(env.DB), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_programs_get_failed', error: String(error) }));
    return Response.json({ error: 'Maintenance programs could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'saveItem') return Response.json(await saveMaintenanceItem(env.DB, body));
    if (action === 'deactivateItem') return Response.json(await deactivateMaintenanceItem(env.DB, body));
    if (action === 'saveProgram') return Response.json(await saveMaintenanceProgram(env.DB, body));
    if (action === 'deactivateProgram') return Response.json(await deactivateMaintenanceProgram(env.DB, body));
    if (action === 'assignProgram') return Response.json(await assignMaintenanceProgram(env.DB, body));
    if (action === 'removeProgram') return Response.json(await removeMaintenanceProgramAssignment(env.DB, body));
    return Response.json({ error: 'Unknown maintenance program action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_programs_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Maintenance program action failed.' }, { status: 400 });
  }
}
