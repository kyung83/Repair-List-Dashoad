import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';

type AssignmentRow = {
  equipment_id:number;
  unit:string;
  equipment_type:string;
  home_driver:string;
  home_location:string;
  current_driver:string;
  current_location:string;
  pool_status:string;
  truck_class:string;
  flatbed:number;
  automatic:number;
  scheduler_notes:string;
  coverage_for_equipment_id:number|null;
  coverage_for_driver:string;
  out_of_service:number;
  out_of_service_reason:string;
  shop_eta:string|null;
  active_repairs:number;
  outside_repairs:number;
};

// The only repairs used by Truck Assignments: Repair Board Active Repairs
// and live Outside Repairs. Raw due PM/Annual items are not repair orders.
// Unfinished vendor-assigned work belongs to Outside Repairs, never both.
const ACTIVE_REPAIR_SQL = [
  "lower(COALESCE(r.status,'')) NOT LIKE '%complete%'",
  "COALESCE(r.source,'') <> 'roadside-breakdown'",
  "lower(COALESCE(r.status,'')) NOT LIKE 'deferred to next%'",
  "lower(COALESCE(r.status,'')) NOT LIKE 'outside - waiting on%'",
  "NOT EXISTS (SELECT 1 FROM outside_repair_assignments outside WHERE outside.repair_id=r.id AND outside.status IN ('waiting_vendor','waiting_invoice'))",
].join(' AND ');
const OUTSIDE_REPAIR_SQL = "a.status IN ('waiting_vendor','waiting_invoice')";

function repairCountSelect(equipmentExpr:string) {
  return "(SELECT COUNT(*) FROM repairs r WHERE r.equipment_id=" + equipmentExpr + " AND " + ACTIVE_REPAIR_SQL + ") AS active_repairs, " +
    "(SELECT COUNT(*) FROM outside_repair_assignments a JOIN repairs r ON r.id=a.repair_id WHERE r.equipment_id=" +
    equipmentExpr + " AND " + OUTSIDE_REPAIR_SQL + ") AS outside_repairs";
}
async function truckRepairCounts(equipmentId:number) {
  const row=await env.DB.prepare("SELECT COALESCE(e.out_of_service,0) AS oos,"+repairCountSelect('e.id')+
    " FROM equipment e WHERE e.id=?").bind(equipmentId).first<{oos:number;active_repairs:number;outside_repairs:number}>();
  return {oos:Boolean(row?.oos),active:Number(row?.active_repairs||0),outside:Number(row?.outside_repairs||0)};
}
function repairHoldMessage(unit:string,active:number,outside:number) {
  return unit+" has "+active+" Active Repair(s) and "+outside+" Outside Repair(s). Review or clear those jobs before assigning it as coverage.";
}

type SwapRow = {
  id:number;
  driver:string;
  home_equipment_id:number;
  home_unit:string;
  coverage_equipment_id:number;
  coverage_unit:string;
  working_location:string;
  service_location:string;
  reason:string;
  coverage_return_pool:string;
  opened_at:string;
  ready_at:string|null;
  completed_service_work:number;
};

