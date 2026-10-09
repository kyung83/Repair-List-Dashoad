import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const token=(process.env.CLOUDFLARE_API_TOKEN||'').replace(/\s+/g,'').replace(/^CLOUDFLARE_API_TOKEN=/,'').replace(/^Bearer/,'').replace(/^"|"$/g,'');
if(!token) throw Error('Missing existing Cloudflare authorization');
async function api(path,body){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok||!j.success)throw Error('Cloudflare request failed: '+r.status+' '+JSON.stringify(j.errors));return j.result;}
let account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!account){const a=await api('/accounts');if(a.length!==1)throw Error('Ambiguous Cloudflare account');account=a[0].id;}
const dbs=await api(`/accounts/${account}/d1/database?name=norlow-repair-production`);const db=dbs.filter(x=>x.name==='norlow-repair-production');if(db.length!==1)throw Error('Database target is not unique');
const query=async(sql)=>{const r=await api(`/accounts/${account}/d1/database/${db[0].uuid}/query`,{sql});if(r.some(x=>!x.success))throw Error('D1 read failed');return r.flatMap(x=>x.results);};
const report={};
report.schema=await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN ('parts','warehouses','part_warehouse_stock','inventory_operations','inventory_operation_lines','inventory_operation_commits','historical_repairs','historical_repair_lines','data_imports','data_import_unmatched_ros','data_import_skipped_ros')");
report.imports=await query('SELECT * FROM data_imports');
report.history=await query('SELECT ro_number,ro_date,source_status,equipment_id,line_count,total_cost FROM historical_repairs');
report.equipment=await query('SELECT id,unit,active FROM equipment');
report.parts=await query('SELECT * FROM parts');
report.stock=await query('SELECT * FROM part_warehouse_stock');
report.warehouses=await query('SELECT * FROM warehouses');
report.operationalCounts=await query("SELECT (SELECT COUNT(*) FROM repair_parts) repair_parts,(SELECT COUNT(*) FROM inventory_operations) inventory_operations,(SELECT COUNT(*) FROM repair_part_requests WHERE status='open') open_part_requests");
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),wrap=crypto.scryptSync(token,salt,32);const cipher=crypto.createCipheriv('aes-256-gcm',wrap,iv);const ct=Buffer.concat([cipher.update(privateKey),cipher.final()]);
fs.mkdirSync('maintenance-output',{recursive:true});fs.writeFileSync('maintenance-output/import-private.enc.json',JSON.stringify({salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ct.toString('base64')}));
report.importPublicKey=publicKey;
const key=crypto.randomBytes(32),nonce=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,nonce);const data=Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(report)))),c.final()]);
const output={key:crypto.publicEncrypt({key:fs.readFileSync('maintenance/report-public.pem'),oaepHash:'sha256'},key).toString('base64'),iv:nonce.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')};
fs.writeFileSync('maintenance-output/preflight.enc.json',JSON.stringify(output));
console.log('ENCRYPTED_PREFLIGHT_BEGIN');console.log(JSON.stringify(output));console.log('ENCRYPTED_PREFLIGHT_END');
