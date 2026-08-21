const EPSILON = 0.000001;
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export type DerivedAvailability = {
  partId:number; partNumber:string; description:string; warehouseId:number; warehouseCode:string; warehouseName:string;
  physicalOnHand:number; reserved:number; available:number; onOrder:number; minimumQuantity:number;
};

export async function getDerivedPartAvailability(db: D1Database): Promise<DerivedAvailability[]> {
  const rows = await db.prepare(`
    WITH keys AS (
      SELECT part_id,warehouse_id FROM part_warehouse_stock
      UNION SELECT part_id,warehouse_id FROM repair_part_requests WHERE status='open'
      UNION SELECT part_id,warehouse_id FROM part_warehouse_minimums
    ), stock AS (
      SELECT part_id,warehouse_id,SUM(quantity_on_hand) AS physical_on_hand,SUM(on_order) AS on_order
      FROM part_warehouse_stock GROUP BY part_id,warehouse_id
    ), reserved AS (
      SELECT part_id,warehouse_id,SUM(reserved_quantity) AS reserved
      FROM derived_repair_part_reservations GROUP BY part_id,warehouse_id
    )
    SELECT k.part_id,p.part_number,p.description,w.id AS warehouse_id,w.code AS warehouse_code,w.name AS warehouse_name,
           COALESCE(s.physical_on_hand,0) AS physical_on_hand,COALESCE(s.on_order,0) AS on_order,
           COALESCE(r.reserved,0) AS reserved,COALESCE(m.minimum_quantity,p.reorder_level,0) AS minimum_quantity
    FROM keys k
    JOIN parts p ON p.id=k.part_id AND p.active=1
    JOIN warehouses w ON w.id=k.warehouse_id AND w.active=1
    LEFT JOIN stock s ON s.part_id=k.part_id AND s.warehouse_id=k.warehouse_id
    LEFT JOIN reserved r ON r.part_id=k.part_id AND r.warehouse_id=k.warehouse_id
    LEFT JOIN part_warehouse_minimums m ON m.part_id=k.part_id AND m.warehouse_id=k.warehouse_id
    ORDER BY p.description,p.part_number,w.name
  `).all<{
    part_id:number;part_number:string;description:string;warehouse_id:number;warehouse_code:string;warehouse_name:string;
    physical_on_hand:number;on_order:number;reserved:number;minimum_quantity:number;
  }>();
  return rows.results.map((row)=>{
    const physicalOnHand=finite(row.physical_on_hand); const reserved=finite(row.reserved);
    return {partId:Number(row.part_id),partNumber:row.part_number,description:row.description,warehouseId:Number(row.warehouse_id),warehouseCode:row.warehouse_code,warehouseName:row.warehouse_name,physicalOnHand,reserved,available:physicalOnHand-reserved,onOrder:finite(row.on_order),minimumQuantity:finite(row.minimum_quantity)};
  });
}

export async function getDerivedRepairPartRequests(db: D1Database) {
  const rows = await db.prepare(`
    SELECT q.id,q.repair_id,q.part_id,q.warehouse_id,q.requested_quantity,q.used_quantity,q.created_at,q.updated_at,
           COALESCE(d.reserved_quantity,0) AS reserved_quantity,p.part_number,p.description,w.code AS warehouse_code,w.name AS warehouse_name,
           COALESCE(e.unit,'') AS unit,r.technician_id,COALESCE(t.name,'') AS technician_name,COALESCE(r.priority,'2') AS priority,
           COALESCE(e.out_of_service,0) AS out_of_service
    FROM repair_part_requests q
    JOIN repairs r ON r.id=q.repair_id
    JOIN parts p ON p.id=q.part_id
    JOIN warehouses w ON w.id=q.warehouse_id
    LEFT JOIN equipment e ON e.id=r.equipment_id
    LEFT JOIN technicians t ON t.id=r.technician_id
    LEFT JOIN derived_repair_part_reservations d ON d.request_id=q.id
    WHERE q.status='open' AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
    ORDER BY COALESCE(e.out_of_service,0) DESC,
      CASE trim(COALESCE(r.priority,'2')) WHEN '1' THEN 0 WHEN '2' THEN 1 WHEN '3' THEN 2 ELSE 1 END,
      q.created_at,q.id
  `).all<any>();
  return rows.results.map((row:any)=>{
    const requestedQuantity=finite(row.requested_quantity); const usedQuantity=finite(row.used_quantity);
    const remainingQuantity=Math.max(0,requestedQuantity-usedQuantity); const reservedQuantity=Math.min(remainingQuantity,finite(row.reserved_quantity));
    const shortageQuantity=Math.max(0,remainingQuantity-reservedQuantity);
    return {id:Number(row.id),repairId:`repair-${row.repair_id}`,repairNumericId:Number(row.repair_id),partId:Number(row.part_id),partNumber:row.part_number,description:row.description,warehouseId:Number(row.warehouse_id),warehouseCode:row.warehouse_code,warehouseName:row.warehouse_name,unit:row.unit,technicianId:row.technician_id==null?null:Number(row.technician_id),assignedTo:row.technician_name,priority:row.priority,outOfService:Boolean(row.out_of_service),requestedQuantity,reservedQuantity,usedQuantity,remainingQuantity,shortageQuantity,state:remainingQuantity<=EPSILON?'used':reservedQuantity+EPSILON>=remainingQuantity?'available':reservedQuantity>EPSILON?'partially_available':'awaiting_parts',createdAt:row.created_at,updatedAt:row.updated_at};
  });
}

