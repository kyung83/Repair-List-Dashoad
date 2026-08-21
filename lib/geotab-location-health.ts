import { classifyGeotabLocationState, geotabAgeLabel } from './geotab-location-state.js';

type ExpectedRow={
  equipment_id:number;unit:string;equipment_type:string;geotab_device_id:string;
  latitude:number|null;longitude:number|null;gps_observed_at:string|null;gps_source:string|null;
  communicating:number|null;yard:string|null;yard_zone_name:string|null;
};
type UnmappedRow={equipment_id:number;unit:string;equipment_type:string;geotab_device_id:string};
type CursorRow={version:string|null;updated_at:string|null;last_success_at:string|null;last_error:string|null};
type ZoneRow={yard_key:string;expected_name:string;geotab_zone_id:string|null;geotab_zone_name:string|null;status:string};

export async function getGeotabLocationHealth(db:D1Database){
  const[expectedResult,unmappedResult,cursor,zonesResult]=await Promise.all([
    db.prepare(`
      SELECT e.id AS equipment_id,e.unit,COALESCE(e.equipment_type,'') AS equipment_type,d.geotab_device_id,
             s.latitude,s.longitude,s.gps_observed_at,s.gps_source,s.communicating,s.yard,s.yard_zone_name
      FROM equipment_geotab_devices d
      JOIN equipment e ON e.id=d.equipment_id
      LEFT JOIN geotab_unit_state s ON s.equipment_id=e.id AND s.geotab_device_id=d.geotab_device_id
      WHERE d.current=1 AND e.active=1 AND e.archived_at IS NULL AND e.merged_into_equipment_id IS NULL
      ORDER BY e.unit,e.id
    `).all<ExpectedRow>(),
    db.prepare(`
      SELECT e.id AS equipment_id,e.unit,COALESCE(e.equipment_type,'') AS equipment_type,COALESCE(e.geotab_device_id,'') AS geotab_device_id
      FROM equipment e
      WHERE e.active=1 AND e.archived_at IS NULL AND e.merged_into_equipment_id IS NULL
        AND TRIM(COALESCE(e.geotab_device_id,''))<>''
        AND NOT EXISTS(SELECT 1 FROM equipment_geotab_devices d WHERE d.equipment_id=e.id AND d.current=1)
      ORDER BY e.unit,e.id
    `).all<UnmappedRow>(),
    db.prepare(`SELECT version,updated_at,last_success_at,last_error FROM geotab_feed_cursors WHERE feed='gps-log-record'`).first<CursorRow>(),
    db.prepare(`SELECT yard_key,expected_name,geotab_zone_id,geotab_zone_name,status FROM geotab_yard_zones ORDER BY yard_key`).all<ZoneRow>(),
  ]);

  const attention:Array<Record<string,unknown>>=[];
  let live=0,recent=0,parkedConfirmed=0,stale=0,noData=0,offline=0;
  for(const row of expectedResult.results){
    const state=classifyGeotabLocationState({
      hasAssignment:true,equipmentType:row.equipment_type,gpsObservedAt:row.gps_observed_at,
      communicating:row.communicating,yard:row.yard,
    });
    if(state.code==='LIVE')live+=1;
    else if(state.code==='RECENT')recent+=1;
    else if(state.code==='PARKED_CONFIRMED')parkedConfirmed+=1;
    else if(state.code==='STALE_LAST_KNOWN')stale+=1;
    else if(state.code==='NO_GPS_DATA')noData+=1;
    else if(state.code==='NOT_TRACKING')offline+=1;

    if(!['LIVE','RECENT'].includes(state.code)){
      attention.push({
        equipmentId:Number(row.equipment_id),unit:row.unit,equipmentType:row.equipment_type,
        geotabDeviceId:row.geotab_device_id,trackingState:state.code,trackingLabel:state.label,
        trackingDetail:state.detail,ageLabel:geotabAgeLabel(state.ageMinutes),stale:Boolean(state.stale),
        actuallyNotTracking:Boolean(state.actuallyNotTracking),locationUsable:Boolean(state.locationUsable),
        gpsObservedAt:row.gps_observed_at,gpsSource:row.gps_source??'',communicating:row.communicating==null?null:Boolean(row.communicating),
        yard:row.yard??'',yardZoneName:row.yard_zone_name??'',latitude:row.latitude,longitude:row.longitude,
        structured:true,
      });
    }
  }

  for(const row of unmappedResult.results){
    const state=classifyGeotabLocationState({hasAssignment:false,equipmentType:row.equipment_type});
    attention.push({
      equipmentId:Number(row.equipment_id),unit:row.unit,equipmentType:row.equipment_type,
      geotabDeviceId:row.geotab_device_id,trackingState:state.code,trackingLabel:state.label,
      trackingDetail:state.detail,ageLabel:'—',stale:false,actuallyNotTracking:false,locationUsable:false,
      gpsObservedAt:null,gpsSource:'',communicating:null,yard:'',yardZoneName:'',latitude:null,longitude:null,structured:false,
    });
  }

  const identityErrors=unmappedResult.results.length;
  const expected=expectedResult.results.length;
  const problems=stale+noData+offline+identityErrors;
  const status=problems===0?'healthy':'attention';
  const lastRun=cursor?{
    result_status:cursor.last_error?'error':'ok',
    finished_at:cursor.last_success_at??cursor.updated_at,
    message:cursor.last_error||`LogRecord feed cursor ${cursor.version||'initializing'}`,
  }:null;

  return{
    status,mode:'logrecord-feed',
    summary:{
      expected,structured:expected,live,recent,parkedConfirmed,stale,noData,offline,identityErrors,
      locationKnown:expected-noData,actuallyNotTracking:offline,
    },
    lastRun,zones:zonesResult.results,attention,updatedAt:new Date().toISOString(),
  };
}
