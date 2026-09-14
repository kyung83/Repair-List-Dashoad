import { env } from 'cloudflare:workers';
import { authenticateYardCheckApiRequest, getYardCheckRepairBoardData } from '@/lib/yard-check-api';
import { normalizeYard } from '@/lib/yards';

export async function GET(request:Request) {
  try {
    const access = await authenticateYardCheckApiRequest(env.DB, request);
    if (!access) {
      return Response.json({ error:'Invalid or revoked Yard Check API key.' }, {
        status:401,
        headers:{ 'cache-control':'no-store' },
      });
    }

    const url = new URL(request.url);
    const requestedYard = normalizeYard(url.searchParams.get('yard') ?? '');
    const data = await getYardCheckRepairBoardData(env.DB);
    const items = requestedYard ? data.items.filter((item) => item.yardKey === requestedYard) : data.items;
    const units = requestedYard ? data.units.filter((unit) => unit.yardKey === requestedYard) : data.units;

    return Response.json({
      updatedAt:data.updatedAt,
      connection:access.label,
      yard:requestedYard || 'all',
      itemCount:items.length,
      unitCount:units.length,
      items,
      units,
    }, {
      headers:{
        'cache-control':'no-store',
        'x-content-type-options':'nosniff',
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event:'yard_check_api_export_failed', error:String(error) }));
    return Response.json({ error:'Yard Check Repair Board data could not be loaded.' }, {
      status:500,
      headers:{ 'cache-control':'no-store' },
    });
  }
}