export async function requestPartDerived(db: D1Database,input:{repairId:number;partId:number;quantity:number;warehouseCode:string;userId?:number|null}) {
  if (!Number.isInteger(input.repairId)||input.repairId<=0||!Number.isInteger(input.partId)||input.partId<=0||!Number.isFinite(input.quantity)||input.quantity<=0) throw new Error('Repair, part, and positive quantity are required.');
  const warehouse=await db.prepare('SELECT id,code FROM warehouses WHERE code=? AND active=1').bind(String(input.warehouseCode??'').trim().toUpperCase()).first<{id:number;code:string}>();
  if(!warehouse) throw new Error('Choose the warehouse that will supply this repair.');
  const repair=await db.prepare("SELECT id,COALESCE(status,'') AS status FROM repairs WHERE id=?").bind(input.repairId).first<{id:number;status:string}>();
  if(!repair||repair.status.toLowerCase().includes('complete')) throw new Error('Only open repairs can request parts.');
  const part=await db.prepare('SELECT part_number FROM parts WHERE id=? AND active=1').bind(input.partId).first<{part_number:string}>();
  if(!part) throw new Error('Part was not found.');
  await db.prepare(`
    INSERT INTO repair_part_requests (repair_id,part_id,warehouse_id,requested_quantity,reserved_quantity,requested_by_user_id)
    VALUES (?,?,?,?,0,?)
    ON CONFLICT(repair_id,part_id,warehouse_id) DO UPDATE SET requested_quantity=repair_part_requests.requested_quantity+excluded.requested_quantity,status='open',closed_at=NULL,updated_at=CURRENT_TIMESTAMP
  `).bind(input.repairId,input.partId,warehouse.id,input.quantity,input.userId??null).run();
  const current=await db.prepare('SELECT id FROM repair_part_requests WHERE repair_id=? AND part_id=? AND warehouse_id=?').bind(input.repairId,input.partId,warehouse.id).first<{id:number}>();
  const requests=await getDerivedRepairPartRequests(db); const row=requests.find((item:any)=>item.id===Number(current?.id));
  if(!row) throw new Error('Part request could not be reloaded.');
  return {ok:true,requestId:row.id,repairId:input.repairId,partId:input.partId,partNumber:part.part_number,warehouseCode:warehouse.code,requestedQuantity:input.quantity,reservedQuantity:row.reservedQuantity,shortageQuantity:row.shortageQuantity,awaitingParts:row.shortageQuantity>EPSILON,partiallyAvailable:row.reservedQuantity>EPSILON&&row.shortageQuantity>EPSILON};
}

export async function releaseDerivedRepairRequests(db:D1Database,repairId:number) {
  const result=await db.prepare(`UPDATE repair_part_requests SET status='closed',reserved_quantity=0,closed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE repair_id=? AND status='open'`).bind(repairId).run();
  return {released:Number(result.meta.changes??0)};
}

