import type { AppUser } from '@/lib/auth';

// A sale listing never replaces the truck's assignment or Repair Board status.
// An off-road hold survives cancellation until a second, explicit Return to Road.
type SaleStatus = 'for_sale' | 'off_road' | 'sold' | 'cancelled';
type SaleAction = 'mark_for_sale' | 'update_listing' | 'cancel_sale' | 'remove_from_road' | 'return_to_road' | 'mark_sold';
type SaleRow = {
  sale_status: SaleStatus;
  version: number;
  asking_price: number | null;
  sale_notes: string;
  off_road_at: string | null;
  returned_to_road_at: string | null;
};
type EquipmentRow = {
  id: number; unit: string; active: number; archived_at: string | null;
  merged_into_equipment_id: number | null; equipment_type: string; out_of_service: number;
};
type Assignment = {home_driver:string;current_driver:string;current_location:string;pool_status:string};

function label(value:unknown,max=1000){return String(value??'').trim().slice(0,max);}
function equipmentId(value:unknown){
  const valueNum=Number(value);
  if(!Number.isSafeInteger(valueNum)||valueNum<=0)throw new Error('Choose a valid truck.');
  return valueNum;
}
function money(value:unknown,required:boolean){
  if(value==null||value===''){
    if(required)throw new Error('Enter the actual sale price before marking this truck Sold.');
    return null;
  }
  if(typeof value!=='string'&&typeof value!=='number')throw new Error('Enter a valid dollar amount.');
  const raw=String(value).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))throw new Error('Enter dollars with no more than two decimal places.');
  const parsed=Number(raw);
  if(!Number.isFinite(parsed)||parsed>100_000_000||parsed<0||(required&&parsed<=0)){
    throw new Error('Enter a valid sale price greater than zero and under $100 million.');
  }
  return Math.round(parsed*100)/100;
}
function soldDate(value:unknown) {
  const date=label(value,10);
  const time=Date.parse(date+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date){
    throw new Error('Choose a valid sale date.');
  }
  const today=new Date().toISOString().slice(0,10);
  if(date>today)throw new Error('Sale date cannot be in the future.');
  return date;
}
export function truckHeldOffRoad(sale:Pick<SaleRow,'off_road_at'|'returned_to_road_at'>|null){
  return Boolean(sale?.off_road_at&&!sale.returned_to_road_at);
}
async function repairHold(db:D1Database,id:number){
  // Only Active Repairs and current Outside Repairs can keep a truck from
  // returning to service. A deferred PM or standalone roadside record does not.
  const row=await db.prepare(
    "SELECT "+
    "(SELECT COUNT(*) FROM repairs r WHERE r.equipment_id=? "+
    "AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%' "+
    "AND COALESCE(r.source,'')<>'roadside-breakdown' "+
    "AND lower(COALESCE(r.status,'')) NOT LIKE 'deferred to next%' "+
    "AND lower(COALESCE(r.status,'')) NOT LIKE 'outside - waiting on%' "+
    "AND NOT EXISTS (SELECT 1 FROM outside_repair_assignments a WHERE a.repair_id=r.id AND a.status IN ('waiting_vendor','waiting_invoice'))) AS active,"+
    "(SELECT COUNT(*) FROM outside_repair_assignments a JOIN repairs r ON r.id=a.repair_id "+
    "WHERE r.equipment_id=? AND a.status IN ('waiting_vendor','waiting_invoice')) AS outside"
  ).bind(id,id).first<{active:number;outside:number}>();
  return Number(row?.active||0)+Number(row?.outside||0);
}
export async function assertTruckAvailableForDispatch(db:D1Database,id:number) {
  const sale=await db.prepare(
    "SELECT sale_status,off_road_at,returned_to_road_at FROM fleet_truck_sales WHERE equipment_id=?"
  ).bind(id).first<{sale_status:SaleStatus;off_road_at:string|null;returned_to_road_at:string|null}>();
  if(sale?.sale_status==='sold')throw new Error('This truck has been sold and is unavailable for assignments.');
  if(truckHeldOffRoad(sale??null)){
    throw new Error(sale?.sale_status==='cancelled'
      ? 'Sale was cancelled, but this truck is still Off Road. A manager must use Return to Road first.'
      : 'This truck is Off Road awaiting sale. It cannot be assigned, moved, or used for coverage.');
  }
}
async function activeSwap(db:D1Database,id:number) {
  return Boolean(await db.prepare(
    "SELECT id FROM fleet_coverage_swaps WHERE closed_at IS NULL AND (home_equipment_id=? OR coverage_equipment_id=?) LIMIT 1"
  ).bind(id,id).first());
}