function text(value:unknown,max=200){return String(value??'').trim().slice(0,max);}
function id(value:unknown){const n=Number(value??0);if(!Number.isInteger(n)||n<=0)throw new Error('Choose a valid truck.');return n;}
function pool(value:unknown,allowed=['assigned','open','spare','coverage','service','cleaning']){const v=text(value,20);if(!allowed.includes(v))throw new Error('Choose a valid truck status.');return v;}
function canOperate(user:AppUser){return user.role==='manager'||user.role==='admin'||user.dispatchAccess;}
function canEditMaster(user:AppUser){return !user.dispatchAccess&&(user.role==='manager'||user.role==='admin');}
async function requireOperator(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(!canOperate(user))throw new Error('Dispatch, manager, or administrator access is required.');
  return user;
}
async function equipment(equipmentId:number){
  const row=await env.DB.prepare(`
    SELECT id,unit,COALESCE(equipment_type,'other') AS equipment_type,COALESCE(out_of_service,0) AS out_of_service
    FROM equipment WHERE id=? AND active=1 AND merged_into_equipment_id IS NULL
  `).bind(equipmentId).first<{id:number;unit:string;equipment_type:string;out_of_service:number}>();
  if(!row)throw new Error('Truck was not found or is inactive.');
  if(!/truck|vehicle|glider|switcher/i.test(row.equipment_type))throw new Error(`${row.unit} is not a truck.`);
  return row;
}
async function ensureAssignments(){
  await env.DB.prepare(`
    INSERT OR IGNORE INTO fleet_truck_assignments(
      equipment_id,home_driver,home_location,current_driver,current_location,pool_status
    )
    SELECT e.id,
      CASE WHEN lower(trim(COALESCE(e.driver,'')))='open' OR lower(trim(COALESCE(e.driver,''))) LIKE '%floater%' THEN '' ELSE trim(COALESCE(e.driver,'')) END,
      trim(COALESCE(e.location,'')),
      CASE WHEN lower(trim(COALESCE(e.driver,'')))='open' OR lower(trim(COALESCE(e.driver,''))) LIKE '%floater%' THEN '' ELSE trim(COALESCE(e.driver,'')) END,
      trim(COALESCE(e.location,'')),
      CASE WHEN lower(trim(COALESCE(e.driver,''))) LIKE '%floater%' THEN 'spare'
           WHEN trim(COALESCE(e.driver,''))='' OR lower(trim(COALESCE(e.driver,'')))='open' THEN 'open'
           ELSE 'assigned' END
    FROM equipment e
    WHERE e.active=1 AND e.merged_into_equipment_id IS NULL
      AND lower(COALESCE(e.equipment_type,'')) IN ('truck','vehicle','glider','switcher')
  `).run();
}
async function logEvent(user:AppUser,action:string,primary:number|null,secondary:number|null,driver:string,fromLocation:string,toLocation:string,detail:string){
  await env.DB.prepare(`
    INSERT INTO fleet_assignment_events(action,driver,primary_equipment_id,secondary_equipment_id,from_location,to_location,detail,user_id)
    VALUES(?,?,?,?,?,?,?,?)
  `).bind(action,driver,primary,secondary,fromLocation,toLocation,detail,user.id).run();
}

