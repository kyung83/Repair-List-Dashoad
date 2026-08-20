import { env } from 'cloudflare:workers';
import { bulkArchiveEquipmentMasterItems } from '@/lib/equipment-bulk-archive';
import {
  archiveEquipmentMasterItem,
  getEquipmentMaster,
  restoreEquipmentMasterItem,
  saveEquipmentMasterItem,
} from '@/lib/equipment-master-tracking';

export async function GET() {
  try {
    return Response.json(await getEquipmentMaster(env.DB), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'equipment_master_get_failed', error: String(error) }));
    return Response.json({ error: 'Equipment master could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? 'save');
    if (action === 'save') return Response.json(await saveEquipmentMasterItem(env.DB, body));
    if (action === 'archive') return Response.json(await archiveEquipmentMasterItem(env.DB, body));
    if (action === 'bulkArchive') return Response.json(await bulkArchiveEquipmentMasterItems(env.DB, body));
    if (action === 'restore') return Response.json(await restoreEquipmentMasterItem(env.DB, body));
    return Response.json({ error: 'Unknown equipment action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'equipment_master_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Equipment action failed.' }, { status: 400 });
  }
}
