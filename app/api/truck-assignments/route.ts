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
  open_repairs:number;
};

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
    const [assignments,swaps,events]=await Promise.all([
      env.DB.prepare(`
        SELECT a.equipment_id,e.unit,COALESCE(e.equipment_type,'other') AS equipment_type,
               a.home_driver,a.home_location,a.current_driver,a.current_location,a.pool_status,
               a.truck_class,a.flatbed,a.automatic,a.scheduler_notes,a.coverage_for_equipment_id,a.coverage_for_driver,
               COALESCE(e.out_of_service,0) AS out_of_service,COALESCE(e.out_of_service_reason,'') AS out_of_service_reason,
               e.shop_eta,
               (SELECT COUNT(*) FROM repairs r WHERE r.equipment_id=e.id AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%') AS open_repairs
        FROM fleet_truck_assignments a
        JOIN equipment e ON e.id=a.equipment_id
        WHERE e.active=1 AND e.merged_into_equipment_id IS NULL
        ORDER BY CASE WHEN a.home_location='' THEN 1 ELSE 0 END,a.home_location COLLATE NOCASE,e.unit COLLATE NOCASE
      `).all<AssignmentRow>(),
      env.DB.prepare(`
        SELECT s.id,s.driver,s.home_equipment_id,home.unit AS home_unit,
               s.coverage_equipment_id,coverage.unit AS coverage_unit,
               s.working_location,s.service_location,s.reason,s.coverage_return_pool,s.opened_at
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
      openRepairCount:Number(row.open_repairs||0),
      repairState:Boolean(row.out_of_service)||Number(row.open_repairs||0)>0?'in_shop':row.pool_status==='cleaning'?'cleaning':'clear',
      readyToReturn:row.pool_status==='service'&&!row.out_of_service&&Number(row.open_repairs||0)===0,
    }));
    const active=swaps.results.map(row=>({
      id:row.id,driver:row.driver,homeEquipmentId:row.home_equipment_id,homeUnit:row.home_unit,
      coverageEquipmentId:row.coverage_equipment_id,coverageUnit:row.coverage_unit,
      workingLocation:row.working_location,serviceLocation:row.service_location,reason:row.reason,
      coverageReturnPool:row.coverage_return_pool,openedAt:row.opened_at,
      readyToReturn:Boolean(rows.find(x=>x.equipmentId===row.home_equipment_id)?.readyToReturn),
    }));
    return Response.json({
      permissions:{canOperate:true,canEditMaster:canEditMaster(user)},
      assignments:rows,activeSwaps:active,events:events.results,
      summary:{
        assigned:rows.filter(x=>x.status==='assigned').length,
        open:rows.filter(x=>x.status==='open').length,
        spare:rows.filter(x=>x.status==='spare').length,
        coverage:rows.filter(x=>x.status==='coverage').length,
        service:rows.filter(x=>x.status==='service'||x.repairState==='in_shop').length,
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

    if(action==='completeCoverageSwap'){
      const swapId=id(body.swapId);
      const swap=await env.DB.prepare(`SELECT id,driver,home_equipment_id,coverage_equipment_id,working_location,service_location,coverage_return_pool FROM fleet_coverage_swaps WHERE id=? AND closed_at IS NULL`).bind(swapId)
        .first<{id:number;driver:string;home_equipment_id:number;coverage_equipment_id:number;working_location:string;service_location:string;coverage_return_pool:string}>();
      if(!swap)throw new Error('Active coverage swap was not found.');
      const [home,coverage]=await Promise.all([equipment(swap.home_equipment_id),equipment(swap.coverage_equipment_id)]);
      const repair=await env.DB.prepare(`SELECT COALESCE(e.out_of_service,0) AS oos,(SELECT COUNT(*) FROM repairs r WHERE r.equipment_id=e.id AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%') AS open_repairs FROM equipment e WHERE e.id=?`)
        .bind(home.id).first<{oos:number;open_repairs:number}>();
      if(Boolean(repair?.oos)||Number(repair?.open_repairs||0)>0)throw new Error(`${home.unit} still has open Repair Board work or is out of service.`);
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
