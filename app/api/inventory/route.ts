import { env } from 'cloudflare:workers';
import { adjustStock, getInventoryData, savePart, savePartSettings, saveVendor } from '@/lib/inventory-db';
import { allocateWaitingForPart, decorateInventoryData, getPartAvailability } from '@/lib/parts-lifecycle';

export async function GET() {
  try {
    const data = await getInventoryData(env.DB);
    return Response.json(await decorateInventoryData(env.DB, data), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'inventory_get_failed', error: String(error) }));
    return Response.json({ error: 'Inventory could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'savePart') return Response.json(await savePart(env.DB, body));
    if (action === 'savePartSettings') return Response.json(await savePartSettings(env.DB, body));
    if (action === 'adjustStock') {
      const result = await adjustStock(env.DB, body);
      const delta = Number(body.delta ?? 0);
      if (delta > 0) {
        const availability = await getPartAvailability(env.DB);
        const row = availability.find((item) => item.partId === Number(result.id) && item.warehouseCode === result.warehouseCode);
        if (row) await allocateWaitingForPart(env.DB, row.partId, row.warehouseId);
      }
      return Response.json(result);
    }
    if (action === 'saveVendor') return Response.json(await saveVendor(env.DB, body));
    return Response.json({ error: 'Unknown inventory action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'inventory_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Inventory action failed.' }, { status: 400 });
  }
}
