import {
  createGeotabClient,
  geotabArray,
  geotabGet,
  geotabObjectId,
  geotabRecord,
  geotabText,
  type GeotabClientEnv,
  type GeotabJsonRecord,
} from './geotab-client';
import { YARD_DEFINITIONS, type YardKey, type YardSelection } from './yards';

type Env = GeotabClientEnv & { DB: D1Database };
type Point = { x:number; y:number };
type YardZone = { key:YardKey; id:string; name:string; points:Point[] };
type AssignmentRow = { equipment_id:number; equipment_type:string; geotab_device_id:string };
type StateRow = {
  equipment_id:number;
  geotab_device_id:string;
  latitude:number|null;
  longitude:number|null;
  gps_observed_at:string|null;
  gps_received_at:string|null;
  gps_source:string|null;
  communicating:number|null;
  communication_observed_at:string|null;
  yard:string|null;
  yard_zone_id:string|null;
  yard_zone_name:string|null;
  yard_confirmed_at:string|null;
};
type YardPin = { yard_key:string; expected_name:string; geotab_zone_id:string|null };
type FeedResult = { data?:unknown; Data?:unknown; toVersion?:unknown; ToVersion?:unknown };
type FeedRecord = { deviceId:string; latitude:number; longitude:number; observedAt:string };

const FEED = 'gps-log-record';
const LEASE = 'gps-feed';
const LEASE_SECONDS = 55;
const RESULT_LIMIT = 10000;
const MAX_BATCHES_PER_RUN = 5;
const ZONE_CACHE_MS = 10 * 60 * 1000;
let zoneCache:{expiresAt:number;zones:YardZone[];allResolved:boolean}|null=null;

function parseDateMs(value:string|null|undefined){
  if(!value)return null;
  const normalized=value.includes('T')?value:`${value.replace(' ','T')}Z`;
  const parsed=Date.parse(normalized);
  return Number.isFinite(parsed)?parsed:null;
}
function numberValue(value:unknown){const n=Number(value);return Number.isFinite(n)?n:null;}
function currentZone(zone:GeotabJsonRecord,now=Date.now()){
  const from=parseDateMs(geotabText(geotabGet(zone,'activeFrom','ActiveFrom')).trim()||null);
  const to=parseDateMs(geotabText(geotabGet(zone,'activeTo','ActiveTo')).trim()||null);
  return(from==null||from<=now)&&(to==null||to>now);
}
function zonePoints(zone:GeotabJsonRecord):Point[]{
  const points:Point[]=[];
  for(const raw of geotabArray(geotabGet(zone,'points','Points'))){
    const x=numberValue(geotabGet(raw,'x','X'));const y=numberValue(geotabGet(raw,'y','Y'));
    if(x!=null&&y!=null)points.push({x,y});
  }
  return points;
}
function pointInPolygon(longitude:number,latitude:number,polygon:Point[]){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const xi=polygon[i].x,yi=polygon[i].y,xj=polygon[j].x,yj=polygon[j].y;
    const crosses=(yi>latitude)!==(yj>latitude)&&longitude<((xj-xi)*(latitude-yi))/((yj-yi)||Number.EPSILON)+xi;
    if(crosses)inside=!inside;
  }
  return inside;
}
function matchYard(longitude:number,latitude:number,zones:YardZone[]){
  const match=zones.find(zone=>pointInPolygon(longitude,latitude,zone.points));
  return match?{yard:match.key as YardSelection,zoneId:match.id,zoneName:match.name}:null;
}

