import { env } from 'cloudflare:workers';
import encrypted from '@/data/private-masterlist-import.rsa.json';
import { secureTokenEqual } from '@/lib/auth';

const KEY_ROW='truck-masterlist-rsa-key-v3';
const IMPORT_ROW='truck-masterlist-private-import-v3';
const REPORT_PUBLIC_KEY='MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApBtIo68ADWIkpxInzKOSxs3l6GnfzLVjrZBiP0H1s074b5vzpHRKZLmtpxny+SbthUM4dHGNf2oXadRBEjtZOasHKIIaEgmW2PTz0n4z9EQnmaufV72EvNduKLiXYh4R/7hbUN8eRQhetHejjPFTaKN0rDbn/XOLoCzvfKhwVXiujec2xrF95RheUUFOt3vnBK5EPQeiFV+1HK4IRX5dA8LBZsIRL1fDFI9fP2Uq04eRmj1dha1SeGKtOVwJZWWR6sqhHkwkRZCtGkGaZZfa0P0p+hiHk2LmzYKTUEU+QtpZveGf2b/erkhCNZsGtcR4zWnnetzJn/qv+R5PZ0kdtQIDAQAB';
const encoder=new TextEncoder();

type ImportRow={unit:string;homeDriver:string;homeLocation:string;status:'assigned'|'open'|'spare';truckClass:string;flatbed:boolean;automatic:boolean;notes:string;sourceRow:number;sourceDriver:string};
type Payload={source:string;version:number;rows:ImportRow[]};
type Bundle={publicKey:string;privateKey:string;callToken:string};

function fromBase64(value:string){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function toBase64(bytes:ArrayBuffer|Uint8Array){const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let s='';for(const b of view)s+=String.fromCharCode(b);return btoa(s);}
function baseUnit(value:string){
  const match=value.trim().match(/^0*(\d+)(?:\D|$)/);
  if(!match)return '';
  return String(Number(match[1]));
}
function sameText(a:unknown,b:unknown){return String(a??'')===String(b??'');}

async function bundle():Promise<Bundle>{
  const row=await env.DB.prepare('SELECT version_token FROM sync_state WHERE feed_name=?').bind(KEY_ROW).first<{version_token:string|null}>();
  if(!row?.version_token)throw new Error('Private import key bundle is missing.');
  const parsed=JSON.parse(row.version_token) as Bundle;
  if(!parsed.privateKey||!parsed.callToken)throw new Error('Private import key bundle is incomplete.');
  return parsed;
}
async function authorized(request:Request,b:Bundle){
  const provided=String(request.headers.get('x-masterlist-import-token')??'').trim();
  return Boolean(provided)&&await secureTokenEqual(provided,b.callToken);
}
async function decryptPayload(b:Bundle):Promise<Payload>{
  const privateKey=await crypto.subtle.importKey('pkcs8',fromBase64(b.privateKey),{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
  const rawKey=await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,fromBase64(encrypted.wrappedKey));
  const aesKey=await crypto.subtle.importKey('raw',rawKey,{name:'AES-GCM'},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(encrypted.iv),additionalData:encoder.encode(encrypted.aad)},aesKey,fromBase64(encrypted.ciphertext));
  const stream=new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as Payload;
}
async function encryptReport(report:Record<string,unknown>){
  const publicKey=await crypto.subtle.importKey('spki',fromBase64(REPORT_PUBLIC_KEY),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const aesBytes=crypto.getRandomValues(new Uint8Array(32));
  const aesKey=await crypto.subtle.importKey('raw',aesBytes,{name:'AES-GCM'},false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const aad='northern-masterlist-import-report-v1';
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},aesKey,encoder.encode(JSON.stringify(report)));
  const wrappedKey=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,aesBytes);
  return {alg:'RSA-OAEP-2048-SHA256+AES-256-GCM',wrappedKey:toBase64(wrappedKey),iv:toBase64(iv),aad,ciphertext:toBase64(ciphertext)};
}

