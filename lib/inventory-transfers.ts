const EPSILON=0.000001;

const finite=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clean=(value:unknown,max=500)=>String(value??'').trim().replace(/\s+/g,' ').slice(0,max);

async function warehouse(db:D1Database,code:unknown){
  const normalized=String(code??'').trim().toUpperCase();
  if(!normalized)throw new Error('Choose the source warehouse.');
  const row=await db.prepare('SELECT id,code,name FROM warehouses WHERE code=? AND active=1')
    .bind(normalized).first<{id:number;code:string;name:string}>();
  if(!row)throw new Error('Warehouse was not found.');
  return row;
}

async function refreshPartTotal(db:D1Database,partId:number){
  await db.prepare(`
    UPDATE parts
    SET quantity_on_hand=COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id=?),0),
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(partId,partId).run();
}

async function operationByKey(db:D1Database,key:string){
  return db.prepare('SELECT id,status FROM inventory_operations WHERE operation_key=?')
    .bind(key).first<{id:number;status:string}>();
}

async function sourceRows(db:D1Database,partId:number,warehouseId:number){
  return db.prepare(`
    SELECT id,quantity_on_hand,unit_cost
    FROM part_warehouse_stock
    WHERE part_id=? AND warehouse_id=? AND quantity_on_hand>0
    ORDER BY CASE WHEN variant_key='' THEN 0 ELSE 1 END,quantity_on_hand DESC,id
  `).bind(partId,warehouseId).all<{id:number;quantity_on_hand:number;unit_cost:number|null}>();
}

async function reservedQuantity(db:D1Database,partId:number,warehouseId:number){
  const row=await db.prepare(`
    SELECT COALESCE(SUM(reserved_quantity),0) AS reserved
    FROM derived_repair_part_reservations
    WHERE part_id=? AND warehouse_id=?
  `).bind(partId,warehouseId).first<{reserved:number}>();
  return finite(row?.reserved);
}

async function ensureTargetStock(db:D1Database,partId:number,warehouseId:number,unitCost:number|null){
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
  if(!row)throw new Error('Destination stock row could not be created.');
  return row;
}

export async function transferInventory(
  db:D1Database,
  input:{
    operationKey:string;
    partId:unknown;
    sourceWarehouseCode:unknown;
    transferKind:unknown;
    destinationWarehouseCode?:unknown;
    destinationLabel?:unknown;
    quantity:unknown;
    notes:unknown;
    userId?:number|null;
  },
){
  const operationKey=clean(input.operationKey,160);
  const partId=Number(input.partId??0);
  const quantity=finite(input.quantity,NaN);
  const notes=clean(input.notes,1000);
  const transferKind=String(input.transferKind??'').trim().toLowerCase();
  if(!operationKey)throw new Error('Transfer operation key is required.');
  const prior=await operationByKey(db,operationKey);
  if(prior)return{ok:true,idempotent:true,operationId:prior.id};
  if(!Number.isInteger(partId)||partId<=0)throw new Error('Choose a part to transfer.');
  if(!Number.isFinite(quantity)||quantity<=EPSILON)throw new Error('Transfer quantity must be greater than zero.');
  if(!notes)throw new Error('Transfer notes are required.');
  if(!['terminal','outside','remove'].includes(transferKind))throw new Error('Choose where this inventory is being transferred.');

  const part=await db.prepare('SELECT id,part_number,description FROM parts WHERE id=? AND active=1')
    .bind(partId).first<{id:number;part_number:string;description:string}>();
  if(!part)throw new Error('Part was not found.');
  const source=await warehouse(db,input.sourceWarehouseCode);
  const rows=await sourceRows(db,partId,source.id);
  const physical=rows.results.reduce((sum,row)=>sum+Math.max(0,finite(row.quantity_on_hand)),0);
  const reserved=await reservedQuantity(db,partId,source.id);
  const available=Math.max(0,physical-reserved);
  if(available+EPSILON<quantity)throw new Error(`Only ${available} unreserved ${part.part_number} available in ${source.name}.`);

  let destination:null|{id:number;code:string;name:string}=null;
  let destinationLabel=clean(input.destinationLabel,180);
  if(transferKind==='terminal'){
    destination=await warehouse(db,input.destinationWarehouseCode);
    if(destination.id===source.id)throw new Error('Choose a different destination terminal.');
    destinationLabel=destination.name;
  }else if(transferKind==='outside'){
    destinationLabel=destinationLabel||'Outside / other location';
  }else{
    destinationLabel=destinationLabel||'Removed from inventory';
  }

  let remaining=quantity;
  const takes:Array<{id:number;quantity:number;unitCost:number|null}>=[];
  let costTotal=0;
  let costQuantity=0;
  for(const row of rows.results){
    if(remaining<=EPSILON)break;
    const take=Math.min(remaining,Math.max(0,finite(row.quantity_on_hand)));
    if(take<=EPSILON)continue;
    takes.push({id:Number(row.id),quantity:take,unitCost:row.unit_cost==null?null:finite(row.unit_cost)});
    if(row.unit_cost!=null){costTotal+=take*finite(row.unit_cost);costQuantity+=take;}
    remaining-=take;
  }
  if(remaining>EPSILON)throw new Error('Available stock changed before the transfer could be prepared.');
  const averageCost=costQuantity>EPSILON?costTotal/costQuantity:null;
  const target=destination?await ensureTargetStock(db,partId,destination.id,averageCost):null;

  const statements:D1PreparedStatement[]=[
    db.prepare(`
      INSERT INTO inventory_operations(operation_key,operation_type,user_id,note)
      VALUES (?,'inventory_transfer',?,?)
    `).bind(operationKey,input.userId??null,notes),
  ];

  for(const take of takes){
    statements.push(
      db.prepare(`
        UPDATE part_warehouse_stock
        SET quantity_on_hand=quantity_on_hand-?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND part_id=? AND warehouse_id=? AND quantity_on_hand>=?
      `).bind(take.quantity,take.id,partId,source.id,take.quantity),
      db.prepare(`
        INSERT INTO inventory_operation_lines
          (operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,unit_cost,line_type)
        SELECT id,?,?,?,?,?,'transfer_out'
        FROM inventory_operations
        WHERE operation_key=? AND changes()=1
      `).bind(partId,take.id,source.id,-take.quantity,take.unitCost,operationKey),
    );
  }

  if(destination&&target){
    statements.push(
      db.prepare(`
        UPDATE part_warehouse_stock
        SET quantity_on_hand=quantity_on_hand+?,
            unit_cost=COALESCE(unit_cost,?),
            updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND part_id=? AND warehouse_id=?
      `).bind(quantity,averageCost,target.id,partId,destination.id),
      db.prepare(`
        INSERT INTO inventory_operation_lines
          (operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,unit_cost,line_type)
        SELECT id,?,?,?,?,?,'transfer_in'
        FROM inventory_operations
        WHERE operation_key=? AND changes()=1
      `).bind(partId,target.id,destination.id,quantity,averageCost,operationKey),
    );
  }

  statements.push(
    db.prepare(`
      INSERT INTO inventory_transfers
        (operation_id,part_id,source_warehouse_id,destination_warehouse_id,transfer_kind,destination_label,quantity,notes,user_id)
      SELECT id,?,?,?,?,?,?,?,?
      FROM inventory_operations WHERE operation_key=?
    `).bind(partId,source.id,destination?.id??null,transferKind,destinationLabel,quantity,notes,input.userId??null,operationKey),
    db.prepare(`
      INSERT INTO inventory_operation_commits(operation_id,applied)
      SELECT o.id,
        CASE WHEN
          ABS(COALESCE((SELECT SUM(CASE WHEN l.quantity_delta<0 THEN l.quantity_delta ELSE 0 END)
            FROM inventory_operation_lines l WHERE l.operation_id=o.id),0)+?)<0.000001
          AND (?<>'terminal' OR ABS(COALESCE((SELECT SUM(CASE WHEN l.quantity_delta>0 THEN l.quantity_delta ELSE 0 END)
            FROM inventory_operation_lines l WHERE l.operation_id=o.id),0)-?)<0.000001)
          AND (SELECT COALESCE(SUM(quantity_on_hand),0) FROM part_warehouse_stock WHERE part_id=? AND warehouse_id=?)
            +0.000001 >=
            (SELECT COALESCE(SUM(reserved_quantity),0) FROM derived_repair_part_reservations WHERE part_id=? AND warehouse_id=?)
        THEN 1 ELSE 0 END
      FROM inventory_operations o WHERE o.operation_key=?
    `).bind(quantity,transferKind,quantity,partId,source.id,partId,source.id,operationKey),
  );

  try{
    await db.batch(statements);
  }catch(error){
    const duplicate=await operationByKey(db,operationKey);
    if(duplicate)return{ok:true,idempotent:true,operationId:duplicate.id};
    const message=error instanceof Error?error.message:String(error);
    throw new Error(/CHECK constraint|constraint failed/i.test(message)
      ?'Inventory changed before the transfer posted. Nothing was transferred; refresh and try again.'
      :message);
  }

  await refreshPartTotal(db,partId);
  const operation=await operationByKey(db,operationKey);
  return{
    ok:true,
    idempotent:false,
    operationId:operation?.id,
    partId,
    partNumber:part.part_number,
    quantity,
    sourceWarehouseCode:source.code,
    transferKind,
    destinationWarehouseCode:destination?.code??null,
    destinationLabel,
  };
}

export async function recentInventoryTransfers(db:D1Database,limit=50){
  const safeLimit=Math.min(100,Math.max(1,Math.trunc(limit)));
  const rows=await db.prepare(`
    SELECT t.id,t.operation_id,t.transfer_kind,t.destination_label,t.quantity,t.notes,t.created_at,
           p.part_number,p.description,
           sw.code AS source_warehouse_code,sw.name AS source_warehouse_name,
           dw.code AS destination_warehouse_code,dw.name AS destination_warehouse_name,
           COALESCE(u.display_name,u.username,'') AS user_name
    FROM inventory_transfers t
    JOIN parts p ON p.id=t.part_id
    JOIN warehouses sw ON sw.id=t.source_warehouse_id
    LEFT JOIN warehouses dw ON dw.id=t.destination_warehouse_id
    LEFT JOIN app_users u ON u.id=t.user_id
    ORDER BY t.id DESC
    LIMIT ?
  `).bind(safeLimit).all<any>();
  return rows.results.map((row:any)=>({
    id:Number(row.id),
    operationId:Number(row.operation_id),
    transferKind:row.transfer_kind,
    destinationLabel:row.destination_label??'',
    quantity:finite(row.quantity),
    notes:row.notes,
    createdAt:row.created_at,
    partNumber:row.part_number,
    description:row.description,
    sourceWarehouseCode:row.source_warehouse_code,
    sourceWarehouseName:row.source_warehouse_name,
    destinationWarehouseCode:row.destination_warehouse_code??'',
    destinationWarehouseName:row.destination_warehouse_name??'',
    userName:row.user_name??'',
  }));
}
