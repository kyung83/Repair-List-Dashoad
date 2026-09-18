const EPSILON=0.000001;
const finite=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clean=(value:unknown,max=500)=>String(value??'').trim().replace(/\s+/g,' ').slice(0,max);

async function operationByKey(db:D1Database,key:string){
  return db.prepare('SELECT id,status FROM inventory_operations WHERE operation_key=?')
    .bind(key).first<{id:number;status:string}>();
}

async function refreshPartTotal(db:D1Database,partId:number,unitCost:number|null){
  await db.prepare(`
    UPDATE parts
    SET quantity_on_hand=COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id=?),0),
        unit_cost=COALESCE(?,unit_cost),
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(partId,unitCost,partId).run();
}

async function targetStock(db:D1Database,partId:number,warehouseId:number,unitCost:number|null){
  await db.prepare(`
    INSERT OR IGNORE INTO part_warehouse_stock
      (part_id,warehouse_id,variant_key,quantity_on_hand,on_order,unit_cost,source_updated_at)
    VALUES (?,?,'inventory-v2',0,0,?,NULL)
  `).bind(partId,warehouseId,unitCost).run();
  const row=await db.prepare(`
    SELECT id,quantity_on_hand,unit_cost
    FROM part_warehouse_stock
    WHERE part_id=? AND warehouse_id=?
    ORDER BY CASE WHEN variant_key='' THEN 0 WHEN variant_key='inventory-v2' THEN 1 ELSE 2 END,id
    LIMIT 1
  `).bind(partId,warehouseId).first<{id:number;quantity_on_hand:number;unit_cost:number|null}>();
  if(!row)throw new Error('Warehouse stock row could not be created.');
  return row;
}

export async function receiveInventoryPart(
  db:D1Database,
  input:{
    operationKey:string;
    receiptGroupKey:string;
    partId:unknown;
    warehouseCode:unknown;
    quantity:unknown;
    unitCost?:unknown;
    vendorName?:unknown;
    invoiceNumber?:unknown;
    invoiceDate?:unknown;
    sourcePartNumber?:unknown;
    sourceDescription?:unknown;
    userId?:number|null;
  },
){
  const operationKey=clean(input.operationKey,160);
  const receiptGroupKey=clean(input.receiptGroupKey,160);
  const partId=Number(input.partId??0);
  const quantity=finite(input.quantity,NaN);
  const unitCost=input.unitCost==null||input.unitCost===''?null:Math.max(0,finite(input.unitCost,NaN));
  if(!operationKey||!receiptGroupKey)throw new Error('Receiving operation key is required.');
  const prior=await operationByKey(db,operationKey);
  if(prior)return{ok:true,idempotent:true,operationId:prior.id};
  if(!Number.isInteger(partId)||partId<=0)throw new Error('Choose the inventory part for every received line.');
  if(!Number.isFinite(quantity)||quantity<=EPSILON)throw new Error('Received quantity must be greater than zero.');
  if(unitCost!==null&&!Number.isFinite(unitCost))throw new Error('Unit cost is invalid.');

  const part=await db.prepare('SELECT id,part_number,description,unit_cost FROM parts WHERE id=? AND active=1')
    .bind(partId).first<{id:number;part_number:string;description:string;unit_cost:number|null}>();
  if(!part)throw new Error('Part was not found.');
  const warehouse=await db.prepare('SELECT id,code,name FROM warehouses WHERE code=? AND active=1')
    .bind(String(input.warehouseCode??'').trim().toUpperCase()).first<{id:number;code:string;name:string}>();
  if(!warehouse)throw new Error('Choose the warehouse receiving these parts.');

  const target=await targetStock(db,partId,warehouse.id,unitCost);
  const existingQty=Math.max(0,finite(target.quantity_on_hand));
  const priorCost=target.unit_cost==null?null:finite(target.unit_cost);
  const effectiveCost=unitCost??priorCost??(part.unit_cost==null?null:finite(part.unit_cost));
  const blendedCost=unitCost!==null&&priorCost!==null&&existingQty>EPSILON
    ?((existingQty*priorCost)+(quantity*unitCost))/(existingQty+quantity)
    :effectiveCost;

  const orderRows=await db.prepare(`
    SELECT id,on_order
    FROM part_warehouse_stock
    WHERE part_id=? AND warehouse_id=? AND on_order>0
    ORDER BY CASE WHEN variant_key='' THEN 0 ELSE 1 END,id
  `).bind(partId,warehouse.id).all<{id:number;on_order:number}>();
  let orderRemaining=quantity;
  const orderUpdates:D1PreparedStatement[]=[];
  for(const row of orderRows.results){
    if(orderRemaining<=EPSILON)break;
    const reduce=Math.min(orderRemaining,Math.max(0,finite(row.on_order)));
    if(reduce<=EPSILON)continue;
    orderUpdates.push(
      db.prepare('UPDATE part_warehouse_stock SET on_order=MAX(0,on_order-?),updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .bind(reduce,row.id),
    );
    orderRemaining-=reduce;
  }

  const vendorName=clean(input.vendorName,180);
  const invoiceNumber=clean(input.invoiceNumber,100);
  const invoiceDate=clean(input.invoiceDate,20);
  const sourcePartNumber=clean(input.sourcePartNumber,120);
  const sourceDescription=clean(input.sourceDescription,300);
  const note=[
    vendorName&&`Vendor ${vendorName}`,
    invoiceNumber&&`Invoice ${invoiceNumber}`,
    sourcePartNumber&&`Source part ${sourcePartNumber}`,
  ].filter(Boolean).join(' · ').slice(0,500);

  const statements:D1PreparedStatement[]=[
    db.prepare(`
      INSERT INTO inventory_operations(operation_key,operation_type,user_id,note)
      VALUES (?,'parts_receipt',?,?)
    `).bind(operationKey,input.userId??null,note),
    db.prepare(`
      UPDATE part_warehouse_stock
      SET quantity_on_hand=quantity_on_hand+?,
          unit_cost=COALESCE(?,unit_cost),
          updated_at=CURRENT_TIMESTAMP,
          last_purchase_received=CURRENT_TIMESTAMP
      WHERE id=? AND part_id=? AND warehouse_id=?
    `).bind(quantity,blendedCost,target.id,partId,warehouse.id),
    db.prepare(`
      INSERT INTO inventory_operation_lines
        (operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,unit_cost,line_type)
      SELECT id,?,?,?,?,?,'receipt'
      FROM inventory_operations
      WHERE operation_key=? AND changes()=1
    `).bind(partId,target.id,warehouse.id,quantity,unitCost??blendedCost,operationKey),
    ...orderUpdates,
    db.prepare(`
      INSERT INTO parts_receipts
        (receipt_group_key,operation_id,part_id,warehouse_id,vendor_name,invoice_number,invoice_date,
         source_part_number,source_description,received_quantity,unit_cost,user_id)
      SELECT ?,id,?,?,?,?,?,?,?,?,?,?
      FROM inventory_operations WHERE operation_key=?
    `).bind(
      receiptGroupKey,partId,warehouse.id,vendorName||null,invoiceNumber||null,invoiceDate||null,
      sourcePartNumber||null,sourceDescription||null,quantity,unitCost??null,input.userId??null,operationKey,
    ),
    db.prepare(`
      INSERT INTO inventory_operation_commits(operation_id,applied)
      SELECT o.id,
        CASE WHEN ABS(COALESCE((SELECT SUM(l.quantity_delta) FROM inventory_operation_lines l WHERE l.operation_id=o.id),0)-?)<0.000001
        THEN 1 ELSE 0 END
      FROM inventory_operations o WHERE o.operation_key=?
    `).bind(quantity,operationKey),
  ];

  try{
    await db.batch(statements);
  }catch(error){
    const duplicate=await operationByKey(db,operationKey);
    if(duplicate)return{ok:true,idempotent:true,operationId:duplicate.id};
    const message=error instanceof Error?error.message:String(error);
    throw new Error(/CHECK constraint|constraint failed/i.test(message)
      ?'Inventory changed before the receipt posted. Nothing was received; refresh and try again.'
      :message);
  }

  await refreshPartTotal(db,partId,blendedCost);
  const operation=await operationByKey(db,operationKey);
  return{
    ok:true,
    idempotent:false,
    operationId:operation?.id,
    partId,
    partNumber:part.part_number,
    quantity,
    warehouseCode:warehouse.code,
    unitCost:unitCost??blendedCost,
  };
}

export async function recentPartsReceipts(db:D1Database,limit=50,partId?:number|null){
  const safeLimit=Math.min(250,Math.max(1,Math.trunc(limit)));
  const partFilter=partId!=null&&Number.isInteger(Number(partId))&&Number(partId)>0?Number(partId):null;
  const rows=await db.prepare(`
    SELECT r.id,r.receipt_group_key,r.operation_id,r.vendor_name,r.invoice_number,r.invoice_date,
           r.source_part_number,r.source_description,r.received_quantity,r.unit_cost,r.created_at,
           p.part_number,p.description,w.code AS warehouse_code,w.name AS warehouse_name,
           COALESCE(u.display_name,u.username,'') AS user_name
    FROM parts_receipts r
    JOIN parts p ON p.id=r.part_id
    JOIN warehouses w ON w.id=r.warehouse_id
    LEFT JOIN app_users u ON u.id=r.user_id
    WHERE (? IS NULL OR r.part_id=?)
    ORDER BY r.id DESC
    LIMIT ?
  `).bind(partFilter,partFilter,safeLimit).all<any>();
  return rows.results.map((row:any)=>({
    id:Number(row.id),
    receiptGroupKey:row.receipt_group_key,
    operationId:Number(row.operation_id),
    vendorName:row.vendor_name??'',
    invoiceNumber:row.invoice_number??'',
    invoiceDate:row.invoice_date??'',
    sourcePartNumber:row.source_part_number??'',
    sourceDescription:row.source_description??'',
    receivedQuantity:finite(row.received_quantity),
    unitCost:row.unit_cost==null?null:finite(row.unit_cost),
    createdAt:row.created_at,
    partNumber:row.part_number,
    description:row.description,
    warehouseCode:row.warehouse_code,
    warehouseName:row.warehouse_name,
    userName:row.user_name??'',
  }));
}