async function acquireLease(db:D1Database,ownerId:string){
  await db.prepare(`
    INSERT INTO geotab_sync_leases (pipeline,owner_id,locked_until,heartbeat_at,acquired_at)
    VALUES (?,?,datetime('now',?),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(pipeline) DO UPDATE SET
      owner_id=excluded.owner_id,locked_until=excluded.locked_until,heartbeat_at=CURRENT_TIMESTAMP,acquired_at=CURRENT_TIMESTAMP
    WHERE geotab_sync_leases.locked_until<=CURRENT_TIMESTAMP OR geotab_sync_leases.owner_id=excluded.owner_id
  `).bind(LEASE,ownerId,`+${LEASE_SECONDS} seconds`).run();
  const row=await db.prepare('SELECT owner_id FROM geotab_sync_leases WHERE pipeline=?').bind(LEASE).first<{owner_id:string}>();
  return row?.owner_id===ownerId;
}
async function releaseLease(db:D1Database,ownerId:string){
  await db.prepare('DELETE FROM geotab_sync_leases WHERE pipeline=? AND owner_id=?').bind(LEASE,ownerId).run();
}
async function cursor(db:D1Database){
  const row=await db.prepare('SELECT version FROM geotab_feed_cursors WHERE feed=?').bind(FEED).first<{version:string|null}>();
  return String(row?.version??'').trim();
}
async function saveCursor(db:D1Database,version:string,error=''){
  await db.prepare(`
    INSERT INTO geotab_feed_cursors (feed,version,updated_at,last_success_at,last_error)
    VALUES (?,?,CURRENT_TIMESTAMP,CASE WHEN ?='' THEN CURRENT_TIMESTAMP ELSE NULL END,NULLIF(?,''))
    ON CONFLICT(feed) DO UPDATE SET
      version=CASE WHEN ?='' THEN excluded.version ELSE geotab_feed_cursors.version END,
      updated_at=CURRENT_TIMESTAMP,
      last_success_at=CASE WHEN ?='' THEN CURRENT_TIMESTAMP ELSE geotab_feed_cursors.last_success_at END,
      last_error=NULLIF(?, '')
  `).bind(FEED,version,error,error,error,error,error).run();
}
async function saveFeedError(db:D1Database,error:string){
  await db.prepare(`
    INSERT INTO geotab_feed_cursors (feed,version,updated_at,last_error)
    VALUES (?,NULL,CURRENT_TIMESTAMP,?)
    ON CONFLICT(feed) DO UPDATE SET updated_at=CURRENT_TIMESTAMP,last_error=excluded.last_error
  `).bind(FEED,error.slice(0,500)).run();
}

async function loadAssignments(db:D1Database){
  const result=await db.prepare(`
    SELECT e.id AS equipment_id,COALESCE(e.equipment_type,'') AS equipment_type,d.geotab_device_id
    FROM equipment_geotab_devices d
    JOIN equipment e ON e.id=d.equipment_id
    WHERE d.current=1 AND e.active=1 AND e.archived_at IS NULL AND e.merged_into_equipment_id IS NULL
    ORDER BY e.id
  `).all<AssignmentRow>();
  const byDevice=new Map<string,AssignmentRow|null>();
  for(const row of result.results){
    const id=String(row.geotab_device_id||'').trim();if(!id)continue;
    if(byDevice.has(id))byDevice.set(id,null);else byDevice.set(id,row);
  }
  return byDevice;
}
async function loadStates(db:D1Database){
  const result=await db.prepare(`
    SELECT equipment_id,geotab_device_id,latitude,longitude,gps_observed_at,gps_received_at,gps_source,
           communicating,communication_observed_at,yard,yard_zone_id,yard_zone_name,yard_confirmed_at
    FROM geotab_unit_state
  `).all<StateRow>();
  return new Map(result.results.map(row=>[Number(row.equipment_id),row]));
}
async function loadZones(db:D1Database,client:Awaited<ReturnType<typeof createGeotabClient>>){
  if(zoneCache&&zoneCache.expiresAt>Date.now())return zoneCache;
  const[zoneRows,pinRows]=await Promise.all([
    client.call<GeotabJsonRecord[]>('Get',{typeName:'Zone'}),
    db.prepare('SELECT yard_key,expected_name,geotab_zone_id FROM geotab_yard_zones ORDER BY yard_key').all<YardPin>(),
  ]);
  const active=zoneRows.filter(zone=>currentZone(zone));
  const byId=new Map(active.map(zone=>[geotabObjectId(zone),zone]).filter(([id])=>Boolean(id)));
  const pins=new Map(pinRows.results.map(row=>[row.yard_key,row]));
  const zones:YardZone[]=[];
  for(const definition of YARD_DEFINITIONS){
    const pin=pins.get(definition.key);let zone:GeotabJsonRecord|undefined;
    if(pin?.geotab_zone_id)zone=byId.get(pin.geotab_zone_id);
    if(!zone){
      const expected=(pin?.expected_name||definition.zoneName).trim().toLowerCase();
      zone=active.find(candidate=>geotabText(geotabGet(candidate,'name','Name')).trim().toLowerCase()===expected);
    }
    if(!zone)continue;
    const id=geotabObjectId(zone),name=geotabText(geotabGet(zone,'name','Name')).trim()||definition.zoneName,points=zonePoints(zone);
    if(id&&points.length>=3)zones.push({key:definition.key,id,name,points});
  }
  zoneCache={expiresAt:Date.now()+ZONE_CACHE_MS,zones,allResolved:zones.length===YARD_DEFINITIONS.length};
  return zoneCache;
}

