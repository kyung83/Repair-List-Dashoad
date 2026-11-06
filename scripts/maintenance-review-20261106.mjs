import {randomBytes,publicEncrypt,createCipheriv} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const publicKey=`-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA5Gs2DX4wwyiMaUqPUdGJ
NpbWcBco+5UZbsPc/n33ehlu1d0NUlzu0De8qrbvrl/cvxOT2a2GO3V4fb8lU0h5
DOQOGhp6nn0LeD22M0zUBnFYdczqiwSU6EnRnEzYqVem9QTbzxAznuKh0fi3M1PA
peE7rU7YWwzj1+9dOtxFdJEu/Hp6mYLPyYq8Pb+Ns9kzcUrSxiHWheZkIUsvjCJL
7sAgUAmubgoYsRH9pn56w3Cx85vdc0+n3iFpcoBm8MSot0PgkuDgbmoT+c4mgYlK
z/gky7OhjWbO3SaqMWBmM+rg5B+kX/X7Khnt3QcwYYiI8QyAhs3t5xHtb6oEy27k
nDGZV9aA0Yb8GdPaFKatnp9d86Igd3HGCqccAKXWu0IkRky+lTyWx3dgZmCoUMQi
n6zIt60QA5f8jNyiowkz4hGg2XSCNoRjRGWkFhgk1Tt2OilO78xoMru3FaU05CfT
L06iKyFSl20ibMbImWLDU23Fg8lpEK0H9ip1QCsucMXDAgMBAAE=
-----END PUBLIC KEY-----`;
const token=(process.env.CLOUDFLARE_API_TOKEN||'').replace(/\s/g,'').replace(/^CLOUDFLARE_API_TOKEN=/,'').replace(/^Bearer/,'').replace(/^"|"$/g,'');
function seal(data){const key=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(data)))),c.final()]);writeFileSync('encrypted-report.json',JSON.stringify({version:1,key:publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));}
async function cf(path){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(120000)});const j=await r.json();if(!r.ok||!j.success)throw new Error('Cloudflare metadata request rejected');return j.result;}
try{
 if(!token)throw new Error('Cloudflare authorization missing');
 let account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 if(!account){const a=await cf('/accounts');if(a.length!==1)throw new Error('Ambiguous account');account=a[0].id;}
 const rows=await cf('/accounts/'+account+'/d1/database?name=norlow-repair-production&per_page=100');const dbs=rows.filter(x=>x.name==='norlow-repair-production');if(dbs.length!==1)throw new Error('Ambiguous database');
 const base='/accounts/'+account+'/d1/database/'+(dbs[0].uuid||dbs[0].id);
 async function query(sql){if(!/^SELECT\b/i.test(sql.trim()))throw new Error('This audit is read-only');const r=await fetch('https://api.cloudflare.com/client/v4'+base+'/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(120000)});const j=await r.json();if(!r.ok||!j.success||j.result.some(x=>x.success===false))throw new Error('Read-only SQL rejected');return j.result.flatMap(x=>x.results||[]);}
 const equipment=await query(`SELECT e.id,e.unit,e.vin,e.equipment_type,e.category,e.active,e.archived_at,e.archive_reason,e.merged_into_equipment_id,e.service_date,e.annual_date,e.current_mileage,e.model_year,e.make,e.model,e.geotab_device_id,e.geotab_trailer_id,
 ps.id AS status_id,ps.service_date AS status_service_date,ps.annual_date AS status_annual_date,ps.pm_type,ps.last_mileage,ps.status,
 s.profile_id,p.name AS profile_name,p.sequence_json,s.mileage_interval,s.time_interval_days,sale.sale_status
 FROM equipment e LEFT JOIN pm_status ps ON ps.equipment_id=e.id LEFT JOIN equipment_pm_settings s ON s.equipment_id=e.id LEFT JOIN pm_profiles p ON p.id=s.profile_id LEFT JOIN fleet_truck_sales sale ON sale.equipment_id=e.id ORDER BY e.id`);
 const events=await query("SELECT id,equipment_id,event_type,pm_type,event_date,mileage,notes,source FROM maintenance_events ORDER BY equipment_id,event_date,id");
 const schema=await query("SELECT type,name,sql FROM sqlite_master WHERE name IN ('historical_repairs','repairs','maintenance_checklist_runs','equipment','pm_status','maintenance_events','maintenance_sheet_import_runs','maintenance_sheet_import_items') ORDER BY name");
 const repairs=await query("SELECT r.id,r.equipment_id,e.unit,r.title,r.description,r.status,r.opened_at,r.completed_at,r.source FROM repairs r JOIN equipment e ON e.id=r.equipment_id WHERE e.unit LIKE '448(%' OR e.unit LIKE '667(%' OR e.unit LIKE '530(%' OR e.unit LIKE '511(%' OR e.unit LIKE '%TRANSIT%' ORDER BY r.equipment_id,r.id");
 seal({capturedAt:new Date().toISOString(),equipment,events,schema,repairs});console.log(JSON.stringify({state:'read_only_verified',equipmentCount:equipment.length,eventCount:events.length,repairCount:repairs.length,writes:0}));
}catch(error){seal({error:String(error)});console.error('Read-only maintenance audit failed; encrypted report contains details.');process.exitCode=1;}