export async function GET(request:Request){
  try{
    const b=await bundle();
    if(!await authorized(request,b))return Response.json({error:'Private masterlist import is not authorized.'},{status:403,headers:{'cache-control':'no-store'}});
    const prior=await env.DB.prepare('SELECT last_success_at,last_error FROM sync_state WHERE feed_name=?').bind(IMPORT_ROW).first<{last_success_at:string|null;last_error:string|null}>();
    if(prior?.last_success_at)return Response.json({ok:true,alreadyImported:true},{headers:{'cache-control':'no-store'}});

    const payload=await decryptPayload(b);
    if(payload.version!==1||payload.rows.length!==encrypted.rowCount)throw new Error('Import payload validation failed.');

    const sourceKeys=new Set<string>();
    for(const row of payload.rows){
      const key=baseUnit(row.unit);
      if(!key||sourceKeys.has(key))throw new Error('Import payload contains an invalid or duplicate truck number.');
      sourceKeys.add(key);
    }

    const equipment=await env.DB.prepare(`
      SELECT e.id,e.unit,COALESCE(e.out_of_service,0) AS out_of_service,
             EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=e.id OR s.coverage_equipment_id=e.id)) AS in_swap,
             EXISTS(SELECT 1 FROM equipment_geotab_devices g WHERE g.equipment_id=e.id AND g.current=1) AS geotab_current
      FROM equipment e
      WHERE e.active=1 AND e.merged_into_equipment_id IS NULL
        AND lower(COALESCE(e.equipment_type,'')) IN ('truck','vehicle','glider','switcher')
    `).all<{id:number;unit:string;out_of_service:number;in_swap:number;geotab_current:number}>();
    const buckets=new Map<string,Array<{id:number;unit:string;out_of_service:number;in_swap:number;geotab_current:number}>>();
    for(const eq of equipment.results){
      const key=baseUnit(eq.unit);
      if(!key)continue;
      const list=buckets.get(key)??[];
      list.push(eq);buckets.set(key,list);
    }
    function resolveEquipment(unit:string){
      const list=buckets.get(baseUnit(unit))??[];
      if(list.length===1)return {equipment:list[0],ambiguous:false};
      const linked=list.filter(item=>Boolean(item.geotab_current));
      if(linked.length===1)return {equipment:linked[0],ambiguous:false};
      return {equipment:null,ambiguous:list.length>1};
    }

    const current=await env.DB.prepare('SELECT equipment_id,home_driver,home_location,current_driver,current_location,pool_status,truck_class,flatbed,automatic,scheduler_notes FROM fleet_truck_assignments').all<{
      equipment_id:number;home_driver:string;home_location:string;current_driver:string;current_location:string;pool_status:string;truck_class:string;flatbed:number;automatic:number;scheduler_notes:string
    }>();
    const assignmentById=new Map(current.results.map(row=>[row.equipment_id,row]));

    const unmatched:string[]=[];
    const ambiguous:string[]=[];
    const statements:D1PreparedStatement[]=[];
    let matched=0,changed=0,preservedSwaps=0;
    for(const row of payload.rows){
      const resolved=resolveEquipment(row.unit);
      const eq=resolved.equipment;
      if(!eq){
        (resolved.ambiguous?ambiguous:unmatched).push(row.unit);
        continue;
      }
      matched++;
      const old=assignmentById.get(eq.id);
      const inSwap=Boolean(eq.in_swap);
      if(inSwap)preservedSwaps++;
      const fallbackStatus=eq.out_of_service?'service':row.status;
      const nextCurrentDriver=inSwap?(old?.current_driver??''):(row.status==='assigned'?row.homeDriver:'');
      const nextCurrentLocation=inSwap?(old?.current_location??row.homeLocation):row.homeLocation;
      const nextPool=inSwap?(old?.pool_status??fallbackStatus):fallbackStatus;
      const differs=!old||!sameText(old.home_driver,row.homeDriver)||!sameText(old.home_location,row.homeLocation)||!sameText(old.truck_class,row.truckClass)||Boolean(old.flatbed)!==row.flatbed||Boolean(old.automatic)!==row.automatic||!sameText(old.scheduler_notes,row.notes)||(!inSwap&&(!sameText(old.current_driver,nextCurrentDriver)||!sameText(old.current_location,nextCurrentLocation)||!sameText(old.pool_status,nextPool)));
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

    const report={source:payload.source,totalRows:payload.rows.length,matched,changed,unmatchedCount:unmatched.length,ambiguousCount:ambiguous.length,unmatchedUnits:unmatched,ambiguousUnits:ambiguous,preservedActiveSwaps:preservedSwaps};
    const mode=new URL(request.url).searchParams.get('mode')==='commit'?'commit':'preflight';
    const encryptedReport=await encryptReport(report);
    if(mode==='preflight'){
      return Response.json({ok:true,preflight:true,totalRows:payload.rows.length,matched,changed,unmatchedCount:unmatched.length,ambiguousCount:ambiguous.length,preservedActiveSwaps:preservedSwaps,encryptedReport},{headers:{'cache-control':'no-store'}});
    }
    if(matched<Math.ceil(payload.rows.length*0.9))throw new Error(`Master Truck List match rate is too low to commit safely (${matched}/${payload.rows.length}).`);
    for(let i=0;i<statements.length;i+=40)await env.DB.batch(statements.slice(i,i+40));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sync_state(feed_name,version_token,last_success_at,last_error) VALUES(?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(feed_name) DO UPDATE SET version_token=excluded.version_token,last_success_at=CURRENT_TIMESTAMP,last_error=excluded.last_error`).bind(IMPORT_ROW,`rows:${payload.rows.length};matched:${matched}`,JSON.stringify(report)),
      env.DB.prepare('DELETE FROM sync_state WHERE feed_name=?').bind(KEY_ROW),
    ]);
    return Response.json({ok:true,totalRows:payload.rows.length,matched,changed,unmatchedCount:unmatched.length,ambiguousCount:ambiguous.length,preservedActiveSwaps:preservedSwaps,encryptedReport},{headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:'Private masterlist import failed.'},{status:400,headers:{'cache-control':'no-store'}});
  }
}
