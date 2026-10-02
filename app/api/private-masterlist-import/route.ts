import { env } from 'cloudflare:workers';
import encrypted from '@/data/private-masterlist-import.enc.json';

const EXPECTED_TOKEN_HASH='76476420ebb29070d658194ea7526fd6d8568b4cc54d53b182eccad713ae0d2d';
const IMPORT_KEY='truck-masterlist-private-import-v1';
const encoder=new TextEncoder();

type ImportRow={unit:string;homeDriver:string;homeLocation:string;status:'assigned'|'open'|'spare';truckClass:string;flatbed:boolean;automatic:boolean;notes:string;sourceRow:number;sourceDriver:string};
type Payload={source:string;version:number;rows:ImportRow[]};

function bytesFromBase64(value:string){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function canonicalUnit(value:string){return value.trim().toLowerCase().replace(/[\s\-()]/g,'');}
function hex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
async function sha256(value:string){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
async function decrypt(token:string):Promise<Payload>{
  const keyBytes=await sha256(token);
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({
    name:'AES-GCM',
    iv:bytesFromBase64(encrypted.iv),
    additionalData:encoder.encode(encrypted.aad),
  },key,bytesFromBase64(encrypted.ciphertext));
  const stream=new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as Payload;
}
function sameText(a:unknown,b:unknown){return String(a??'')===String(b??'');}

export async function GET(request:Request){
  const url=new URL(request.url);
  const token=url.searchParams.get('key')??'';
  if(token.length<40||hex(await sha256(token))!==EXPECTED_TOKEN_HASH){
    return Response.json({error:'Import key is invalid.'},{status:403,headers:{'cache-control':'no-store'}});
  }
  const existing=await env.DB.prepare('SELECT last_success_at FROM sync_state WHERE feed_name=?').bind(IMPORT_KEY).first<{last_success_at:string|null}>();
  if(existing?.last_success_at)return Response.json({ok:true,alreadyImported:true},{headers:{'cache-control':'no-store'}});

  let payload:Payload;
  try{payload=await decrypt(token);}catch{return Response.json({error:'Encrypted import payload could not be decrypted.'},{status:400,headers:{'cache-control':'no-store'}});}
  if(payload.version!==1||payload.rows.length!==encrypted.rowCount)return Response.json({error:'Import payload validation failed.'},{status:400,headers:{'cache-control':'no-store'}});

  const equipment=await env.DB.prepare(`
    SELECT id,unit,COALESCE(driver,'') AS driver,COALESCE(location,'') AS location,
           COALESCE(out_of_service,0) AS out_of_service,
           EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=e.id OR s.coverage_equipment_id=e.id)) AS in_swap
    FROM equipment e
    WHERE e.active=1 AND e.merged_into_equipment_id IS NULL
      AND lower(COALESCE(e.equipment_type,'')) IN ('truck','vehicle','glider','switcher')
  `).all<{id:number;unit:string;driver:string;location:string;out_of_service:number;in_swap:number}>();
  const byUnit=new Map(equipment.results.map(row=>[canonicalUnit(row.unit),row]));
  const currentAssignments=await env.DB.prepare('SELECT equipment_id,home_driver,home_location,current_driver,current_location,pool_status,truck_class,flatbed,automatic,scheduler_notes FROM fleet_truck_assignments').all<{
    equipment_id:number;home_driver:string;home_location:string;current_driver:string;current_location:string;pool_status:string;truck_class:string;flatbed:number;automatic:number;scheduler_notes:string
  }>();
  const assignmentById=new Map(currentAssignments.results.map(row=>[row.equipment_id,row]));

  const unmatched:string[]=[];
  const statements:D1PreparedStatement[]=[];
  let matched=0,changed=0,preservedSwaps=0;
  for(const row of payload.rows){
    const eq=byUnit.get(canonicalUnit(row.unit));
    if(!eq){unmatched.push(row.unit);continue;}
    matched++;
    const old=assignmentById.get(eq.id);
    const inSwap=Boolean(eq.in_swap);
    if(inSwap)preservedSwaps++;
    const fallbackStatus=eq.out_of_service?'service':row.status;
    const nextCurrentDriver=inSwap?(old?.current_driver??''):(row.status==='assigned'?row.homeDriver:'');
    const nextCurrentLocation=inSwap?(old?.current_location??row.homeLocation):row.homeLocation;
    const nextPool=inSwap?(old?.pool_status??fallbackStatus):fallbackStatus;
    const differs=!old||!sameText(old.home_driver,row.homeDriver)||!sameText(old.home_location,row.homeLocation)||
      !sameText(old.truck_class,row.truckClass)||Boolean(old.flatbed)!==row.flatbed||Boolean(old.automatic)!==row.automatic||
      !sameText(old.scheduler_notes,row.notes)||(!inSwap&&(!sameText(old.current_driver,nextCurrentDriver)||!sameText(old.current_location,nextCurrentLocation)||!sameText(old.pool_status,nextPool)));
    if(differs)changed++;
    statements.push(
      env.DB.prepare(`
        INSERT INTO fleet_truck_assignments(equipment_id,home_driver,home_location,current_driver,current_location,pool_status,truck_class,flatbed,automatic,scheduler_notes,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(equipment_id) DO UPDATE SET
          home_driver=excluded.home_driver,home_location=excluded.home_location,
          current_driver=CASE WHEN EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=excluded.equipment_id OR s.coverage_equipment_id=excluded.equipment_id)) THEN fleet_truck_assignments.current_driver ELSE excluded.current_driver END,
          current_location=CASE WHEN EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=excluded.equipment_id OR s.coverage_equipment_id=excluded.equipment_id)) THEN fleet_truck_assignments.current_location ELSE excluded.current_location END,
          pool_status=CASE WHEN EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=excluded.equipment_id OR s.coverage_equipment_id=excluded.equipment_id)) THEN fleet_truck_assignments.pool_status ELSE excluded.pool_status END,
          truck_class=excluded.truck_class,flatbed=excluded.flatbed,automatic=excluded.automatic,scheduler_notes=excluded.scheduler_notes,updated_at=CURRENT_TIMESTAMP
      `).bind(eq.id,row.homeDriver,row.homeLocation,nextCurrentDriver,nextCurrentLocation,nextPool,row.truckClass,row.flatbed?1:0,row.automatic?1:0,row.notes),
      env.DB.prepare('UPDATE equipment SET driver=?,location=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.homeDriver,row.homeLocation,eq.id)
    );
  }

  for(let i=0;i<statements.length;i+=40)await env.DB.batch(statements.slice(i,i+40));
  await env.DB.prepare(`
    INSERT INTO sync_state(feed_name,version_token,last_success_at,last_error)
    VALUES(?,?,CURRENT_TIMESTAMP,?)
    ON CONFLICT(feed_name) DO UPDATE SET version_token=excluded.version_token,last_success_at=CURRENT_TIMESTAMP,last_error=excluded.last_error
  `).bind(IMPORT_KEY,`rows:${payload.rows.length}`,JSON.stringify({matched,changed,unmatched:unmatched.length,preservedSwaps})).run();

  return Response.json({ok:true,source:payload.source,totalRows:payload.rows.length,matched,changed,unmatchedCount:unmatched.length,unmatchedUnits:unmatched,preservedActiveSwaps:preservedSwaps},{headers:{'cache-control':'no-store'}});
}
