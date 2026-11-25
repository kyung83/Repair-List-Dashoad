import {notifyBreakdownEmailGroup} from './notifications';
import {createGeotabClient,geotabArray,geotabGet,geotabObjectId,geotabText,type GeotabClientEnv} from './geotab-client';
import {inspectRollingMovement,parseRollingTime,validPosition,type MotionPoint,type MotionAnchor} from './breakdown-rolling-motion';

type Env=GeotabClientEnv&{DB:D1Database};
type ScanRow={id:number;equipment_id:number;created_at:string;latitude:number|null;longitude:number|null;gps_observed_at:string|null;snapshot_source:string;device_id:string;assigned_at:string;scanned_through:string|null;ignore_before:string|null;anchor_at:string|null;anchor_latitude:number|null;anchor_longitude:number|null;state:string|null};
const OVERLAP=30*60_000;
const WINDOW=12*60*60_000;
const LIMIT=10000;
const iso=(value:number)=>new Date(value).toISOString();

/** Only a uniquely assigned tracker belonging to the affected equipment is used.
 * A trailer's snapshot may reference its tractor, which is NOT proof of trailer movement.
 */
export async function checkBreakdownRolling(env:Env,scheduledAt=Date.now()){
  const rows=await env.DB.prepare(`
    SELECT b.id,b.equipment_id,b.created_at,b.latitude,b.longitude,b.gps_observed_at,b.snapshot_source,
      d.geotab_device_id AS device_id,d.assigned_at,
      c.scanned_through,c.ignore_before,c.anchor_at,c.anchor_latitude,c.anchor_longitude,c.state
    FROM roadside_breakdowns b
    JOIN equipment e ON e.id=b.equipment_id AND e.active=1 AND e.archived_at IS NULL
    JOIN equipment_geotab_devices d ON d.equipment_id=b.equipment_id AND d.current=1
    LEFT JOIN breakdown_rolling_checks c ON c.breakdown_id=b.id AND c.equipment_id=b.equipment_id AND c.device_id=d.geotab_device_id
    WHERE b.stage<5 AND b.rolling_at IS NULL AND b.status<>'not_breakdown'
      AND b.snapshot_source<>'unit-corrected'
      AND julianday(d.assigned_at)<=julianday(b.created_at)
      AND (SELECT COUNT(*) FROM equipment_geotab_devices x WHERE x.equipment_id=b.equipment_id AND x.current=1)=1
      AND (SELECT COUNT(*) FROM equipment_geotab_devices x WHERE x.geotab_device_id=d.geotab_device_id AND x.current=1)=1
      AND (c.state IS NULL OR c.state='watching')
    ORDER BY COALESCE(c.scanned_through,b.created_at),b.id
  `).all<ScanRow>();
  if(!rows.results.length)return {checked:0,flagged:0,errors:0};
  const client=await createGeotabClient(env);
  const now=Math.min(scheduledAt,Date.now());
  let checked=0,flagged=0,errors=0;
  for(const row of rows.results){
    try{
      const reported=parseRollingTime(row.created_at);
      const assigned=parseRollingTime(row.assigned_at);
      if(!Number.isFinite(reported)||!Number.isFinite(assigned)||assigned>reported)continue;
      const ignored=parseRollingTime(row.ignore_before);
      const rechecking=Number.isFinite(ignored);
      const earliest=rechecking?Math.max(reported,ignored):Math.max(assigned,reported-10*60_000);
      const cursor=parseRollingTime(row.scanned_through);
      const from=Math.max(earliest,Number.isFinite(cursor)?cursor-OVERLAP:earliest);
      let to=Math.min(now,from+WINDOW);
      if(to<=from)continue;
      const getLogs=async(end:number)=>geotabArray(await client.call<unknown>('Get',{
        typeName:'LogRecord',search:{deviceSearch:{id:row.device_id},fromDate:iso(from),toDate:iso(end)},resultsLimit:LIMIT
      }));
      let logs=await getLogs(to);
      if(logs.length>=LIMIT){to=Math.min(to,from+60*60_000);logs=await getLogs(to);}
      if(logs.length>=LIMIT)throw new Error('GPS history window reached result limit; no incomplete evidence accepted.');
      const points:MotionPoint[]=[];
      for(const log of logs){
        if(!geotabObjectId(log)||geotabObjectId(geotabGet(log,'device','Device'))!==row.device_id)continue;
        const at=parseRollingTime(geotabText(geotabGet(log,'dateTime','DateTime')));
        const position=validPosition(geotabGet(log,'latitude','Latitude'),geotabGet(log,'longitude','Longitude'));
        const speed=geotabGet(log,'speed','Speed');
        if(!position||!Number.isFinite(at)||at<from||at>to||speed==null||speed==='')continue;
        const mph=Number(speed)/1.609344;
        if(!Number.isFinite(mph)||mph<0)continue;
        points.push({...position,at,mph});
      }
      const observed=parseRollingTime(row.gps_observed_at);
      const origin=!rechecking&&Number.isFinite(observed)&&Math.abs(observed-reported)<=30*60_000?validPosition(row.latitude,row.longitude):null;
      const oldAnchor=validPosition(row.anchor_latitude,row.anchor_longitude);
      const anchorAt=parseRollingTime(row.anchor_at);
      const anchor:MotionAnchor|null=oldAnchor&&Number.isFinite(anchorAt)&&anchorAt>=earliest?{...oldAnchor,at:anchorAt}:null;
      const found=inspectRollingMovement(points,{reportedAt:reported,notBefore:earliest,origin,anchor,rechecking});
      const evidence=found.evidence;
      const stored=await env.DB.prepare(`
        INSERT INTO breakdown_rolling_checks(breakdown_id,equipment_id,device_id,scanned_through,ignore_before,anchor_at,anchor_latitude,anchor_longitude,candidate_at,evidence_at,distance_miles,max_speed_mph,duration_minutes,state)
        SELECT b.id,b.equipment_id,?,?,?,?,?,?,?,?,?,?,?,?
        FROM roadside_breakdowns b WHERE b.id=? AND b.equipment_id=? AND b.stage<5 AND b.rolling_at IS NULL AND b.status<>'not_breakdown'
          AND EXISTS(SELECT 1 FROM equipment_geotab_devices d WHERE d.equipment_id=b.equipment_id AND d.geotab_device_id=? AND d.current=1)
        ON CONFLICT(breakdown_id) DO UPDATE SET
          scanned_through=excluded.scanned_through,anchor_at=excluded.anchor_at,anchor_latitude=excluded.anchor_latitude,anchor_longitude=excluded.anchor_longitude,
          candidate_at=excluded.candidate_at,evidence_at=excluded.evidence_at,distance_miles=excluded.distance_miles,max_speed_mph=excluded.max_speed_mph,duration_minutes=excluded.duration_minutes,state=excluded.state,updated_at=CURRENT_TIMESTAMP
        WHERE breakdown_rolling_checks.state='watching' AND breakdown_rolling_checks.equipment_id=excluded.equipment_id AND breakdown_rolling_checks.device_id=excluded.device_id
          AND COALESCE(breakdown_rolling_checks.ignore_before,'')=COALESCE(excluded.ignore_before,'')
          AND julianday(breakdown_rolling_checks.scanned_through)<=julianday(excluded.scanned_through)
      `).bind(row.device_id,iso(to),row.ignore_before,found.anchor?iso(found.anchor.at):null,found.anchor?.lat??null,found.anchor?.lon??null,
        evidence?iso(evidence.startedAt):null,evidence?iso(evidence.observedAt):null,evidence?.distanceMiles??null,evidence?.maxSpeedMph??null,evidence?.durationMinutes??null,evidence?'pending':'watching',
        row.id,row.equipment_id,row.device_id).run();
      checked++;
      if(evidence&&Number(stored.meta.changes??0)===1){
        flagged++;
        try{await notifyPotentialRolling(env.DB,row.id,evidence);}catch(error){errors++;console.warn(JSON.stringify({event:'breakdown_potential_rolling_email_failed',breakdownId:row.id,error:String(error)}));}
      }
    }catch(error){errors++;console.warn(JSON.stringify({event:'breakdown_rolling_check_failed',breakdownId:row.id,error:String(error)}));}
  }
  return {checked,flagged,errors};
}


