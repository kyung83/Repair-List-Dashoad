import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getWarehousePartSettings, saveWarehousePartSettings, WarehouseSettingsError } from '@/lib/inventory-warehouse-settings';

const headers = {'cache-control': 'no-store'};

async function manager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new WarehouseSettingsError('Authentication required.', 401);
  if (user.role !== 'manager' && user.role !== 'admin') throw new WarehouseSettingsError('Manager or administrator access is required.', 403);
  return user;
}

function failure(error: unknown) {
  if (error instanceof WarehouseSettingsError) return Response.json({error:error.message}, {status:error.status,headers});
  console.error(JSON.stringify({event:'inventory_warehouse_settings_failed',error:String(error)}));
  return Response.json({error:'Warehouse settings could not be saved or loaded. Please try again.'}, {status:500,headers});
}

export async function GET(request: Request) {
  try {
    await manager(request);
    const url = new URL(request.url);
    return Response.json(await getWarehousePartSettings(env.DB, url.searchParams.get('partId'), url.searchParams.get('warehouseCode')), {headers});
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await manager(request);
    let body: unknown;
    try { body = await request.json(); } catch { throw new WarehouseSettingsError('The settings request must contain valid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WarehouseSettingsError('The settings request is invalid.');
    return Response.json(await saveWarehousePartSettings(env.DB, body as Record<string, unknown>, user.id), {headers});
  } catch (error) { return failure(error); }
}