export async function getPartsDeskDataDerived(db:D1Database) {
  const [availability,requests]=await Promise.all([getDerivedPartAvailability(db),getDerivedRepairPartRequests(db)]);
  const byKey=new Map(availability.map((row)=>[`${row.partId}:${row.warehouseId}`,row]));
  const groups=new Map<string,any>();
  for(const request of requests){const key=`${request.partId}:${request.warehouseId}`;const group=groups.get(key)??{partId:request.partId,partNumber:request.partNumber,description:request.description,warehouseId:request.warehouseId,warehouseCode:request.warehouseCode,warehouseName:request.warehouseName,requested:0,reserved:0,used:0,shortage:0,waitingJobs:[]};group.requested+=request.requestedQuantity;group.reserved+=request.reservedQuantity;group.used+=request.usedQuantity;group.shortage+=request.shortageQuantity;group.waitingJobs.push(request);groups.set(key,group);}
  const jobShortages=[...groups.values()].filter((g)=>g.shortage>EPSILON).map((g)=>({...g,stock:byKey.get(`${g.partId}:${g.warehouseId}`)??null}));
  const lowStock=availability.filter((row)=>row.minimumQuantity>0&&row.available<=row.minimumQuantity).map((row)=>({...row,reorderSuggested:Math.max(0,row.minimumQuantity-row.available-row.onOrder)}));
  return {jobShortages,requests,lowStock,availability,summary:{shortageLines:jobShortages.length,waitingJobs:requests.filter((r:any)=>r.shortageQuantity>EPSILON).length,readyJobs:requests.filter((r:any)=>r.reservedQuantity>EPSILON).length,lowStockLines:lowStock.length},updatedAt:new Date().toISOString()};
}

export async function decorateShopPartsDerived(db:D1Database,parts:any[]) {
  const availability=await getDerivedPartAvailability(db); const byPart=new Map<number,DerivedAvailability[]>();
  for(const row of availability){const list=byPart.get(row.partId)??[];list.push(row);byPart.set(row.partId,list);}
  return parts.map((part)=>{const rows=byPart.get(Number(part.id))??[];const physicalOnHand=rows.reduce((s,r)=>s+r.physicalOnHand,0);const reserved=rows.reduce((s,r)=>s+r.reserved,0);const available=physicalOnHand-reserved;return {...part,quantityOnHand:rows.length?available:part.quantityOnHand,physicalOnHand,reserved,available,onOrder:rows.reduce((s,r)=>s+r.onOrder,0),warehouseStocks:rows.map((r)=>({warehouseId:r.warehouseId,warehouseCode:r.warehouseCode,warehouseName:r.warehouseName,quantityOnHand:r.available,physicalOnHand:r.physicalOnHand,reserved:r.reserved,available:r.available,onOrder:r.onOrder,minimumQuantity:r.minimumQuantity}))};});
}

export async function decorateInventoryDataDerived(db:D1Database,data:any) {
  const availability=await getDerivedPartAvailability(db);const byPart=new Map<number,DerivedAvailability[]>();for(const row of availability){const list=byPart.get(row.partId)??[];list.push(row);byPart.set(row.partId,list);}
  const parts=(data.parts??[]).map((part:any)=>{const rows=byPart.get(Number(part.id))??[];const originals=part.warehouseStocks??[];const physicalOnHand=rows.reduce((s,r)=>s+r.physicalOnHand,0);const reserved=rows.reduce((s,r)=>s+r.reserved,0);const available=physicalOnHand-reserved;const warehouseStocks=rows.map((r)=>({...originals.find((o:any)=>o.warehouseCode===r.warehouseCode),warehouseCode:r.warehouseCode,warehouseName:r.warehouseName,quantityOnHand:r.available,physicalOnHand:r.physicalOnHand,reserved:r.reserved,available:r.available,onOrder:r.onOrder,minimumQuantity:r.minimumQuantity}));return {...part,quantityOnHand:rows.length?available:part.quantityOnHand,physicalOnHand:rows.length?physicalOnHand:part.quantityOnHand,reserved,available:rows.length?available:part.quantityOnHand,onOrder:rows.reduce((s,r)=>s+r.onOrder,0),warehouseStocks,lowStock:rows.length?rows.some((r)=>r.available<=r.minimumQuantity):part.lowStock};});
  const summary=data.summary?{...data.summary,lowStockCount:parts.filter((p:any)=>p.lowStock).length,totalUnits:parts.reduce((s:number,p:any)=>s+finite(p.quantityOnHand),0),physicalUnits:parts.reduce((s:number,p:any)=>s+finite(p.physicalOnHand),0),reservedUnits:parts.reduce((s:number,p:any)=>s+finite(p.reserved),0)}:undefined;
  return {...data,parts,...(summary?{summary}:{})};
}
