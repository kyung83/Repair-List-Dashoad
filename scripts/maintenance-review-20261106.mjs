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
 const presets=await query('SELECT c.*,p.name AS profile_name,p.sequence_json FROM pm_category_presets c LEFT JOIN pm_profiles p ON p.id=c.profile_id');
 const schema=await query("SELECT type,name,sql FROM sqlite_master WHERE (type='table' AND name LIKE 'historical%') OR (tbl_name IN ('equipment','pm_status','maintenance_events','equipment_pm_settings','equipment_annual_settings','pm_profiles') AND type IN ('table','trigger','index')) ORDER BY name");
 const history=await query("SELECT h.id,h.ro_number,h.ro_date,h.equipment_id,e.unit,h.source_status,h.location FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id WHERE e.unit LIKE '448(%' OR e.unit LIKE '667(%' OR e.unit LIKE '530(%' OR e.unit LIKE '511(%' OR e.unit LIKE '%TRANSIT%' ORDER BY h.ro_date DESC");
 const checklists=await query("SELECT c.id,c.equipment_id,e.unit,c.event_type,c.status,c.completed_at,c.mileage_at_completion FROM maintenance_checklist_runs c JOIN equipment e ON e.id=c.equipment_id WHERE e.unit LIKE '448(%' OR e.unit LIKE '667(%' OR e.unit LIKE '530(%' OR e.unit LIKE '511(%' OR e.unit LIKE '%TRANSIT%' ORDER BY c.id");
 const annualSettings=await query('SELECT * FROM equipment_annual_settings');
 seal({capturedAt:new Date().toISOString(),presets,schema,history,checklists,annualSettings});console.log(JSON.stringify({state:'read_only_verified',historyCount:history.length,checklistCount:checklists.length,presets:presets.length,writes:0}));
}catch(error){seal({error:String(error)});console.error('Read-only maintenance audit failed; encrypted report contains details.');process.exitCode=1;}
