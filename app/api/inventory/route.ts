import { env } from 'cloudflare:workers';
import { adjustStock, getInventoryData, savePart, saveVendor, usePartOnRepair } from '@/lib/dashboard-db';

export async function GET() {
  try {
    return Response.json(await getInventoryData(env.DB), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'inventory_api_get_failed', error: String(error) }));
    return Response.json({ error: 'The inventory database could not be read.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'savePart') return Response.json(await savePart(env.DB, body));
    if (action === 'adjustStock') return Response.json(await adjustStock(env.DB, body));
    if (action === 'saveVendor') return Response.json(await saveVendor(env.DB, body));
    if (action === 'usePart') return Response.json(await usePartOnRepair(env.DB, body));
    return Response.json({ error: 'Unknown inventory action' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'inventory_api_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Inventory action failed' }, { status: 400 });
  }
}
