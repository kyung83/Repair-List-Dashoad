import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  getPartsDeskData,
  orderPartForWarehouse,
  receivePartForWarehouse,
} from '@/lib/parts-lifecycle';
import { getUnmatchedPartRequests, handleUnmatchedPartRequest, matchUnmatchedPartRequestToCatalog } from '@/lib/unmatched-parts';
import { createOneTimePart, convertOneTimePartToStock, listOneTimeParts, listOneTimePartHistory, receiveExistingOneTimePart } from '@/lib/one-time-parts';

async function requirePartsDeskUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Parts Desk requires manager or admin access.');
  return user;
}

export async function GET(request: Request) {
  try {
    await requirePartsDeskUser(request);
    const [data, unmatchedPartRequests, oneTimeParts, oneTimeHistory, warehouses, vendors] = await Promise.all([
      getPartsDeskData(env.DB),
      getUnmatchedPartRequests(env.DB),
      listOneTimeParts(env.DB),
      listOneTimePartHistory(env.DB),
      env.DB.prepare('SELECT id,code,name FROM warehouses WHERE active=1 ORDER BY name COLLATE NOCASE')
        .all<{id:number;code:string;name:string}>(),
      env.DB.prepare('SELECT id,name FROM vendors WHERE COALESCE(active,1)=1 ORDER BY name COLLATE NOCASE')
        .all<{id:number;name:string}>(),
    ]);
    return Response.json({
      ...data,
      unmatchedPartRequests,
      oneTimeParts,
      oneTimeHistory,
      warehouses:warehouses.results.map(row=>({id:Number(row.id),code:row.code,name:row.name})),
      vendors:vendors.results.map(row=>({id:Number(row.id),name:row.name})),
      summary:{...data.summary,unmatchedParts:unmatchedPartRequests.length,oneTimeParts:oneTimeParts.length},
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Parts Desk could not be loaded.' }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePartsDeskUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'handleUnmatched') {
      return Response.json(await handleUnmatchedPartRequest(env.DB, Number(body.requestId ?? 0)));
    }
    if (action === 'matchUnmatchedToCatalog') {
      return Response.json(await matchUnmatchedPartRequestToCatalog(env.DB,{
        requestId:Number(body.requestId??0),
        partId:Number(body.partId??0),
        warehouseCode:String(body.warehouseCode??''),
        userId:user.id,
      }));
    }
    if (action === 'createOneTimePart') {
      const created = await createOneTimePart(env.DB,{
        partNumber:body.partNumber,
        description:body.description,
        warehouseCode:body.warehouseCode,
        quantity:body.quantity,
        unitCost:body.unitCost,
        vendorId:body.vendorId,
        reference:body.reference,
        notes:body.notes,
        userId:user.id,
      });
      const sourceRequestId=Number(body.sourceRequestId??0);
      if(sourceRequestId>0) await handleUnmatchedPartRequest(env.DB,sourceRequestId);
      return Response.json({...created,sourceRequestHandled:sourceRequestId>0});
    }
    if (action === 'receiveExistingOneTimePart') {
      return Response.json(await receiveExistingOneTimePart(env.DB,{
        partId:body.partId,
        warehouseCode:body.warehouseCode,
        quantity:body.quantity,
        unitCost:body.unitCost,
        vendorId:body.vendorId,
        reference:body.reference,
        notes:body.notes,
        userId:user.id,
      }));
    }
    if (action === 'convertOneTimePart') {
      return Response.json(await convertOneTimePartToStock(env.DB,{partId:body.partId,userId:user.id}));
    }
    const partId = Number(body.partId ?? 0);
    const warehouseCode = String(body.warehouseCode ?? '');
    const quantity = Number(body.quantity ?? 0);
    if (action === 'order') {
      return Response.json(await orderPartForWarehouse(env.DB, { partId, warehouseCode, quantity, userId: user.id }));
    }
    if (action === 'receive') {
      return Response.json(await receivePartForWarehouse(env.DB, { partId, warehouseCode, quantity, userId: user.id }));
    }
    return Response.json({ error: 'Unknown Parts Desk action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'parts_desk_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Parts Desk action failed.' }, { status: 400 });
  }
}
