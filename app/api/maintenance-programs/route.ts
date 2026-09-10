import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  assignMaintenanceProgram,
  deactivateMaintenanceItem,
  deactivateMaintenanceProgram,
  getMaintenanceProgramSetup,
  removeMaintenanceProgramAssignment,
  saveMaintenanceItem,
  saveMaintenanceProgram,
} from '@/lib/maintenance-programs';

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') {
    throw new Error('Manager or administrator access is required for maintenance program setup.');
  }
  return user;
}

export async function GET(request: Request) {
  try {
    await requireManager(request);
    return Response.json(await getMaintenanceProgramSetup(env.DB), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_programs_get_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Maintenance programs could not be loaded.';
    const status = message === 'Authentication required.' ? 401 : message.startsWith('Manager or administrator') ? 403 : 500;
    return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    await requireManager(request);
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
    const message = error instanceof Error ? error.message : 'Maintenance program action failed.';
    const status = message === 'Authentication required.' ? 401 : message.startsWith('Manager or administrator') ? 403 : 400;
    return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
