import { generateKeyPairSync, randomBytes, scryptSync, createCipheriv } from 'node:crypto';
import { existsSync } from 'node:fs';
const purpose = 'norlow-maintenance-sheet-20261104';
const token = (process.env.CLOUDFLARE_API_TOKEN || '').replace(/\s/g,'').replace(/^CLOUDFLARE_API_TOKEN=/,'').replace(/^Bearer/,'').replace(/^"|"$/g,'');
if (!token) throw new Error('Cloudflare authorization is missing.');
async function cf(path, body) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + path, {method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});
  const j=await r.json();
  if (!r.ok || !j.success) throw new Error('Cloudflare operation failed; HTTP '+r.status+'; codes '+(j.errors||[]).map(x=>x.code).join(','));
  return j.result;
}
let account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
if (!account) { const a=await cf('/accounts'); if(a.length!==1)throw new Error('Set the explicit Cloudflare account variable.'); account=a[0].id; }
const dbs=await cf('/accounts/'+account+'/d1/database?name=norlow-repair-production&per_page=100');
const dbsMatched=dbs.filter(x=>x.name==='norlow-repair-production');
if(dbsMatched.length!==1)throw new Error('Production database identity is ambiguous.');
const db=dbsMatched[0].uuid||dbsMatched[0].id;
async function query(sql) {const out=await cf('/accounts/'+account+'/d1/database/'+db+'/query',{sql}); if(out.some(x=>x.success===false))throw new Error('Database query failed.');return out;}
if (existsSync('scripts/maintenance-sheet-oneoff/sealed.json')) throw new Error('Import engine not yet installed; no writes were attempted.');
const schema=await query("SELECT type,name,sql FROM sqlite_master WHERE name IN ('equipment','pm_status','maintenance_events','equipment_pm_settings','pm_profiles','equipment_annual_settings','fleet_truck_sales') OR (type IN ('trigger','index') AND tbl_name IN ('maintenance_events','pm_status')) ORDER BY type,name;");
console.log('MAINTENANCE_SCHEMA_BEGIN'); console.log(JSON.stringify(schema));console.log('MAINTENANCE_SCHEMA_END');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(token,salt,32);
const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(purpose));
const ciphertext=Buffer.concat([cipher.update(privateKey,'utf8'),cipher.final()]);
const keyPackage={purpose,createdAt:new Date().toISOString(),publicKey,wrappedPrivateKey:{salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}};
console.log('MAINTENANCE_KEY_BEGIN');console.log(JSON.stringify(keyPackage));console.log('MAINTENANCE_KEY_END');
console.log('Read-only preparation complete. No equipment or maintenance records were changed.');