function feedRecords(value:unknown){
  const rows=geotabArray(value);const result:FeedRecord[]=[];
  for(const row of rows){
    const deviceId=geotabObjectId(geotabGet(row,'device','Device'));
    const latitude=numberValue(geotabGet(row,'latitude','Latitude'));
    const longitude=numberValue(geotabGet(row,'longitude','Longitude'));
    const observedAt=geotabText(geotabGet(row,'dateTime','DateTime')).trim();
    const observedMs=parseDateMs(observedAt);
    if(!deviceId||latitude==null||longitude==null||observedMs==null)continue;
    if(latitude<-90||latitude>90||longitude<-180||longitude>180)continue;
    result.push({deviceId,latitude,longitude,observedAt});
  }
  return result;
}

function stateStatement(db:D1Database,assignment:AssignmentRow,existing:StateRow|undefined,record:FeedRecord,zones:YardZone[],allResolved:boolean){
  const incomingMs=parseDateMs(record.observedAt)!;
  const existingMs=parseDateMs(existing?.gps_observed_at);
  if(existingMs!=null&&incomingMs<=existingMs)return null;
  const match=matchYard(record.longitude,record.latitude,zones);
  const yard=match?match.yard:allResolved?'':String(existing?.yard??'');
  const zoneId=match?match.zoneId:allResolved?null:existing?.yard_zone_id??null;
  const zoneName=match?match.zoneName:allResolved?null:existing?.yard_zone_name??null;
  const confirmedAt=match||allResolved?record.observedAt:existing?.yard_confirmed_at??null;
  const receivedAt=new Date().toISOString();
  return db.prepare(`
    INSERT INTO geotab_unit_state (
      equipment_id,geotab_device_id,latitude,longitude,gps_observed_at,gps_received_at,gps_source,
      communicating,communication_observed_at,yard,yard_zone_id,yard_zone_name,yard_confirmed_at,
      last_successful_sync_at,last_error_code,updated_at
    ) VALUES (?,?,?,?,?,?,'LogRecordFeed',1,CURRENT_TIMESTAMP,?,?,?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)
    ON CONFLICT(equipment_id) DO UPDATE SET
      geotab_device_id=excluded.geotab_device_id,latitude=excluded.latitude,longitude=excluded.longitude,
      gps_observed_at=excluded.gps_observed_at,gps_received_at=excluded.gps_received_at,gps_source=excluded.gps_source,
      communicating=1,communication_observed_at=CURRENT_TIMESTAMP,yard=excluded.yard,yard_zone_id=excluded.yard_zone_id,
      yard_zone_name=excluded.yard_zone_name,yard_confirmed_at=excluded.yard_confirmed_at,
      last_successful_sync_at=CURRENT_TIMESTAMP,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
  `).bind(
    assignment.equipment_id,assignment.geotab_device_id,record.latitude,record.longitude,record.observedAt,receivedAt,
    yard,zoneId,zoneName,confirmedAt,
  );
}

export async function syncGeotabLocationMirror(db:D1Database){
  const result=await db.prepare(`
    UPDATE equipment
    SET geotab_latitude=(SELECT s.latitude FROM geotab_unit_state s JOIN equipment_geotab_devices d ON d.equipment_id=equipment.id AND d.current=1 WHERE s.equipment_id=equipment.id AND s.geotab_device_id=d.geotab_device_id),
        geotab_longitude=(SELECT s.longitude FROM geotab_unit_state s JOIN equipment_geotab_devices d ON d.equipment_id=equipment.id AND d.current=1 WHERE s.equipment_id=equipment.id AND s.geotab_device_id=d.geotab_device_id),
        geotab_position_at=(SELECT s.gps_observed_at FROM geotab_unit_state s JOIN equipment_geotab_devices d ON d.equipment_id=equipment.id AND d.current=1 WHERE s.equipment_id=equipment.id AND s.geotab_device_id=d.geotab_device_id),
        current_yard=COALESCE((SELECT s.yard FROM geotab_unit_state s JOIN equipment_geotab_devices d ON d.equipment_id=equipment.id AND d.current=1 WHERE s.equipment_id=equipment.id AND s.geotab_device_id=d.geotab_device_id),current_yard,''),
        current_yard_zone=COALESCE((SELECT s.yard_zone_name FROM geotab_unit_state s JOIN equipment_geotab_devices d ON d.equipment_id=equipment.id AND d.current=1 WHERE s.equipment_id=equipment.id AND s.geotab_device_id=d.geotab_device_id),'') ,
        yard_updated_at=COALESCE((SELECT s.yard_confirmed_at FROM geotab_unit_state s JOIN equipment_geotab_devices d ON d.equipment_id=equipment.id AND d.current=1 WHERE s.equipment_id=equipment.id AND s.geotab_device_id=d.geotab_device_id),yard_updated_at),
        updated_at=CURRENT_TIMESTAMP
    WHERE active=1 AND archived_at IS NULL AND merged_into_equipment_id IS NULL
      AND EXISTS(
        SELECT 1 FROM geotab_unit_state s JOIN equipment_geotab_devices d ON d.equipment_id=equipment.id AND d.current=1
        WHERE s.equipment_id=equipment.id AND s.geotab_device_id=d.geotab_device_id
      )
  `).run();
  return{ok:true,mirrored:Number(result.meta.changes??0)};
}