export async function GET(request:Request){
  try{
    const user=await requireOperator(request);
    await ensureAssignments();
    const inspectId=new URL(request.url).searchParams.get('inspectEquipmentId');
    if(inspectId!==null){
      const equipmentId=id(inspectId),truck=await equipment(equipmentId);
      const [active,outside]=await Promise.all([
        env.DB.prepare("SELECT r.id,COALESCE(r.title,'') AS title,COALESCE(r.status,'') AS status,COALESCE(r.source,'') AS source "+
          "FROM repairs r WHERE r.equipment_id=? AND "+ACTIVE_REPAIR_SQL+" ORDER BY r.id DESC LIMIT 101")
          .bind(equipmentId).all<{id:number;title:string;status:string;source:string}>(),
        env.DB.prepare("SELECT r.id,COALESCE(r.title,'') AS title,COALESCE(r.status,'') AS status, "+
          "a.status AS vendor_status,COALESCE(v.name,'') AS vendor "+
          "FROM outside_repair_assignments a JOIN repairs r ON r.id=a.repair_id "+
          "LEFT JOIN outside_work_vendors v ON v.id=a.outside_vendor_id "+
          "WHERE r.equipment_id=? AND "+OUTSIDE_REPAIR_SQL+" ORDER BY a.updated_at DESC LIMIT 101")
          .bind(equipmentId).all<{id:number;title:string;status:string;vendor_status:string;vendor:string}>(),
      ]);
      const records=[
        ...active.results.slice(0,100).map(row=>({id:row.id,title:row.title,status:row.status,kind:'Active Repair',detail:row.source||'Manual'})),
        ...outside.results.slice(0,100).map(row=>({id:row.id,title:row.title,status:row.status,kind:'Outside Repair',
          detail:(row.vendor||'Outside vendor')+' · '+(row.vendor_status==='waiting_vendor'?'Waiting on vendor':'Waiting on invoice')})),
      ];
      return Response.json({unit:truck.unit,equipmentId,records,truncated:active.results.length>100||outside.results.length>100},
        {headers:{'cache-control':'no-store'}});
    }
    const [assignments,swaps,events]=await Promise.all([
      env.DB.prepare(`
        SELECT a.equipment_id,e.unit,COALESCE(e.equipment_type,'other') AS equipment_type,
               a.home_driver,a.home_location,a.current_driver,a.current_location,a.pool_status,
               a.truck_class,a.flatbed,a.automatic,a.scheduler_notes,a.coverage_for_equipment_id,a.coverage_for_driver,
               COALESCE(e.out_of_service,0) AS out_of_service,COALESCE(e.out_of_service_reason,'') AS out_of_service_reason,
               e.shop_eta,
               ${repairCountSelect('e.id')}
        FROM fleet_truck_assignments a
        JOIN equipment e ON e.id=a.equipment_id
        WHERE e.active=1 AND e.merged_into_equipment_id IS NULL
        ORDER BY CASE WHEN a.home_location='' THEN 1 ELSE 0 END,a.home_location COLLATE NOCASE,e.unit COLLATE NOCASE
      `).all<AssignmentRow>(),
      env.DB.prepare(`
        SELECT s.id,s.driver,s.home_equipment_id,home.unit AS home_unit,
               s.coverage_equipment_id,coverage.unit AS coverage_unit,
               s.working_location,s.service_location,s.reason,s.coverage_return_pool,s.opened_at,s.ready_at,
               EXISTS(SELECT 1 FROM repairs sr WHERE sr.equipment_id=s.home_equipment_id AND sr.completed_at IS NOT NULL AND sr.completed_at>=s.opened_at) AS completed_service_work
        FROM fleet_coverage_swaps s
        JOIN equipment home ON home.id=s.home_equipment_id
        JOIN equipment coverage ON coverage.id=s.coverage_equipment_id
        WHERE s.closed_at IS NULL
        ORDER BY s.opened_at
      `).all<SwapRow>(),
      env.DB.prepare(`
        SELECT ev.id,ev.action,ev.driver,ev.from_location,ev.to_location,ev.detail,ev.created_at,
               COALESCE(a.unit,'') AS primary_unit,COALESCE(b.unit,'') AS secondary_unit,
               COALESCE(NULLIF(u.display_name,''),NULLIF(u.username,''),'System') AS by_name
        FROM fleet_assignment_events ev
        LEFT JOIN equipment a ON a.id=ev.primary_equipment_id
        LEFT JOIN equipment b ON b.id=ev.secondary_equipment_id
        LEFT JOIN app_users u ON u.id=ev.user_id
        ORDER BY ev.id DESC LIMIT 100
      `).all<{id:number;action:string;driver:string;from_location:string;to_location:string;detail:string;created_at:string;primary_unit:string;secondary_unit:string;by_name:string}>(),
    ]);
    const rows=assignments.results.map(row=>({
      equipmentId:row.equipment_id,unit:row.unit,equipmentType:row.equipment_type,
      homeDriver:row.home_driver,homeLocation:row.home_location,currentDriver:row.current_driver,currentLocation:row.current_location,
      status:row.pool_status,truckClass:row.truck_class,flatbed:Boolean(row.flatbed),automatic:Boolean(row.automatic),
      notes:row.scheduler_notes,coverageForEquipmentId:row.coverage_for_equipment_id,coverageForDriver:row.coverage_for_driver,
      outOfService:Boolean(row.out_of_service),outOfServiceReason:row.out_of_service_reason,shopEta:row.shop_eta??'',
      openRepairCount:Number(row.active_repairs||0),
      outsideRepairCount:Number(row.outside_repairs||0),
      repairState:row.pool_status==='service'?'in_service':Boolean(row.out_of_service)?'out_of_service':Number(row.active_repairs||0)>0?'active_repair':Number(row.outside_repairs||0)>0?'outside_repair':row.pool_status==='cleaning'?'cleaning':'clear',
      readyToReturn:row.pool_status==='service'&&!row.out_of_service&&Number(row.active_repairs||0)===0&&Number(row.outside_repairs||0)===0,
    }));
    const active=swaps.results.map(row=>({
      id:row.id,driver:row.driver,homeEquipmentId:row.home_equipment_id,homeUnit:row.home_unit,
      coverageEquipmentId:row.coverage_equipment_id,coverageUnit:row.coverage_unit,
      workingLocation:row.working_location,serviceLocation:row.service_location,reason:row.reason,
      coverageReturnPool:row.coverage_return_pool,openedAt:row.opened_at,
      repairClear:Boolean(rows.find(x=>x.equipmentId===row.home_equipment_id)?.readyToReturn),
      readyToReturn:Boolean(rows.find(x=>x.equipmentId===row.home_equipment_id)?.readyToReturn)&&(Boolean(row.ready_at)||Boolean(row.completed_service_work)),
    }));
    return Response.json({
      permissions:{canOperate:true,canEditMaster:canEditMaster(user)},
      assignments:rows,activeSwaps:active,events:events.results,
      summary:{
        assigned:rows.filter(x=>x.status==='assigned').length,
        open:rows.filter(x=>x.status==='open').length,
        spare:rows.filter(x=>x.status==='spare').length,
        coverage:rows.filter(x=>x.status==='coverage').length,
        service:rows.filter(x=>x.status==='service').length,
        cleaning:rows.filter(x=>x.status==='cleaning').length,
        readyToReturn:active.filter(x=>x.readyToReturn).length,
      },
      updatedAt:new Date().toISOString(),
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Truck assignments could not be loaded.'},{status:400});
  }
}

export async function POST(request:Request){
  try{
    const user=await requireOperator(request);
    await ensureAssignments();
    const body=await request.json() as Record<string,unknown>;
    const action=text(body.action,40);

    if(action==='updateMaster'){
      if(!canEditMaster(user))throw new Error('Manager or administrator access is required to change permanent assignments.');
      const equipmentId=id(body.equipmentId);await equipment(equipmentId);
      const homeDriver=text(body.homeDriver,160),homeLocation=text(body.homeLocation,160);
      const status=pool(body.status,['assigned','open','spare','cleaning']);
      const truckClass=text(body.truckClass,40),notes=text(body.notes,1000);
      const flatbed=Boolean(body.flatbed),automatic=Boolean(body.automatic);
      const current=await env.DB.prepare('SELECT home_driver,home_location,current_driver,current_location,pool_status FROM fleet_truck_assignments WHERE equipment_id=?').bind(equipmentId)
        .first<{home_driver:string;home_location:string;current_driver:string;current_location:string;pool_status:string}>();
      if(!current)throw new Error('Truck assignment was not found.');
      const hasOpenSwap=await env.DB.prepare('SELECT id FROM fleet_coverage_swaps WHERE closed_at IS NULL AND (home_equipment_id=? OR coverage_equipment_id=?) LIMIT 1').bind(equipmentId,equipmentId).first();
      const currentDriver=hasOpenSwap?current.current_driver:(status==='assigned'?homeDriver:'');
      const currentLocation=hasOpenSwap?current.current_location:homeLocation;
      const currentStatus=hasOpenSwap?current.pool_status:status;
      await env.DB.batch([
        env.DB.prepare(`UPDATE fleet_truck_assignments
          SET home_driver=?,home_location=?,current_driver=?,current_location=?,pool_status=?,truck_class=?,flatbed=?,automatic=?,scheduler_notes=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP
          WHERE equipment_id=?`).bind(homeDriver,homeLocation,currentDriver,currentLocation,currentStatus,truckClass,flatbed?1:0,automatic?1:0,notes,user.id,equipmentId),
        env.DB.prepare('UPDATE equipment SET driver=?,location=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(homeDriver,homeLocation,equipmentId),
      ]);
      await logEvent(user,'master_updated',equipmentId,null,homeDriver,current.home_location,homeLocation,`Permanent assignment updated for ${homeDriver||'open truck'}.`);
      return Response.json({ok:true});
    }


    // An assigned truck can be released without first removing a stale driver
    // from the dispatch list. An active coverage swap must be completed through
    // the established return/repair workflow instead.
    if(action==='markTruckOpen'){
      const equipmentId=id(body.equipmentId);const truck=await equipment(equipmentId);
      const clearPermanent=body.clearPermanent===true;
      if(clearPermanent&&!canEditMaster(user))throw new Error('Only managers and administrators can remove a permanent driver assignment.');
      const row=await env.DB.prepare('SELECT home_driver,current_driver,current_location,pool_status FROM fleet_truck_assignments WHERE equipment_id=?')
        .bind(equipmentId).first<{home_driver:string;current_driver:string;current_location:string;pool_status:string}>();
      if(!row)throw new Error('Truck assignment was not found.');
      const active=await env.DB.prepare('SELECT id FROM fleet_coverage_swaps WHERE closed_at IS NULL AND (home_equipment_id=? OR coverage_equipment_id=?) LIMIT 1')
        .bind(equipmentId,equipmentId).first();
      if(active)throw new Error('This truck has an active coverage swap. Complete the swap before marking it Open.');
      const result=await env.DB.prepare(`UPDATE fleet_truck_assignments
        SET home_driver=CASE WHEN ?=1 THEN '' ELSE home_driver END,
            current_driver='',pool_status='open',
            coverage_for_equipment_id=NULL,coverage_for_driver='',
            updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE equipment_id=? AND home_driver=? AND current_driver=?
          AND NOT EXISTS(SELECT 1 FROM fleet_coverage_swaps
            WHERE closed_at IS NULL AND (home_equipment_id=? OR coverage_equipment_id=?))`)
        .bind(clearPermanent?1:0,user.id,equipmentId,row.home_driver,row.current_driver,equipmentId,equipmentId).run();
      if(Number(result.meta.changes||0)!==1)throw new Error('Assignment changed while you were editing. Refresh this truck and try again.');
      if(clearPermanent){
        await env.DB.prepare('UPDATE equipment SET driver=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(equipmentId).run();
      }
      await logEvent(user,clearPermanent?'permanent_driver_removed':'truck_marked_open',equipmentId,null,
        row.current_driver||row.home_driver,row.current_location,row.current_location,
        clearPermanent
          ?`${truck.unit} made Open. Former permanent driver ${row.home_driver||'none'} and current driver ${row.current_driver||'none'} removed.`
          :`${truck.unit} made Open. Current driver ${row.current_driver||'none'} released; permanent assignment kept.`);
      return Response.json({ok:true,unit:truck.unit,status:'open',permanentCleared:clearPermanent});
    }

    // Dispatch may change who is CURRENTLY driving an available truck.
    // This does not rewrite the permanent owner, Master Equipment or an
    // in-progress service/coverage swap.
    if(action==='changeCurrentDriver'){
      const equipmentId=id(body.equipmentId);const truck=await equipment(equipmentId);
      const driver=text(body.driver,160);
      if(!driver)throw new Error('Enter a new driver, or use Mark Open to remove the current driver.');
      if(truck.out_of_service)throw new Error(`${truck.unit} is out of service and cannot be assigned to a driver.`);
      const repair=await truckRepairCounts(equipmentId);
      if(repair.active+repair.outside>0)throw new Error(repairHoldMessage(truck.unit,repair.active,repair.outside));
      const active=await env.DB.prepare('SELECT id FROM fleet_coverage_swaps WHERE closed_at IS NULL AND (home_equipment_id=? OR coverage_equipment_id=?) LIMIT 1')
        .bind(equipmentId,equipmentId).first();
      if(active)throw new Error('This truck is in an active coverage swap. Complete the swap before changing its driver.');
      const row=await env.DB.prepare('SELECT home_driver,current_driver,current_location,pool_status FROM fleet_truck_assignments WHERE equipment_id=?')
        .bind(equipmentId).first<{home_driver:string;current_driver:string;current_location:string;pool_status:string}>();
      if(!row)throw new Error('Truck assignment was not found.');
      if(row.pool_status==='cleaning')throw new Error('Mark this truck Open or Spare after cleaning before assigning a driver.');
      const other=await env.DB.prepare(`SELECT a.equipment_id,e.unit FROM fleet_truck_assignments a
        JOIN equipment e ON e.id=a.equipment_id
        WHERE a.equipment_id<>? AND lower(trim(a.current_driver))=lower(trim(?)) LIMIT 1`)
        .bind(equipmentId,driver).first<{equipment_id:number;unit:string}>();
      if(other)throw new Error(`${driver} is already listed on truck ${other.unit}. Release that truck first to avoid duplicate assignments.`);
      const location=text(body.location,160)||row.current_location;
      const changed=await env.DB.prepare(`UPDATE fleet_truck_assignments
        SET current_driver=?,current_location=?,pool_status='assigned',
            coverage_for_equipment_id=NULL,coverage_for_driver='',
            updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE equipment_id=? AND current_driver=?
          AND NOT EXISTS(SELECT 1 FROM fleet_coverage_swaps
            WHERE closed_at IS NULL AND (home_equipment_id=? OR coverage_equipment_id=?))`)
        .bind(driver,location,user.id,equipmentId,row.current_driver,equipmentId,equipmentId).run();
      if(Number(changed.meta.changes||0)!==1)throw new Error('Assignment changed while you were editing. Refresh this truck and try again.');
      await logEvent(user,'current_driver_changed',equipmentId,null,driver,row.current_location,location,
        `${truck.unit} current driver changed from ${row.current_driver||'unassigned'} to ${driver}. Permanent driver unchanged.`);
      return Response.json({ok:true,unit:truck.unit,currentDriver:driver});
    }

    if(action==='setPoolStatus'){
      const equipmentId=id(body.equipmentId);const truck=await equipment(equipmentId);
      const status=pool(body.status,['open','spare','cleaning']);
      const row=await env.DB.prepare('SELECT current_driver,current_location FROM fleet_truck_assignments WHERE equipment_id=?').bind(equipmentId).first<{current_driver:string;current_location:string}>();
      if(!row)throw new Error('Truck assignment was not found.');
      if(row.current_driver)throw new Error(`${truck.unit} is currently assigned to ${row.current_driver}. Remove or complete that assignment first.`);
      const location=text(body.currentLocation,160)||row.current_location;
      await env.DB.prepare('UPDATE fleet_truck_assignments SET pool_status=?,current_location=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?')
        .bind(status,location,user.id,equipmentId).run();
      await logEvent(user,status==='cleaning'?'sent_to_cleaning':'pool_changed',equipmentId,null,'',row.current_location,location,`${truck.unit} marked ${status}.`);
      return Response.json({ok:true});
    }

    if(action==='assignOpenTruck'){
      const equipmentId=id(body.equipmentId);const truck=await equipment(equipmentId);
      if(truck.out_of_service)throw new Error(`${truck.unit} is out of service on the Repair Board.`);
      const repair=await truckRepairCounts(equipmentId);
      if(repair.active+repair.outside>0)throw new Error(repairHoldMessage(truck.unit,repair.active,repair.outside));
      const driver=text(body.driver,160);if(!driver)throw new Error('Choose or enter a driver.');
      const location=text(body.location,160);
      const row=await env.DB.prepare('SELECT current_driver,current_location,pool_status FROM fleet_truck_assignments WHERE equipment_id=?').bind(equipmentId).first<{current_driver:string;current_location:string;pool_status:string}>();
      if(!row)throw new Error('Truck assignment was not found.');
      if(row.current_driver)throw new Error(`${truck.unit} is already assigned to ${row.current_driver}.`);
      await env.DB.prepare(`UPDATE fleet_truck_assignments SET current_driver=?,current_location=?,pool_status='assigned',coverage_for_equipment_id=NULL,coverage_for_driver='',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?`)
        .bind(driver,location||row.current_location,user.id,equipmentId).run();
      await logEvent(user,'assigned',equipmentId,null,driver,row.current_location,location||row.current_location,`${truck.unit} assigned to ${driver}.`);
      return Response.json({ok:true});
    }

    if(action==='moveTruck'){
      const equipmentId=id(body.equipmentId);const truck=await equipment(equipmentId);
      const toLocation=text(body.toLocation,160);if(!toLocation)throw new Error('Choose the destination.');
      const reason=text(body.reason,300);
      const row=await env.DB.prepare('SELECT current_driver,current_location FROM fleet_truck_assignments WHERE equipment_id=?').bind(equipmentId).first<{current_driver:string;current_location:string}>();
      if(!row)throw new Error('Truck assignment was not found.');
      await env.DB.prepare('UPDATE fleet_truck_assignments SET current_location=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?').bind(toLocation,user.id,equipmentId).run();
      await logEvent(user,'moved',equipmentId,null,row.current_driver,row.current_location,toLocation,`${truck.unit} moved to ${toLocation}${reason?`: ${reason}`:''}.`);
      return Response.json({ok:true});
    }

    if(action==='startCoverageSwap'){
      const homeId=id(body.homeEquipmentId),coverageId=id(body.coverageEquipmentId);
      if(homeId===coverageId)throw new Error('Choose a different coverage truck.');
      const [home,coverage]=await Promise.all([equipment(homeId),equipment(coverageId)]);
      if(coverage.out_of_service)throw new Error(`${coverage.unit} is out of service on the Repair Board.`);
      const repairs=await truckRepairCounts(coverageId);
      if(repairs.active+repairs.outside>0)throw new Error(repairHoldMessage(coverage.unit,repairs.active,repairs.outside));
      const driver=text(body.driver,160);if(!driver)throw new Error('Driver is required.');
      const workingLocation=text(body.workingLocation,160),serviceLocation=text(body.serviceLocation,160)||'Clare';
      const reason=text(body.reason,300),returnPool=pool(body.coverageReturnPool,['open','spare']);
      const [homeA,coverageA]=await Promise.all([
        env.DB.prepare('SELECT home_driver,home_location,current_driver,current_location,pool_status FROM fleet_truck_assignments WHERE equipment_id=?').bind(homeId).first<{home_driver:string;home_location:string;current_driver:string;current_location:string;pool_status:string}>(),
        env.DB.prepare('SELECT current_driver,current_location,pool_status FROM fleet_truck_assignments WHERE equipment_id=?').bind(coverageId).first<{current_driver:string;current_location:string;pool_status:string}>(),
      ]);
      if(!homeA||!coverageA)throw new Error('One of the truck assignments was not found.');
      if(homeA.home_driver&&homeA.home_driver.toLowerCase()!==driver.toLowerCase())throw new Error(`${home.unit} is permanently assigned to ${homeA.home_driver}, not ${driver}.`);
      if(coverageA.current_driver)throw new Error(`${coverage.unit} is already assigned to ${coverageA.current_driver}.`);
      if(!['open','spare'].includes(coverageA.pool_status))throw new Error(`${coverage.unit} is not in the open/spare pool.`);
      const existing=await env.DB.prepare('SELECT id FROM fleet_coverage_swaps WHERE closed_at IS NULL AND (home_equipment_id IN (?,?) OR coverage_equipment_id IN (?,?)) LIMIT 1').bind(homeId,coverageId,homeId,coverageId).first();
      if(existing)throw new Error('One of these trucks is already in an active coverage swap.');
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO fleet_coverage_swaps(driver,home_equipment_id,coverage_equipment_id,working_location,service_location,reason,coverage_return_pool,opened_by_user_id)
          VALUES(?,?,?,?,?,?,?,?)`).bind(driver,homeId,coverageId,workingLocation||homeA.current_location,serviceLocation,reason,returnPool,user.id),
        env.DB.prepare(`UPDATE fleet_truck_assignments SET current_driver='',current_location=?,pool_status='service',coverage_for_equipment_id=NULL,coverage_for_driver=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?`)
          .bind(serviceLocation,driver,user.id,homeId),
        env.DB.prepare(`UPDATE fleet_truck_assignments SET current_driver=?,current_location=?,pool_status='coverage',coverage_for_equipment_id=?,coverage_for_driver=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?`)
          .bind(driver,workingLocation||homeA.current_location,homeId,driver,user.id,coverageId),
      ]);
      await logEvent(user,'coverage_swap_started',homeId,coverageId,driver,homeA.current_location,serviceLocation,`${coverage.unit} sent to ${driver}; ${home.unit} sent to ${serviceLocation} for ${reason||'service'}.`);
      return Response.json({ok:true});
    }

    if(action==='markCoverageReady'){
      const swapId=id(body.swapId);
      const swap=await env.DB.prepare('SELECT id,home_equipment_id FROM fleet_coverage_swaps WHERE id=? AND closed_at IS NULL').bind(swapId).first<{id:number;home_equipment_id:number}>();
      if(!swap)throw new Error('Active coverage swap was not found.');
      const home=await equipment(swap.home_equipment_id);
      const repair=await truckRepairCounts(home.id);
      if(repair.oos)throw new Error(`${home.unit} remains out of service.`);
      if(repair.active+repair.outside>0)throw new Error(repairHoldMessage(home.unit,repair.active,repair.outside));
      await env.DB.prepare('UPDATE fleet_coverage_swaps SET ready_at=CURRENT_TIMESTAMP,ready_by_user_id=? WHERE id=?').bind(user.id,swapId).run();
      await logEvent(user,'ready_to_return',home.id,null,'','','',`${home.unit} marked ready to return to its permanent driver.`);
      return Response.json({ok:true});
    }

    if(action==='completeCoverageSwap'){
      const swapId=id(body.swapId);
      const swap=await env.DB.prepare(`SELECT id,driver,home_equipment_id,coverage_equipment_id,working_location,service_location,coverage_return_pool FROM fleet_coverage_swaps WHERE id=? AND closed_at IS NULL`).bind(swapId)
        .first<{id:number;driver:string;home_equipment_id:number;coverage_equipment_id:number;working_location:string;service_location:string;coverage_return_pool:string}>();
      if(!swap)throw new Error('Active coverage swap was not found.');
      const [home,coverage]=await Promise.all([equipment(swap.home_equipment_id),equipment(swap.coverage_equipment_id)]);
      const repair=await truckRepairCounts(home.id);
      if(repair.oos)throw new Error(`${home.unit} remains out of service.`);
      if(repair.active+repair.outside>0)throw new Error(repairHoldMessage(home.unit,repair.active,repair.outside));
      const readiness=await env.DB.prepare(`SELECT ready_at,EXISTS(SELECT 1 FROM repairs r WHERE r.equipment_id=? AND r.completed_at IS NOT NULL AND r.completed_at>=opened_at) AS completed_service_work FROM fleet_coverage_swaps WHERE id=?`).bind(home.id,swapId).first<{ready_at:string|null;completed_service_work:number}>();
      if(!readiness?.ready_at&&!readiness?.completed_service_work)throw new Error(`${home.unit} must be marked Ready to Return, or have completed Repair Board work from this swap, before it can go back to the driver.`);
      await env.DB.batch([
        env.DB.prepare(`UPDATE fleet_coverage_swaps SET closed_at=CURRENT_TIMESTAMP,closed_by_user_id=? WHERE id=?`).bind(user.id,swapId),
        env.DB.prepare(`UPDATE fleet_truck_assignments SET current_driver=?,current_location=?,pool_status='assigned',coverage_for_equipment_id=NULL,coverage_for_driver='',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?`)
          .bind(swap.driver,swap.working_location,user.id,home.id),
        env.DB.prepare(`UPDATE fleet_truck_assignments SET current_driver='',current_location=?,pool_status=?,coverage_for_equipment_id=NULL,coverage_for_driver='',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE equipment_id=?`)
          .bind(swap.service_location,swap.coverage_return_pool,user.id,coverage.id),
      ]);
      await logEvent(user,'coverage_swap_completed',home.id,coverage.id,swap.driver,swap.service_location,swap.working_location,`${home.unit} returned to ${swap.driver}; ${coverage.unit} returned to ${swap.service_location} ${swap.coverage_return_pool} pool.`);
      return Response.json({ok:true});
    }

    return Response.json({error:'Unknown truck-assignment action.'},{status:400});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Truck-assignment change failed.'},{status:400});
  }
}
