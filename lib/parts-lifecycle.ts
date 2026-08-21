export * from './parts-lifecycle-legacy';

import { applyPartToRepair } from './inventory-operations';
import {
  decorateInventoryDataDerived,
  decorateShopPartsDerived,
  getDerivedPartAvailability,
  getDerivedRepairPartRequests,
  getPartsDeskDataDerived,
  releaseDerivedRepairRequests,
  requestPartDerived,
} from './derived-reservations';

const EPSILON = 0.000001;
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const getPartAvailability = getDerivedPartAvailability;
export const getRepairPartRequests = getDerivedRepairPartRequests;
export const decorateShopParts = decorateShopPartsDerived;
export const decorateInventoryData = decorateInventoryDataDerived;
export const getPartsDeskData = getPartsDeskDataDerived;
export const releaseRepairPartRequests = releaseDerivedRepairRequests;

export async function allocateWaitingForPart(
  _db: D1Database,
  _partId: number,
  _warehouseId: number,
  _userId: number | null = null,
) {
  // v2 reservations are derived from current stock + open demand. There is no
  // reservation row to mutate when stock arrives.
  return [] as { requestId:number; quantity:number }[];
}

export async function requestPartForRepair(
  db: D1Database,
  input: {
    repairId:number;
    partId:number;
    quantity:number;
    warehouseCode?:string;
    fallbackYard?:string;
    userId?:number|null;
  },
) {
  const warehouseCode = String(input.warehouseCode ?? input.fallbackYard ?? '').trim().toUpperCase();
  return requestPartDerived(db,{
    repairId:input.repairId,
    partId:input.partId,
    quantity:input.quantity,
    warehouseCode,
    userId:input.userId ?? null,
  });
}

export async function consumeReservedPart(
  db: D1Database,
  input: {requestId:number;quantity?:number;userId?:number|null;operationKey?:string},
) {
  const rows = await getDerivedRepairPartRequests(db);
  const request = rows.find((row:any)=>Number(row.id)===Number(input.requestId));
  if (!request) throw new Error('Part request was not found or is already closed.');
  const quantity = Math.min(
    input.quantity == null ? finite(request.reservedQuantity) : finite(input.quantity),
    finite(request.reservedQuantity),
    finite(request.remainingQuantity),
  );
  if (quantity <= EPSILON) throw new Error('No reserved quantity is currently available to use on this repair.');

  const operationKey = String(input.operationKey ?? `reserved-part:${request.id}:${crypto.randomUUID()}`);
  const result = await applyPartToRepair(db,{
    operationKey,
    repairId:request.repairNumericId,
    partId:request.partId,
    quantity,
    warehouseCode:request.warehouseCode,
    userId:input.userId ?? null,
    source:'technician',
    note:`Applied from derived reservation request ${request.id}.`,
  });

  if (!result.idempotent) {
    await db.prepare(`
      UPDATE repair_part_requests
      SET used_quantity = MIN(requested_quantity,used_quantity + ?),
          status = CASE WHEN used_quantity + ? >= requested_quantity - 0.000001 THEN 'closed' ELSE status END,
          closed_at = CASE WHEN used_quantity + ? >= requested_quantity - 0.000001 THEN CURRENT_TIMESTAMP ELSE closed_at END,
          reserved_quantity = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'
    `).bind(quantity,quantity,quantity,request.id).run();
  }

  return {ok:true,operationId:result.operationId,requestId:request.id,repairId:request.repairNumericId,partId:request.partId,quantity,idempotent:result.idempotent};
}
