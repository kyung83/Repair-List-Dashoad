import { resolveRepairWarehouse } from './parts-lifecycle';

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 180);
}

export type UnmatchedPartRequestView = {
  id:number;
  repairId:string;
  repairNumericId:number;
  requestedText:string;
  requestedQuantity:number;
  warehouseCode:string;
  unit:string;
  technicianId:number|null;
  assignedTo:string;
  priority:string;
  outOfService:boolean;
  createdAt:string;
  updatedAt:string;
};

export async function requestUnmatchedPart(
  db:D1Database,
  input:{repairId:number;requestedText:string;quantity:number;userId?:number|null;technicianId?:number|null;fallbackYard?:string},
) {
  const text = cleanText(input.requestedText);
  const quantity = finite(input.quantity);
  if (!Number.isInteger(input.repairId) || input.repairId <= 0) throw new Error('Repair was not found.');
  if (!text) throw new Error('Type the part number or description first.');
  if (quantity <= 0) throw new Error('Enter a positive quantity.');

  const repair = await db.prepare(`SELECT id, COALESCE(status,'') AS status FROM repairs WHERE id = ?`)
    .bind(input.repairId).first<{id:number;status:string}>();
  if (!repair) throw new Error('Repair was not found.');
  if (repair.status.toLowerCase().includes('complete')) throw new Error('Completed repairs cannot request parts.');

  const warehouse = await resolveRepairWarehouse(db, input.repairId, input.fallbackYard ?? '');
  const existing = await db.prepare(`
    SELECT id, requested_quantity
    FROM unmatched_part_requests
    WHERE repair_id = ? AND status = 'open' AND lower(trim(requested_text)) = lower(trim(?))
    ORDER BY id DESC LIMIT 1
  `).bind(input.repairId, text).first<{id:number;requested_quantity:number}>();

  let requestId = 0;
  if (existing) {
    await db.prepare(`
      UPDATE unmatched_part_requests
      SET requested_quantity = requested_quantity + ?, warehouse_code = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(quantity, warehouse.code, existing.id).run();
    requestId = Number(existing.id);
  } else {
    const result = await db.prepare(`
      INSERT INTO unmatched_part_requests
        (repair_id, requested_text, requested_quantity, warehouse_code, requested_by_user_id, technician_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      input.repairId,
      text,
      quantity,
      warehouse.code,
      input.userId ?? null,
      input.technicianId ?? null,
    ).run();
    requestId = Number(result.meta.last_row_id);
  }
  if (!requestId) throw new Error('Part request could not be saved.');

  const row = await db.prepare(`
    SELECT requested_quantity FROM unmatched_part_requests WHERE id = ?
  `).bind(requestId).first<{requested_quantity:number}>();

  return {
    ok:true,
    unmatchedPart:true,
    requestId,
    repairId:input.repairId,
    requestedText:text,
    requestedQuantity:finite(row?.requested_quantity),
    addedQuantity:quantity,
    warehouseCode:warehouse.code,
  };
}

export async function getUnmatchedPartRequests(db:D1Database):Promise<UnmatchedPartRequestView[]> {
  const rows = await db.prepare(`
    SELECT q.id, q.repair_id, q.requested_text, q.requested_quantity, q.warehouse_code,
           q.created_at, q.updated_at,
           COALESCE(e.unit, '') AS unit, r.technician_id,
           COALESCE(t.name, '') AS technician_name, COALESCE(r.priority, '2') AS priority,
           COALESCE(e.out_of_service, 0) AS out_of_service
    FROM unmatched_part_requests q
    JOIN repairs r ON r.id = q.repair_id
    LEFT JOIN equipment e ON e.id = r.equipment_id
    LEFT JOIN technicians t ON t.id = r.technician_id
    WHERE q.status = 'open' AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
    ORDER BY COALESCE(e.out_of_service,0) DESC,
             CASE trim(COALESCE(r.priority,'2')) WHEN '1' THEN 0 WHEN '2' THEN 1 WHEN '3' THEN 2 ELSE 1 END,
             q.created_at ASC, q.id ASC
  `).all<{
    id:number;repair_id:number;requested_text:string;requested_quantity:number;warehouse_code:string;
    created_at:string;updated_at:string;unit:string;technician_id:number|null;technician_name:string;
    priority:string;out_of_service:number;
  }>();

  return rows.results.map(row=>({
    id:Number(row.id),
    repairId:`repair-${row.repair_id}`,
    repairNumericId:Number(row.repair_id),
    requestedText:row.requested_text,
    requestedQuantity:finite(row.requested_quantity),
    warehouseCode:row.warehouse_code,
    unit:row.unit,
    technicianId:row.technician_id==null?null:Number(row.technician_id),
    assignedTo:row.technician_name,
    priority:row.priority,
    outOfService:Boolean(row.out_of_service),
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  }));
}

export async function handleUnmatchedPartRequest(db:D1Database, requestId:number) {
  const result = await db.prepare(`
    UPDATE unmatched_part_requests
    SET status='handled', handled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'open'
  `).bind(requestId).run();
  if (Number(result.meta.changes ?? 0) === 0) throw new Error('Unmatched part request was not found or is already handled.');
  return {ok:true,requestId};
}