export async function syncGeotabGpsFeed(env:Env){
  const ownerId=crypto.randomUUID();
  if(!(await acquireLease(env.DB,ownerId)))return{ok:true,skipped:true,reason:'feed already running'};
  try{
    const client=await createGeotabClient(env);
    const[assignments,states,zoneState]=await Promise.all([
      loadAssignments(env.DB),loadStates(env.DB),loadZones(env.DB,client),
    ]);
    let version=await cursor(env.DB);
    let processed=0,matched=0,ignoredAmbiguous=0,batches=0,initialized=!version;
    while(batches<MAX_BATCHES_PER_RUN){
      const params:GeotabJsonRecord={typeName:'LogRecord',resultsLimit:RESULT_LIMIT};
      if(version)params.fromVersion=version;
      const raw=geotabRecord(await client.call<FeedResult>('GetFeed',params));
      const data=geotabGet(raw,'data','Data');
      const toVersion=geotabText(geotabGet(raw,'toVersion','ToVersion')).trim();
      if(!toVersion)throw new Error('Geotab LogRecord feed returned no toVersion cursor.');
      const records=feedRecords(data);
      const newest=new Map<number,{assignment:AssignmentRow;record:FeedRecord}>();
      for(const record of records){
        processed+=1;
        const assignment=assignments.get(record.deviceId);
        if(assignment===null){ignoredAmbiguous+=1;continue;}
        if(!assignment)continue;
        const current=newest.get(assignment.equipment_id);
        if(!current||parseDateMs(record.observedAt)!>parseDateMs(current.record.observedAt)!)newest.set(assignment.equipment_id,{assignment,record});
      }
      const statements:D1PreparedStatement[]=[];
      for(const item of newest.values()){
        const statement=stateStatement(env.DB,item.assignment,states.get(item.assignment.equipment_id),item.record,zoneState.zones,zoneState.allResolved);
        if(statement){statements.push(statement);matched+=1;}
      }
      for(let index=0;index<statements.length;index+=60)await env.DB.batch(statements.slice(index,index+60));
      await saveCursor(env.DB,toVersion);
      version=toVersion;batches+=1;
      for(const item of newest.values()){
        const existing=states.get(item.assignment.equipment_id);
        if(!existing||parseDateMs(item.record.observedAt)!>(parseDateMs(existing.gps_observed_at)??-Infinity)){
          states.set(item.assignment.equipment_id,{...existing,equipment_id:item.assignment.equipment_id,geotab_device_id:item.assignment.geotab_device_id,latitude:item.record.latitude,longitude:item.record.longitude,gps_observed_at:item.record.observedAt,gps_received_at:new Date().toISOString(),gps_source:'LogRecordFeed',communicating:1,communication_observed_at:new Date().toISOString(),yard:existing?.yard??'',yard_zone_id:existing?.yard_zone_id??null,yard_zone_name:existing?.yard_zone_name??null,yard_confirmed_at:existing?.yard_confirmed_at??null});
        }
      }
      if(records.length<RESULT_LIMIT)break;
    }
    const mirror=await syncGeotabLocationMirror(env.DB);
    const result={ok:true,initialized,processed,matched,ignoredAmbiguous,batches,toVersion:version,zonesResolved:zoneState.zones.length,mirror:mirror.mirrored};
    console.log(JSON.stringify({event:'geotab_gps_feed_sync',...result}));
    return result;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await saveFeedError(env.DB,message).catch(()=>undefined);
    throw error;
  }finally{
    await releaseLease(env.DB,ownerId).catch(()=>undefined);
  }
}