/** Claim once for the lifetime of the breakdown, even if evidence is rejected later.
 * The existing notification sender logs individual delivery failures. */
async function notifyPotentialRolling(db:D1Database,id:number,evidence:NonNullable<ReturnType<typeof inspectRollingMovement>['evidence']>){
  const row=await db.prepare(`
    SELECT b.driver_name,e.unit,e.equipment_type
    FROM roadside_breakdowns b JOIN equipment e ON e.id=b.equipment_id
    WHERE b.id=? AND b.stage<5 AND b.rolling_at IS NULL AND b.status<>'not_breakdown'
      AND b.potential_rolling_email_claimed_at IS NULL
  `).bind(id).first<{driver_name:string;unit:string;equipment_type:string}>();
  if(!row)return;
  const claim=await db.prepare(`
    UPDATE roadside_breakdowns SET potential_rolling_email_claimed_at=CURRENT_TIMESTAMP
    WHERE id=? AND stage<5 AND rolling_at IS NULL AND status<>'not_breakdown'
      AND potential_rolling_email_claimed_at IS NULL
      AND EXISTS(SELECT 1 FROM breakdown_rolling_checks c WHERE c.breakdown_id=roadside_breakdowns.id AND c.equipment_id=roadside_breakdowns.equipment_id AND c.state='pending' AND c.candidate_at=?)
  `).bind(id,iso(evidence.startedAt)).run();
  if(Number(claim.meta.changes??0)!==1)return;
  const escape=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',dateStyle:'medium',timeStyle:'short'}).format(new Date(evidence.startedAt));
  const html=[
    '<strong>POTENTIALLY ROLLING — GEOTAB DETECTED MOVEMENT</strong>',
    '<strong>Driver:</strong> '+escape(row.driver_name),
    '<strong>'+(row.equipment_type==='trailer'?'Trailer':'Truck')+':</strong> '+escape(row.unit),
    '<strong>Breakdown #:</strong> '+id,
    '<strong>Estimated rolling time (Eastern):</strong> '+escape(time),
    '<strong>Movement:</strong> '+evidence.distanceMiles.toFixed(1)+' miles; peak '+Math.round(evidence.maxSpeedMph)+' mph; '+Math.round(evidence.durationMinutes)+' minutes',
    '<strong>Action required:</strong> Open Breakdowns and review the Geotab rolling evidence. The driver has not confirmed rolling; the breakdown remains open.',
  ].join('<br>');
  await notifyBreakdownEmailGroup(id,'Breakdown Alerts','Breakdown - '+row.driver_name,html);
}

