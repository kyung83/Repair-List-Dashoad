#!/usr/bin/env bash
set -euo pipefail

CLOUDFLARE_API_TOKEN="$(printf '%s' "$CLOUDFLARE_API_TOKEN" | tr -d '[:space:]')"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN#CLOUDFLARE_API_TOKEN=}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN#Bearer}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN#\"}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN%\"}"
export CLOUDFLARE_API_TOKEN

ACCOUNT_ARG=()
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  ACCOUNT_ARG=(--account-id "$CLOUDFLARE_ACCOUNT_ID")
fi

list_output="$(npx wrangler d1 list --json "${ACCOUNT_ARG[@]}")"
DB_ID="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); const row=data.find(x=>x.name==="norlow-repair-production"); if(row) process.stdout.write(row.uuid||row.id||row.database_id||"");' <<<"$list_output")"
if [ -z "$DB_ID" ]; then echo "Could not determine production D1 database ID."; exit 1; fi
sed "s/REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID/$DB_ID/g" wrangler.template.jsonc > wrangler.jsonc

key_name="truck-masterlist-rsa-key-v2"
npx wrangler d1 execute norlow-repair-production --remote --config wrangler.jsonc --json \
  --command "SELECT version_token FROM sync_state WHERE feed_name='$key_name' LIMIT 1" > /tmp/key-existing.json

