const finite=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clean=(value:unknown,max=200)=>String(value??'').trim().slice(0,max);

export async function listOneTimeParts(db:D1Database){
  const rows=await db.prepare(`
    SELECT p.id,p.part_number,p.description,p.unit_cost,p.preferred_vendor_id,
           COALESCE(v.name,'') AS vendor_name,
           w.id AS warehouse_id,w.code AS warehouse_code,w.name AS warehouse_name,
           COALESCE(SUM(s.quantity_on_hand),0) AS quantity_available,
           MAX(r.reference) AS reference,
           MAX(r.created_at) AS last_received_at
    FROM parts p
    JOIN part_warehouse_stock s ON s.part_id=p.id
    JOIN warehouses w ON w.id=s.warehouse_id AND w.active=1
    LEFT JOIN vendors v ON v.id=p.preferred_vendor_id
    LEFT JOIN one_time_part_receipts r ON r.part_id=p.id AND r.warehouse_id=w.id
    WHERE p.active=1 AND p.deleted_at IS NULL AND p.inventory_class='one_time'
    GROUP BY p.id,p.part_number,p.description,p.unit_cost,p.preferred_vendor_id,v.name,w.id,w.code,w.name
    HAVING COALESCE(SUM(s.quantity_on_hand),0)>0.000001
    ORDER BY MAX(r.created_at) DESC,p.description,p.part_number
  `).all<any>();
  return rows.results.map((row:any)=>({
    id:Number(row.id),
    partNumber:row.part_number,
    description:row.description,
    unitCost:row.unit_cost==null?null:Number(row.unit_cost),
    preferredVendorId:row.preferred_vendor_id==null?null:Number(row.preferred_vendor_id),
    vendorName:row.vendor_name,
    warehouseId:Number(row.warehouse_id),
    warehouseCode:row.warehouse_code,
    warehouseName:row.warehouse_name,
    quantityAvailable:Number(row.quantity_available),
    reference:row.reference??'',
    lastReceivedAt:row.last_received_at??'',
    inventoryClass:'one_time' as const,
  }));
}