/**
 * Atomic sale lifecycle. Each batch STARTS with a CHECK-protected, state- and
 * version-guarded audit insert. If status/version, active equipment, or swap
 * state changes while the manager is confirming, D1 rolls back the full batch.
 */
export async function changeTruckSale(db:D1Database,user:Pick<AppUser,'id'>,body:Record<string,unknown>){
  const action=label(body.action,40) as SaleAction;
  if(!['mark_for_sale','update_listing','cancel_sale','remove_from_road','return_to_road','mark_sold'].includes(action)){
    throw new Error('Unknown truck sale action.');
  }
  const id=equipmentId(body.equipmentId);
  const [truck,sale,assignment]=await Promise.all([
    db.prepare("SELECT id,unit,active,archived_at,merged_into_equipment_id,COALESCE(equipment_type,'') AS equipment_type,COALESCE(out_of_service,0) AS out_of_service FROM equipment WHERE id=?")
      .bind(id).first<EquipmentRow>(),
    db.prepare('SELECT sale_status,version,asking_price,sale_notes,off_road_at,returned_to_road_at FROM fleet_truck_sales WHERE equipment_id=?')
      .bind(id).first<SaleRow>(),
    db.prepare('SELECT home_driver,current_driver,current_location,pool_status FROM fleet_truck_assignments WHERE equipment_id=?')
      .bind(id).first<Assignment>(),
  ]);
  if(!truck||!truck.active||truck.archived_at||truck.merged_into_equipment_id!==null||!/truck|vehicle|glider|switcher/i.test(truck.equipment_type)){
    throw new Error('This truck is inactive, archived, or no longer an active fleet truck.');
  }
  if(!assignment)throw new Error('Truck Assignments could not find this truck.');
  const from=sale?.sale_status??'not_listed';
  const offRoad=truckHeldOffRoad(sale??null);
  const hasSwap=await activeSwap(db,id);
  const asking=(action==='mark_for_sale'||action==='update_listing')?money(body.askingPrice,false):sale?.asking_price??null;
  const notes=(action==='mark_for_sale'||action==='update_listing')?label(body.notes,1000):sale?.sale_notes??'';
  const buyer=action==='mark_sold'?label(body.buyer,160):'';
  const price=action==='mark_sold'?money(body.salePrice,true):null;
  const date=action==='mark_sold'?soldDate(body.saleDate):'';
  let to:SaleStatus;
  let detail:string;

  switch(action){
    case 'mark_for_sale':
      if(sale&&sale.sale_status!=='cancelled')throw new Error('Truck is already listed, off-road, or sold.');
      if(offRoad)throw new Error('Return this cancelled sale truck to the road before listing it again.');
      to='for_sale';detail=truck.unit+' listed For Sale, with existing driver, dispatch, and Geotab tracking unchanged.';break;
    case 'update_listing':
      if(!sale||sale.sale_status!=='for_sale')throw new Error('Only actively listed trucks can update sale details.');
      to='for_sale';detail=truck.unit+' sale listing details updated.';break;
    case 'cancel_sale':
      if(!sale||!['for_sale','off_road'].includes(sale.sale_status))throw new Error('Only a listed or Off Road sale can be cancelled.');
      to='cancelled';detail=offRoad
        ?truck.unit+' sale cancelled; truck remains Off Road and unavailable until Return to Road.'
        :truck.unit+' sale cancelled; current driver and dispatch remain unchanged.';break;
    case 'remove_from_road':
      if(!sale||sale.sale_status!=='for_sale')throw new Error('List this truck For Sale before removing it from the road.');
      if(hasSwap)throw new Error('Complete the active coverage swap before removing this truck from the road.');
      if(body.confirmDriverRelease!==true)throw new Error('Confirm the truck is parked and the driver is released or reassigned.');
      to='off_road';detail=truck.unit+' removed from the road. Permanent and current driver released; Geotab/equipment record retained until Sold.';break;
    case 'return_to_road':
      if(!sale||sale.sale_status!=='cancelled'||!offRoad)throw new Error('Cancel the sale before returning this Off Road truck to service.');
      if(hasSwap)throw new Error('An active swap must be closed before returning this truck.');
      if(truck.out_of_service)throw new Error('This truck is Out of Service. Remove the OOS restriction before returning it to dispatch.');
      if(await repairHold(db,id))throw new Error('Clear its Active Repairs and Outside Repairs before returning it to the available pool.');
      if(body.confirmRoadworthy!==true)throw new Error('Confirm the truck has been inspected and is cleared to go back on the road.');
      to='cancelled';detail=truck.unit+' returned to Open truck pool following cancelled sale. No driver reassigned automatically.';break;
    case 'mark_sold':
      if(!sale||sale.sale_status!=='off_road'||!offRoad)throw new Error('Remove the truck from the road before finalizing the sale.');
      if(hasSwap)throw new Error('Complete the active coverage swap before selling the truck.');
      if(assignment.home_driver||assignment.current_driver)throw new Error('Truck still has a driver. Release it from service before marking Sold.');
      if(body.confirmSaleFinal!==true)throw new Error('Confirm the sale is final and the truck should leave the active fleet.');
      to='sold';detail=truck.unit+' sold on '+date+' for $'+price?.toFixed(2)+'. Equipment archived; historic repairs/PMs retained.';break;
  }

  // Protect transitions across concurrent manager edits and dispatch changes.
  const expectedVersion=sale?.version??0;
  if(body.expectedVersion!==undefined&&Number(body.expectedVersion)!==expectedVersion){
    throw new Error('Truck sale information changed. Refresh it before saving.');
  }
  const guardSale=sale
    ?"EXISTS(SELECT 1 FROM fleet_truck_sales s WHERE s.equipment_id=? AND s.sale_status=? AND s.version=?)"
    :"NOT EXISTS(SELECT 1 FROM fleet_truck_sales s WHERE s.equipment_id=?)";
  const guardSwap=(action==='remove_from_road'||action==='mark_sold'||action==='return_to_road')
    ?" AND NOT EXISTS(SELECT 1 FROM fleet_coverage_swaps sw WHERE sw.closed_at IS NULL AND (sw.home_equipment_id=? OR sw.coverage_equipment_id=?))":'';
  const guardAssignment=action==='mark_sold'
    ?" AND EXISTS(SELECT 1 FROM fleet_truck_assignments a WHERE a.equipment_id=? AND a.home_driver='' AND a.current_driver='')":'';
  const guardEquipment="EXISTS(SELECT 1 FROM equipment e WHERE e.id=? AND e.active=1 AND e.archived_at IS NULL AND e.merged_into_equipment_id IS NULL)";
  const guard="("+guardSale+" AND "+guardEquipment+guardSwap+guardAssignment+")";
  const guardBindings:Array<string|number|null>=[id,...(sale?[from,expectedVersion]:[]),id];
  if(guardSwap)guardBindings.push(id,id);
  if(guardAssignment)guardBindings.push(id);
  const audit=db.prepare(
    "INSERT INTO fleet_truck_sale_events(equipment_id,action,from_status,to_status,driver_snapshot,location_snapshot,asking_price,sale_price,buyer,details,user_id,guard_verified) "+
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,CASE WHEN "+guard+" THEN 1 ELSE 0 END)"
  ).bind(id,action,from,to,assignment.current_driver||assignment.home_driver,assignment.current_location,
    asking,price,buyer,detail,user.id,...guardBindings);

  const queries:D1PreparedStatement[]=[audit];
  if(action==='mark_for_sale'){
    queries.push(db.prepare(
      "INSERT INTO fleet_truck_sales(equipment_id,sale_status,asking_price,sale_notes,listed_at,off_road_at,returned_to_road_at,cancelled_at,sold_at,sale_price,buyer,updated_by_user_id,version,updated_at) "+
      "VALUES(?,'for_sale',?,?,CURRENT_TIMESTAMP,NULL,NULL,NULL,NULL,NULL,'',?,1,CURRENT_TIMESTAMP) "+
      "ON CONFLICT(equipment_id) DO UPDATE SET sale_status='for_sale',asking_price=excluded.asking_price,sale_notes=excluded.sale_notes,listed_at=CURRENT_TIMESTAMP,"+
      "off_road_at=NULL,returned_to_road_at=NULL,cancelled_at=NULL,sold_at=NULL,sale_price=NULL,buyer='',"+
      "updated_by_user_id=excluded.updated_by_user_id,version=fleet_truck_sales.version+1,updated_at=CURRENT_TIMESTAMP"
    ).bind(id,asking,notes,user.id));
  }else if(action==='update_listing'){
    queries.push(db.prepare(
      "UPDATE fleet_truck_sales SET asking_price=?,sale_notes=?,updated_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?"
    ).bind(asking,notes,user.id,id));
  }else if(action==='cancel_sale'){
    queries.push(db.prepare(
      "UPDATE fleet_truck_sales SET sale_status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?"
    ).bind(user.id,id));
  }else if(action==='remove_from_road'){
    queries.push(db.prepare(
      "UPDATE fleet_truck_assignments SET home_driver='',current_driver='',pool_status='open',coverage_for_equipment_id=NULL,coverage_for_driver='',"+
      "updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?"
    ).bind(user.id,id));
    queries.push(db.prepare("UPDATE equipment SET driver=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id));
    queries.push(db.prepare(
      "UPDATE fleet_truck_sales SET sale_status='off_road',off_road_at=CURRENT_TIMESTAMP,returned_to_road_at=NULL,"+
      "updated_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?"
    ).bind(user.id,id));
  }else if(action==='return_to_road'){
    queries.push(db.prepare(
      "UPDATE fleet_truck_sales SET returned_to_road_at=CURRENT_TIMESTAMP,updated_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?"
    ).bind(user.id,id));
    queries.push(db.prepare(
      "UPDATE fleet_truck_assignments SET home_driver='',current_driver='',pool_status='open',coverage_for_equipment_id=NULL,coverage_for_driver='',"+
      "updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?"
    ).bind(user.id,id));
  }else if(action==='mark_sold'){
    queries.push(db.prepare(
      "UPDATE fleet_truck_sales SET sale_status='sold',sold_at=?,sale_price=?,buyer=?,updated_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?"
    ).bind(date+' 12:00:00',price,buyer,user.id,id));
    queries.push(db.prepare(
      "UPDATE equipment SET active=0,archived_at=COALESCE(archived_at,CURRENT_TIMESTAMP),"+
      "archive_reason=?,driver=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind('Sold '+date+' through Truck Assignments',id));
    queries.push(db.prepare(
      "UPDATE equipment_geotab_devices SET current=0,ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP),"+
      "last_seen_at=CURRENT_TIMESTAMP WHERE equipment_id=? AND current=1"
    ).bind(id));
  }
  // Guard and updates are one D1 transactional batch, so a failed guard makes
  // every write, including the audit entry, roll back.
  await db.batch(queries);
  return {ok:true,unit:truck.unit,equipmentId:id,from,to,offRoad:action==='cancel_sale'?offRoad:action==='remove_from_road',message:detail};
}
