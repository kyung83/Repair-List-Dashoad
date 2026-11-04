import { randomBytes, publicEncrypt, createCipheriv } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const reportPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAku+BwJIqesIq0DV03qmC
5+0jLsorjl/ddKGxmh/udi2EQxzTeRkXB1sb+ltUWZz2uoDr1Sw98Z0gcezgT6P3
Puq1pIdub7f2/szwlWwsvwq5GKdvBDoCfqWw3OPGqeLKBdsveeH1tagbYczmjlCs
21DVRKZ8tZob7WnJImBlu6Ikd+crI+dsNZCcrVDCLJrGIv+1fGkG63bUh3lNBLJq
NJR3DjsFUB0Yf9PQAklm4ajSKiGG03JpJbpGfLtu1+e1jjnd1HaXMAf3n6u/RT+n
i1GdNOUFK2+Go10sA50jBWDOFj1/D6TeGfSsrhEuTqZEy8EgWr6H+Y4Bw9Fyvnq1
0emW2b+puk23YwD+vnZkNsJUgLBy0F6HL0Yf8r5JqjX+ZN+gs8YX9qHjvPEtXOPb
o1814elXx1V+P4AGlArPrx7/oBpHZiWgn+BWAHb4uI24EfkiSBRE/pDjt2ZsYRqb
3D63NON1qarTPebljG9kFQZVf6bR0VYRSruqt/mjRQqNAgMBAAE=
-----END PUBLIC KEY-----`;
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
const matched=dbs.filter(x=>x.name==='norlow-repair-production');
if(matched.length!==1)throw new Error('Production database identity is ambiguous.');
const db=matched[0].uuid||matched[0].id;
async function query(sql) {const out=await cf('/accounts/'+account+'/d1/database/'+db+'/query',{sql}); if(out.some(x=>x.success===false))throw new Error('Database query failed.');return out.flatMap(x=>x.results||[]);}
const equipment=await query(`SELECT e.id,e.unit,e.equipment_type,e.active,e.archived_at,e.merged_into_equipment_id,e.service_date,e.annual_date,e.current_mileage,
 ps.id AS status_id,ps.service_date AS status_service_date,ps.annual_date AS status_annual_date,ps.pm_type,ps.last_mileage,ps.status,
 s.profile_id,p.name AS profile_name,p.sequence_json,s.mileage_interval,s.time_interval_days,sale.sale_status
 FROM equipment e LEFT JOIN pm_status ps ON ps.equipment_id=e.id
 LEFT JOIN equipment_pm_settings s ON s.equipment_id=e.id LEFT JOIN pm_profiles p ON p.id=s.profile_id
 LEFT JOIN fleet_truck_sales sale ON sale.equipment_id=e.id ORDER BY e.id`);
const events=await query("SELECT id,equipment_id,event_type,pm_type,event_date,mileage,source FROM maintenance_events WHERE event_type IN ('annual','pm','service') ORDER BY equipment_id,event_date,id");
const schema=await query("SELECT type,name,sql FROM sqlite_master WHERE name IN ('equipment','pm_status','maintenance_events','equipment_pm_settings','pm_profiles','equipment_annual_settings','fleet_truck_sales') OR (type IN ('trigger','index') AND tbl_name IN ('equipment','maintenance_events','pm_status')) ORDER BY type,name");
const bookmark=await cf('/accounts/'+account+'/d1/database/'+db+'/time_travel/bookmark');
const report={mode:'read_only_snapshot',capturedAt:new Date().toISOString(),bookmark,equipment,events,schema};
const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
const ciphertext=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(report)))),cipher.final()]);
const encrypted={version:1,key:publicEncrypt({key:reportPublicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
writeFileSync('encrypted-report.json',JSON.stringify(encrypted));
console.log(JSON.stringify({mode:'read_only_snapshot',equipmentRows:equipment.length,eventRows:events.length,encryptedReport:true,recordsChanged:0}));
