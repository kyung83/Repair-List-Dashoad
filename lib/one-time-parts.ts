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

  const result=await db.prepare(`
    INSERT INTO parts(part_number,description,quantity_on_hand,reorder_level,preferred_vendor_id,unit_cost,location,active,inventory_class)
    VALUES(?,?,?,0,?,?,?,1,'one_time')
  `).bind(partNumber,description,quantity,vendorId,unitCost,`ONE-TIME · ${warehouse.name}`).run();
  const partId=Number(result.meta.last_row_id);
  if(!partId)throw new Error('One-time part could not be created.');

  await db.batch([
    db.prepare(`
      INSERT INTO part_warehouse_stock(part_id,warehouse_id,variant_key,quantity_on_hand,unit_of_measure,unit_cost,on_order)
      VALUES(?,?, '',?,'EA',?,0)
    `).bind(partId,warehouse.id,quantity,unitCost),
    db.prepare(`
      INSERT INTO one_time_part_receipts(part_id,warehouse_id,vendor_id,quantity_received,unit_cost,reference,notes,created_by_user_id)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(partId,warehouse.id,vendorId,quantity,unitCost,reference,notes,input.userId??null),
    ...(vendorId?[db.prepare('INSERT OR IGNORE INTO part_vendors(part_id,vendor_id) VALUES(?,?)').bind(partId,vendorId)]:[]),
  ]);

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
    SET inventory_class='stock',converted_to_stock_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND inventory_class='one_time'
  `).bind(partId).run();
  return {ok:true,partId,partNumber:part.part_number,description:part.description,inventoryClass:'stock' as const};
}
