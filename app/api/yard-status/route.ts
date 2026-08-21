import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { syncGeotabGpsFeed, syncGeotabLocationMirror } from '@/lib/geotab-gps-feed';
import { getGeotabLocationHealth } from '@/lib/geotab-location-health';
import { classifyGeotabLocationState } from '@/lib/geotab-location-state.js';
import { normalizeYard, type YardSelection } from '@/lib/yards';

type YardRow={
  id:number;equipment_type:string;geotab_device_id:string|null;
  yard:string|null;yard_zone_name:string|null;latitude:number|null;longitude:number|null;
  gps_observed_at:string|null;gps_received_at:string|null;communicating:number|null;
};

async function session(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  return user;
}

export async function GET(request:Request){
  try{
    await session(request);
    const[rows,health]=await Promise.all([
      env.DB.prepare(`
        SELECT e.id,COALESCE(e.equipment_type,'') AS equipment_type,d.geotab_device_id,
               s.yard,s.yard_zone_name,s.latitude,s.longitude,s.gps_observed_at,s.gps_received_at,s.communicating
        FROM equipment e
        LEFT JOIN equipment_geotab_devices d ON d.equipment_id=e.id AND d.current=1
        LEFT JOIN geotab_unit_state s ON s.equipment_id=e.id AND s.geotab_device_id=d.geotab_device_id
        WHERE e.active=1 AND e.archived_at IS NULL AND e.merged_into_equipment_id IS NULL
        ORDER BY e.id
      `).all<YardRow>(),
      getGeotabLocationHealth(env.DB),
    ]);

    const byEquipment:Record<string,{
      currentYard:YardSelection;zoneName:string;latitude:number|null;longitude:number|null;
      positionAt:string;yardUpdatedAt:string;trackingState:string;trackingLabel:string;
      actuallyNotTracking:boolean;stale:boolean;locationUsable:boolean;
    }>={};
    const counts:Record<string,number>={clare:0,cadillac:0,gr:0,taylor:0,boyne:0,outside:0};

    for(const row of rows.results){
      const state=classifyGeotabLocationState({
        hasAssignment:Boolean(row.geotab_device_id),equipmentType:row.equipment_type,
        gpsObservedAt:row.gps_observed_at,communicating:row.communicating,yard:row.yard,
      });
      const currentYard=normalizeYard(row.yard??'');
      if(currentYard&&counts[currentYard]!==undefined)counts[currentYard]+=1;else counts.outside+=1;
      byEquipment[String(row.id)]={
        currentYard,zoneName:row.yard_zone_name??'',latitude:row.latitude==null?null:Number(row.latitude),
        longitude:row.longitude==null?null:Number(row.longitude),positionAt:row.gps_observed_at??'',
        yardUpdatedAt:row.gps_received_at??'',trackingState:state.code,trackingLabel:state.label,
        actuallyNotTracking:Boolean(state.actuallyNotTracking),stale:Boolean(state.stale),locationUsable:Boolean(state.locationUsable),
      };
    }

    const zones=new Map((health.zones??[]).map((zone:any)=>[String(zone.yard_key),zone]));
    return Response.json({
      byEquipment,
      sync:{
        status:health.status==='healthy'?'ok':'warning',
        message:'Yard routing is using the persistent Geotab LogRecord feed and last-known-good location state.',
        positions:health.summary.locationKnown,
        clare:counts.clare,cadillac:counts.cadillac,gr:counts.gr,taylor:counts.taylor,boyne:counts.boyne,outside:counts.outside,
        clareZoneFound:Boolean(zones.get('clare')?.geotab_zone_id),cadillacZoneFound:Boolean(zones.get('cadillac')?.geotab_zone_id),
        grZoneFound:Boolean(zones.get('gr')?.geotab_zone_id),taylorZoneFound:Boolean(zones.get('taylor')?.geotab_zone_id),
        boyneZoneFound:Boolean(zones.get('boyne')?.geotab_zone_id),updatedAt:String(health.lastRun?.finished_at??health.updatedAt??''),
      },
    },{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'yard_status_get_failed',error:String(error)}));
    const message=error instanceof Error?error.message:'Yard status could not be loaded.';
    return Response.json({error:message},{status:message==='Authentication required.'?401:400});
  }
}

export async function POST(request:Request){
  try{
    const user=await session(request);
    if(user.role!=='manager'&&user.role!=='admin')return Response.json({error:'Manager or administrator access is required.'},{status:403});
    const feed=await syncGeotabGpsFeed(env);
    const mirror=await syncGeotabLocationMirror(env.DB);
    return Response.json({ok:true,feed,mirror,message:'Geotab location feed refreshed. Last-known yard locations were preserved.'},{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error(JSON.stringify({event:'yard_status_refresh_failed',error:String(error)}));
    return Response.json({error:error instanceof Error?error.message:'Geotab location refresh failed.'},{status:400});
  }
}