export async function createOneTimePart(db:D1Database,input:{
  partNumber?:unknown;description?:unknown;warehouseCode?:unknown;quantity?:unknown;unitCost?:unknown;
  vendorId?:unknown;reference?:unknown;notes?:unknown;userId?:number|null;
}){
  const description=clean(input.description,300);
  const warehouseCode=clean(input.warehouseCode,40).toUpperCase();
  const quantity=finite(input.quantity);
  const unitCost=input.unitCost===''||input.unitCost==null?null:Math.max(0,finite(input.unitCost));
  const vendorId=finite(input.vendorId)>0?finite(input.vendorId):null;
  const reference=clean(input.reference,120);
  const notes=clean(input.notes,500);
  if(!description)throw new Error('Description is required.');
  if(!warehouseCode)throw new Error('Choose the warehouse where this one-time part will be available.');
  if(quantity<=0)throw new Error('Quantity must be greater than zero.');
  const warehouse=await db.prepare('SELECT id,code,name FROM warehouses WHERE code=? AND active=1').bind(warehouseCode).first<{id:number;code:string;name:string}>();
  if(!warehouse)throw new Error('Warehouse was not found.');
  if(vendorId){
    const vendor=await db.prepare('SELECT id FROM vendors WHERE id=? AND COALESCE(active,1)=1').bind(vendorId).first<{id:number}>();
    if(!vendor)throw new Error('Vendor was not found.');
  }

  let partNumber=clean(input.partNumber,120);
  if(!partNumber){
    const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
    partNumber=`ONE-TIME-${stamp}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
  }
  const existing=await db.prepare('SELECT id,inventory_class FROM parts WHERE part_number=? AND deleted_at IS NULL').bind(partNumber).first<{id:number;inventory_class:string}>();
  if(existing)throw new Error(existing.inventory_class==='one_time'
    ? 'That one-time part number already exists. Use the existing record or choose a different part number.'
    : 'That part number already exists as a stocked inventory item.');

  const statements=[
    db.prepare(`
      INSERT INTO parts(part_number,description,quantity_on_hand,reorder_level,preferred_vendor_id,unit_cost,location,active,inventory_class)
      VALUES(?,?,?,0,?,?,?,1,'one_time')
    `).bind(partNumber,description,quantity,vendorId,unitCost,`ONE-TIME · ${warehouse.name}`),
    db.prepare(`
      INSERT INTO part_warehouse_stock(part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure,unit_cost,on_order)
      SELECT p.id,?, '',?,'EA',?,0
      FROM parts p WHERE p.part_number=? AND p.inventory_class='one_time'
    `).bind(warehouse.id,quantity,unitCost,partNumber),
    db.prepare(`
      INSERT INTO one_time_part_receipts(part_id,warehouse_id,vendor_id,quantity_received,unit_cost,reference,notes,created_by_user_id)
      SELECT p.id,?,?,?,?,?,?,?
      FROM parts p WHERE p.part_number=? AND p.inventory_class='one_time'
    `).bind(warehouse.id,vendorId,quantity,unitCost,reference,notes,input.userId??null,partNumber),
    ...(vendorId?[db.prepare(`
      INSERT OR IGNORE INTO part_vendors(part_id,vendor_id)
      SELECT id,? FROM parts WHERE part_number=? AND inventory_class='one_time'
    `).bind(vendorId,partNumber)]:[]),
  ];
  await db.batch(statements);
  const created=await db.prepare("SELECT id FROM parts WHERE part_number=? AND inventory_class='one_time' AND deleted_at IS NULL").bind(partNumber).first<{id:number}>();
  const partId=Number(created?.id??0);
  if(!partId)throw new Error('One-time part could not be created.');

  return {ok:true,partId,partNumber,description,warehouseCode:warehouse.code,warehouseName:warehouse.name,quantity,unitCost,inventoryClass:'one_time' as const};
}

export async function convertOneTimePartToStock(db:D1Database,input:{partId?:unknown;userId?:number|null}){
  const partId=finite(input.partId);
  if(!Number.isInteger(partId)||partId<=0)throw new Error('Choose a one-time part.');
  const part=await db.prepare(`
    SELECT id,part_number,description,inventory_class
    FROM parts WHERE id=? AND active=1 AND deleted_at IS NULL
  `).bind(partId).first<{id:number;part_number:string;description:string;inventory_class:string}>();
  if(!part)throw new Error('Part was not found.');
  if(part.inventory_class!=='one_time')return {ok:true,partId,alreadyStock:true};
  await db.prepare(`
    UPDATE parts
    SET inventory_class='stock',
        converted_to_stock_at=CURRENT_TIMESTAMP,
        location=CASE WHEN location LIKE 'ONE-TIME%' THEN '' ELSE location END,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND inventory_class='one_time'
  `).bind(partId).run();
  return {ok:true,partId,partNumber:part.part_number,description:part.description,inventoryClass:'stock' as const};
}


export async function listOneTimePartHistory(db:D1Database){
  const rows=await db.prepare(`
    SELECT p.id,p.part_number,p.description,p.unit_cost,p.preferred_vendor_id,
           COALESCE(v.name,'') AS vendor_name,
           COALESCE((SELECT SUM(s.quantity_on_hand) FROM part_warehouse_stock s WHERE s.part_id=p.id),0) AS quantity_available,
           COALESCE((SELECT COUNT(*) FROM one_time_part_receipts r WHERE r.part_id=p.id),0) AS purchase_count,
           COALESCE((SELECT SUM(r.quantity_received) FROM one_time_part_receipts r WHERE r.part_id=p.id),0) AS quantity_purchased,
           COALESCE((SELECT COUNT(DISTINCT rp.repair_id) FROM repair_parts rp WHERE rp.part_id=p.id AND COALESCE(rp.source_type,'stock')='one_time'),0) AS repair_count,
           COALESCE((SELECT SUM(rp.quantity) FROM repair_parts rp WHERE rp.part_id=p.id AND COALESCE(rp.source_type,'stock')='one_time'),0) AS quantity_used,
           (SELECT r.reference FROM one_time_part_receipts r WHERE r.part_id=p.id ORDER BY r.id DESC LIMIT 1) AS last_reference,
           (SELECT r.created_at FROM one_time_part_receipts r WHERE r.part_id=p.id ORDER BY r.id DESC LIMIT 1) AS last_received_at,
           (SELECT r.unit_cost FROM one_time_part_receipts r WHERE r.part_id=p.id ORDER BY r.id DESC LIMIT 1) AS last_unit_cost,
           (SELECT w.code FROM one_time_part_receipts r JOIN warehouses w ON w.id=r.warehouse_id WHERE r.part_id=p.id ORDER BY r.id DESC LIMIT 1) AS last_warehouse_code,
           (SELECT w.name FROM one_time_part_receipts r JOIN warehouses w ON w.id=r.warehouse_id WHERE r.part_id=p.id ORDER BY r.id DESC LIMIT 1) AS last_warehouse_name
    FROM parts p
    LEFT JOIN vendors v ON v.id=p.preferred_vendor_id
    WHERE p.active=1 AND p.deleted_at IS NULL AND p.inventory_class='one_time'
    ORDER BY COALESCE((SELECT MAX(r.created_at) FROM one_time_part_receipts r WHERE r.part_id=p.id),'') DESC,
             p.part_number COLLATE NOCASE
  `).all<any>();
  return rows.results.map((row:any)=>({
    id:Number(row.id),
    partNumber:row.part_number,
    description:row.description,
    unitCost:row.unit_cost==null?null:Number(row.unit_cost),
    lastUnitCost:row.last_unit_cost==null?null:Number(row.last_unit_cost),
    preferredVendorId:row.preferred_vendor_id==null?null:Number(row.preferred_vendor_id),
    vendorName:row.vendor_name??'',
    quantityAvailable:finite(row.quantity_available),
    purchaseCount:Number(row.purchase_count??0),
    quantityPurchased:finite(row.quantity_purchased),
    repairCount:Number(row.repair_count??0),
    quantityUsed:finite(row.quantity_used),
    reference:row.last_reference??'',
    lastReceivedAt:row.last_received_at??'',
    lastWarehouseCode:row.last_warehouse_code??'',
    lastWarehouseName:row.last_warehouse_name??'',
    inventoryClass:'one_time' as const,
  }));
}

export async function receiveExistingOneTimePart(db:D1Database,input:{
  partId?:unknown;warehouseCode?:unknown;quantity?:unknown;unitCost?:unknown;
  vendorId?:unknown;reference?:unknown;notes?:unknown;userId?:number|null;
}){
  const partId=finite(input.partId);
  const warehouseCode=clean(input.warehouseCode,40).toUpperCase();
  const quantity=finite(input.quantity,NaN);
  const unitCost=input.unitCost===''||input.unitCost==null?null:Math.max(0,finite(input.unitCost,NaN));
  const vendorId=finite(input.vendorId)>0?finite(input.vendorId):null;
  const reference=clean(input.reference,120);
  const notes=clean(input.notes,500);

  if(!Number.isInteger(partId)||partId<=0)throw new Error('Choose the previous one-time part.');
  if(!warehouseCode)throw new Error('Choose the warehouse receiving this one-time part.');
  if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantity must be greater than zero.');
  if(unitCost!==null&&!Number.isFinite(unitCost))throw new Error('Unit cost is invalid.');

  const [part,warehouse]=await Promise.all([
    db.prepare(`
      SELECT id,part_number,description,unit_cost,preferred_vendor_id,inventory_class
      FROM parts
      WHERE id=? AND active=1 AND deleted_at IS NULL
    `).bind(partId).first<{id:number;part_number:string;description:string;unit_cost:number|null;preferred_vendor_id:number|null;inventory_class:string}>(),
    db.prepare('SELECT id,code,name FROM warehouses WHERE code=? AND active=1')
      .bind(warehouseCode).first<{id:number;code:string;name:string}>(),
  ]);
  if(!part)throw new Error('Part was not found.');
  if(part.inventory_class!=='one_time')throw new Error('That part is already a stocked inventory item.');
  if(!warehouse)throw new Error('Warehouse was not found.');
  if(vendorId){
    const vendor=await db.prepare('SELECT id FROM vendors WHERE id=? AND COALESCE(active,1)=1').bind(vendorId).first<{id:number}>();
    if(!vendor)throw new Error('Vendor was not found.');
  }

  await db.prepare(`
    INSERT OR IGNORE INTO part_warehouse_stock
      (part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure,unit_cost,on_order)
    VALUES(?,?,'',0,'EA',?,0)
  `).bind(partId,warehouse.id,unitCost).run();

  const stock=await db.prepare(`
    SELECT id,quantity_on_hand,unit_cost
    FROM part_warehouse_stock
    WHERE part_id=? AND warehouse_id=?
    ORDER BY CASE WHEN variant_key='' THEN 0 ELSE 1 END,id
    LIMIT 1
  `).bind(partId,warehouse.id).first<{id:number;quantity_on_hand:number;unit_cost:number|null}>();
  if(!stock)throw new Error('Warehouse stock row could not be created.');

  const existingQty=Math.max(0,finite(stock.quantity_on_hand));
  const priorCost=stock.unit_cost==null?(part.unit_cost==null?null:finite(part.unit_cost)):finite(stock.unit_cost);
  const effectiveCost=unitCost??priorCost;
  const blendedCost=unitCost!==null&&priorCost!==null&&existingQty>0
    ?((existingQty*priorCost)+(quantity*unitCost))/(existingQty+quantity)
    :effectiveCost;

  const statements:D1PreparedStatement[]=[
    db.prepare(`
      UPDATE part_warehouse_stock
      SET quantity_on_hand=quantity_on_hand+?,
          unit_cost=COALESCE(?,unit_cost),
          last_purchase_received=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(quantity,blendedCost,stock.id),
    db.prepare(`
      UPDATE parts
      SET quantity_on_hand=COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id=?),0),
          unit_cost=COALESCE(?,unit_cost),
          preferred_vendor_id=COALESCE(?,preferred_vendor_id),
          location='ONE-TIME',
          updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND inventory_class='one_time'
    `).bind(partId,blendedCost,vendorId,partId),
    db.prepare(`
      INSERT INTO one_time_part_receipts(part_id,warehouse_id,vendor_id,quantity_received,unit_cost,reference,notes,created_by_user_id)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(partId,warehouse.id,vendorId,quantity,unitCost,reference,notes,input.userId??null),
    ...(vendorId?[db.prepare('INSERT OR IGNORE INTO part_vendors(part_id,vendor_id) VALUES(?,?)').bind(partId,vendorId)]:[]),
  ];
  await db.batch(statements);

  const total=await db.prepare('SELECT COALESCE(SUM(quantity_on_hand),0) AS quantity FROM part_warehouse_stock WHERE part_id=?')
    .bind(partId).first<{quantity:number}>();
  await db.prepare('UPDATE parts SET quantity_on_hand=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(finite(total?.quantity),partId).run();

  return {
    ok:true,
    partId,
    partNumber:part.part_number,
    description:part.description,
    warehouseCode:warehouse.code,
    warehouseName:warehouse.name,
    quantity,
    quantityAvailable:finite(total?.quantity),
    unitCost:unitCost??blendedCost,
    inventoryClass:'one_time' as const,
  };
}
