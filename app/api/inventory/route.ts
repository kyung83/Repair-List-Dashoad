import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getInventoryData, savePart, savePartSettings } from '@/lib/inventory-db';
import { decorateInventoryDataDerived } from '@/lib/derived-reservations';
import { recordPhysicalCount, resolvePhysicalCountIssue, saveNormalizedVendor } from '@/lib/inventory-operations';
import { deleteUnusedPart, setPartArchived } from '@/lib/inventory-part-management';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB,request);
    if (!user) return Response.json({error:'Authentication required.'},{status:401,headers:{'cache-control':'no-store'}});
    if (user.role !== 'manager' && user.role !== 'admin') return Response.json({error:'Manager or administrator access is required.'},{status:403,headers:{'cache-control':'no-store'}});
    const requestedStatus = new URL(request.url).searchParams.get('status');
    const status = requestedStatus === 'archived' ? 'archived' : requestedStatus === 'all' ? 'all' : 'active';
    const data = await getInventoryData(env.DB,status);
    const decorated = await decorateInventoryDataDerived(env.DB,data);
    return Response.json({...decorated,viewerRole:user.role,partStatus:status},{headers:{'cache-control':'no-store'}});
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

    if (action === 'archivePart' || action === 'restorePart') {
      const user = await getSessionUser(env.DB,request);
      if (!user) throw new Error('Authentication required.');
      if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required to archive or restore a part.');
      return Response.json(await setPartArchived(env.DB,{partId:body.partId,archived:action === 'archivePart'}));
    }

    if (action === 'deletePart') {
      const user = await getSessionUser(env.DB,request);
      if (!user) throw new Error('Authentication required.');
      if (user.role !== 'admin') throw new Error('Administrator access is required to permanently delete a part.');
      return Response.json(await deleteUnusedPart(env.DB,{partId:body.partId}));
    }

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
      throw new Error('Manual +/− stock adjustments are disabled. Use Physical Count so any discrepancy is stale-checked, reviewed, and auditable.');
    }
    return Response.json({error:'Unknown inventory action.'},{status:400});
  } catch (error) {
    console.error(JSON.stringify({event:'inventory_post_failed',error:String(error)}));
    return Response.json({error:error instanceof Error ? error.message : 'Inventory action failed.'},{status:400});
  }
}