node - <<'NODE'
const fs=require('fs'),crypto=require('crypto');
const raw=JSON.parse(fs.readFileSync('/tmp/key-existing.json','utf8'));
function token(v){
  if(!v||typeof v!=='object')return '';
  if(typeof v.version_token==='string')return v.version_token;
  for(const x of Array.isArray(v)?v:Object.values(v)){const r=token(x);if(r)return r;}
  return '';
}
const saved=token(raw);
if(saved){
  const bundle=JSON.parse(saved);
  if(bundle.publicKey&&bundle.privateKey){
    fs.writeFileSync('/tmp/public-key.txt',bundle.publicKey);
    process.exit(0);
  }
}
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{
  modulusLength:2048,
  publicKeyEncoding:{type:'spki',format:'der'},
  privateKeyEncoding:{type:'pkcs8',format:'der'},
});
const bundle={
  alg:'RSA-OAEP-2048-SHA256',
  publicKey:publicKey.toString('base64'),
  privateKey:privateKey.toString('base64'),
};
const escaped=JSON.stringify(bundle).replace(/'/g,"''");
fs.writeFileSync('/tmp/key.sql',`INSERT INTO sync_state(feed_name,version_token,last_success_at,last_error) VALUES('truck-masterlist-rsa-key-v2','${escaped}',CURRENT_TIMESTAMP,NULL) ON CONFLICT(feed_name) DO UPDATE SET version_token=excluded.version_token,last_success_at=CURRENT_TIMESTAMP,last_error=NULL;`);
fs.writeFileSync('/tmp/public-key.txt',bundle.publicKey);
NODE

if [ -s /tmp/key.sql ]; then
  npx wrangler d1 execute norlow-repair-production --remote --config wrangler.jsonc --file /tmp/key.sql >/tmp/key-write.log
fi

public_key="$(cat /tmp/public-key.txt)"
echo "MASTERLIST_V2_PUBLIC_KEY=$public_key"

if [ ! -f data/private-masterlist-import.v2.rsa.json ]; then
  echo "MASTERLIST_V2_PAYLOAD_PENDING=true"
  exit 0
fi

npx wrangler d1 execute norlow-repair-production --remote --config wrangler.jsonc --json \
  --command "SELECT version_token FROM sync_state WHERE feed_name='$key_name' LIMIT 1" > /tmp/key-bundle.json

npx wrangler d1 execute norlow-repair-production --remote --config wrangler.jsonc --json \
  --command "SELECT e.id,e.unit,lower(trim(COALESCE(e.equipment_type,''))) AS equipment_type,COALESCE(e.out_of_service,0) AS out_of_service,EXISTS(SELECT 1 FROM equipment_geotab_devices a WHERE a.equipment_id=e.id AND a.current=1) AS geotab_current,EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=e.id OR s.coverage_equipment_id=e.id)) AS in_swap FROM equipment e WHERE e.active=1 AND e.merged_into_equipment_id IS NULL AND lower(trim(COALESCE(e.equipment_type,''))) IN ('truck','vehicle','glider','switcher') ORDER BY e.id" > /tmp/equipment.json

npx wrangler d1 execute norlow-repair-production --remote --config wrangler.jsonc --json \
  --command "SELECT equipment_id,home_driver,home_location,current_driver,current_location,pool_status,truck_class,flatbed,automatic,scheduler_notes FROM fleet_truck_assignments" > /tmp/assignments.json

node - <<'NODE'
const fs=require('fs'),crypto=require('crypto'),zlib=require('zlib');

function findVersionToken(v){
  if(!v||typeof v!=='object')return '';
  if(typeof v.version_token==='string')return v.version_token;
  for(const x of Array.isArray(v)?v:Object.values(v)){const r=findVersionToken(x);if(r)return r;}
  return '';
}
function collectRows(v,required){
  const rows=[];
  function walk(x){
    if(Array.isArray(x)){for(const y of x)walk(y);return;}
    if(!x||typeof x!=='object')return;
    if(required.every(k=>Object.prototype.hasOwnProperty.call(x,k)))rows.push(x);
    for(const y of Object.values(x))walk(y);
  }
  walk(v);return rows;
}
const bundle=JSON.parse(findVersionToken(JSON.parse(fs.readFileSync('/tmp/key-bundle.json','utf8'))));
const enc=JSON.parse(fs.readFileSync('data/private-masterlist-import.v2.rsa.json','utf8'));
const privateKey=crypto.createPrivateKey({key:Buffer.from(bundle.privateKey,'base64'),format:'der',type:'pkcs8'});
const aesKey=crypto.privateDecrypt({key:privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(enc.wrappedKey,'base64'));
const decipher=crypto.createDecipheriv('aes-256-gcm',aesKey,Buffer.from(enc.iv,'base64'));
decipher.setAAD(Buffer.from(enc.aad,'utf8'));
decipher.setAuthTag(Buffer.from(enc.tag,'base64'));
const compressed=Buffer.concat([decipher.update(Buffer.from(enc.ciphertext,'base64')),decipher.final()]);
const payload=JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const source=payload.rows;
if(!Array.isArray(source)||source.length!==282)throw new Error('Expected exactly 282 source master rows.');

const equipment=collectRows(JSON.parse(fs.readFileSync('/tmp/equipment.json','utf8')),['id','unit','equipment_type']);
const currentRows=collectRows(JSON.parse(fs.readFileSync('/tmp/assignments.json','utf8')),['equipment_id','home_driver']);
const current=new Map(currentRows.map(r=>[Number(r.equipment_id),r]));

function sourceKey(v){const s=String(v??'').trim();return /^\d{3,4}$/.test(s)?s:'';}
function liveKey(v){
  const s=String(v??'').trim();
  const groups=s.match(/\d{3,4}/g)||[];
  return groups.length===1?groups[0]:'';
}
function strictSuffix(v,key){return new RegExp('^'+key+'\\([A-Za-z]{1,6}[^0-9]*\\)$').test(String(v??'').trim());}
const candidates=new Map();
for(const e of equipment){
  const key=liveKey(e.unit);
  if(!key)continue;
  if(!candidates.has(key))candidates.set(key,[]);
  candidates.get(key).push(e);
}

const matched=[],unmatched=[],ambiguous=[];
for(const row of source){
  const key=sourceKey(row.unit);
  if(!key){unmatched.push(key||'[invalid]');continue;}
  const all=candidates.get(key)||[];
  let pick=null;
  const exact=all.filter(e=>String(e.unit??'').trim()===key);
  const suffix=all.filter(e=>strictSuffix(e.unit,key));
  const currentGeo=all.filter(e=>Number(e.geotab_current)===1);
  if(exact.length===1)pick=exact[0];
  else if(suffix.length===1)pick=suffix[0];
  else if(currentGeo.length===1)pick=currentGeo[0];
  else if(all.length===1)pick=all[0];
  if(pick)matched.push({row,equipment:pick});
  else if(all.length===0)unmatched.push(key);
  else ambiguous.push({key,count:all.length});
}

console.log(`MASTERLIST_V2_DRY_RUN total=${source.length} matched=${matched.length} unmatched=${unmatched.length} ambiguous=${ambiguous.length}`);
if(matched.length!==source.length||unmatched.length||ambiguous.length){
  throw new Error('Corrected matcher did not resolve all 282 trucks uniquely. No D1 writes were generated.');
}

const q=v=>"'"+String(v??'').replace(/'/g,"''")+"'";
const statements=[];
let changed=0,preservedSwaps=0;
for(const m of matched){
  const r=m.row,e=m.equipment,old=current.get(Number(e.id));
  const inSwap=Boolean(Number(e.in_swap));
  if(inSwap)preservedSwaps++;
  const pool=Number(e.out_of_service)===1?'service':r.status;
  const nextDriver=inSwap?(old?.current_driver??''):(r.status==='assigned'?r.homeDriver:'');
  const nextLocation=inSwap?(old?.current_location??r.homeLocation):r.homeLocation;
  const nextPool=inSwap?(old?.pool_status??pool):pool;
  const differs=!old||
    String(old.home_driver??'')!==String(r.homeDriver??'')||
    String(old.home_location??'')!==String(r.homeLocation??'')||
    String(old.truck_class??'')!==String(r.truckClass??'')||
    Boolean(Number(old.flatbed))!==Boolean(r.flatbed)||
    Boolean(Number(old.automatic))!==Boolean(r.automatic)||
    String(old.scheduler_notes??'')!==String(r.notes??'')||
    (!inSwap&&(String(old.current_driver??'')!==nextDriver||String(old.current_location??'')!==nextLocation||String(old.pool_status??'')!==nextPool));
  if(differs)changed++;
  statements.push(`INSERT INTO fleet_truck_assignments(equipment_id,home_driver,home_location,current_driver,current_location,pool_status,truck_class,flatbed,automatic,scheduler_notes,updated_at)
VALUES(${Number(e.id)},${q(r.homeDriver)},${q(r.homeLocation)},${q(nextDriver)},${q(nextLocation)},${q(nextPool)},${q(r.truckClass)},${r.flatbed?1:0},${r.automatic?1:0},${q(r.notes)},CURRENT_TIMESTAMP)
ON CONFLICT(equipment_id) DO UPDATE SET
home_driver=excluded.home_driver,home_location=excluded.home_location,
current_driver=CASE WHEN EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=excluded.equipment_id OR s.coverage_equipment_id=excluded.equipment_id)) THEN fleet_truck_assignments.current_driver ELSE excluded.current_driver END,
current_location=CASE WHEN EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=excluded.equipment_id OR s.coverage_equipment_id=excluded.equipment_id)) THEN fleet_truck_assignments.current_location ELSE excluded.current_location END,
pool_status=CASE WHEN EXISTS(SELECT 1 FROM fleet_coverage_swaps s WHERE s.closed_at IS NULL AND (s.home_equipment_id=excluded.equipment_id OR s.coverage_equipment_id=excluded.equipment_id)) THEN fleet_truck_assignments.pool_status ELSE excluded.pool_status END,
truck_class=excluded.truck_class,flatbed=excluded.flatbed,automatic=excluded.automatic,scheduler_notes=excluded.scheduler_notes,updated_at=CURRENT_TIMESTAMP;`);
  statements.push(`UPDATE equipment SET driver=${q(r.homeDriver)},location=${q(r.homeLocation)},updated_at=CURRENT_TIMESTAMP WHERE id=${Number(e.id)};`);
}
const audit=JSON.stringify({source:'Truck Scheduler 3.0.xlsx / Master Truck List',total:source.length,matched:matched.length,changed,preservedActiveSwaps:preservedSwaps});
statements.push(`INSERT INTO sync_state(feed_name,version_token,last_success_at,last_error) VALUES('truck-masterlist-private-import-v3','rows:282',CURRENT_TIMESTAMP,${q(audit)}) ON CONFLICT(feed_name) DO UPDATE SET version_token=excluded.version_token,last_success_at=CURRENT_TIMESTAMP,last_error=excluded.last_error;`);
statements.push("DELETE FROM sync_state WHERE feed_name='truck-masterlist-rsa-key-v2';");
fs.writeFileSync('/tmp/import.sql',statements.join('\n'));
fs.writeFileSync('/tmp/import-summary.json',JSON.stringify({total:source.length,matched:matched.length,changed,preservedActiveSwaps:preservedSwaps}));
NODE

npx wrangler d1 execute norlow-repair-production --remote --config wrangler.jsonc --file /tmp/import.sql >/tmp/import-write.log

node - <<'NODE'
const fs=require('fs');
const s=JSON.parse(fs.readFileSync('/tmp/import-summary.json','utf8'));
console.log(`MASTERLIST_V2_IMPORT_SUCCESS total=${s.total} matched=${s.matched} changed=${s.changed} preserved_swaps=${s.preservedActiveSwaps}`);
NODE