export async function getRollingReview(db:D1Database,breakdownId:number){
  return db.prepare(`
    SELECT c.candidate_at AS candidateAt,c.evidence_at AS evidenceAt,c.distance_miles AS distanceMiles,c.max_speed_mph AS maxSpeedMph,c.duration_minutes AS durationMinutes,c.device_id AS deviceId
    FROM breakdown_rolling_checks c JOIN roadside_breakdowns b ON b.id=c.breakdown_id AND b.equipment_id=c.equipment_id
    WHERE b.id=? AND b.stage<5 AND b.rolling_at IS NULL AND c.state='pending'
      AND EXISTS(SELECT 1 FROM equipment_geotab_devices d WHERE d.equipment_id=b.equipment_id AND d.geotab_device_id=c.device_id AND d.current=1 AND julianday(d.assigned_at)<=julianday(b.created_at))
      AND (SELECT COUNT(*) FROM equipment_geotab_devices x WHERE x.equipment_id=b.equipment_id AND x.current=1)=1
      AND (SELECT COUNT(*) FROM equipment_geotab_devices x WHERE x.geotab_device_id=c.device_id AND x.current=1)=1
  `).bind(breakdownId).first<{candidateAt:string;evidenceAt:string;distanceMiles:number;maxSpeedMph:number;durationMinutes:number;deviceId:string}>();
}
