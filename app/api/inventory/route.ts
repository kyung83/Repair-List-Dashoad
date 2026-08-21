import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { adjustStock, getInventoryData, savePart, savePartSettings } from '@/lib/inventory-db';
import { decorateInventoryDataDerived } from '@/lib/derived-reservations';
import { recordPhysicalCount, resolvePhysicalCountIssue, saveNormalizedVendor } from '@/lib/inventory-operations';

export async function GET() {
  try {
    const data = await getInventoryData(env.DB);
    return Response.json(await decorateInventoryDataDerived(env.DB,data),{headers:{'cache-control':'no-store'}});
  } catch (error) {
    console.error(JSON.stringify({event:'inventory_get_failed',error:String(error)}));
    return Response.json({error:'Inventory could not be loaded.'},{status:500});
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string,unknown>;
    const action = String(body.action ?? '');
    if (action === 'savePart') return Response.json(await savePart(env.DB,body));
    if (action === 'savePartSettings') return Response.json(await savePartSettings(env.DB,body));
    if (action === 'saveVendor') return Response.json(await saveNormalizedVendor(env.DB,body));

    if (action === 'recordPhysicalCount') {
      const user = await getSessionUser(env.DB,request);
      if (!user) throw new Error('Authentication required.');
      return Response.json(await recordPhysicalCount(env.DB,{
        partId:body.partId,warehouseCode:body.warehouseCode,countedQuantity:body.countedQuantity,
        stockVersion:body.stockVersion,reason:body.reason,userId:user.id,
      }));
    }
    if (action === 'resolvePhysicalCount') {
      const user = await getSessionUser(env.DB,request);
      if (!user || (user.role !== 'manager' && user.role !== 'admin')) throw new Error('Manager or administrator access is required to resolve a stock discrepancy.');
      return Response.json(await resolvePhysicalCountIssue(env.DB,{
        issueId:body.issueId,
        operationKey:String(body.operationKey ?? request.headers.get('idempotency-key') ?? `count-resolution:${crypto.randomUUID()}`),
        userId:user.id,note:body.note,
      }));
    }

    if (action === 'adjustStock') {
      const delta = Number(body.delta ?? 0);
      if (!Number.isFinite(delta) || delta === 0) throw new Error('Enter a non-zero stock adjustment.');
      if (delta < 0) throw new Error('Negative manual stock adjustments are disabled. Record a physical count so the discrepancy is reviewed and auditable.');
      return Response.json(await adjustStock(env.DB,body));
    }
    return Response.json({error:'Unknown inventory action.'},{status:400});
  } catch (error) {
    console.error(JSON.stringify({event:'inventory_post_failed',error:String(error)}));
    return Response.json({error:error instanceof Error ? error.message : 'Inventory action failed.'},{status:400});
  }
}
