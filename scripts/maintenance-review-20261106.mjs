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
function seal(data){const key=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(data)))),c.final()]);writeFileSync('encrypted-report.json',JSON.stringify({version:1,key:publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));}
const token=(process.env.CLOUDFLARE_API_TOKEN||'').replace(/\s/g,'').replace(/^CLOUDFLARE_API_TOKEN=/,'').replace(/^Bearer/,'').replace(/^"|"$/g,'');
async function cf(path,body){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const j=await r.json();if(!r.ok||!j.success)throw new Error('Read-only request failed');return j.result;}
try{
 if(!token)throw new Error('Cloudflare authorization missing');
 let account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();if(!account){const a=await cf('/accounts');if(a.length!==1)throw new Error('Ambiguous account');account=a[0].id;}
 const ds=(await cf('/accounts/'+account+'/d1/database?name=norlow-repair-production&per_page=100')).filter(x=>x.name==='norlow-repair-production');if(ds.length!==1)throw new Error('Ambiguous database');
 const base='/accounts/'+account+'/d1/database/'+(ds[0].uuid||ds[0].id);
 async function query(sql){if(!/^SELECT\b/i.test(sql.trim()))throw new Error('Read only');const rows=await cf(base+'/query',{sql});if(rows.some(x=>x.success===false))throw new Error('Read-only SQL rejected');return rows.flatMap(x=>x.results||[]);}
 const lines=await query(`SELECT l.id,l.historical_repair_id,l.equipment_id,e.unit,l.ro_number,l.ro_date,l.major_category,l.vmrs_description,l.labor_hours,l.total_cost,h.source_status
 FROM historical_repair_lines l JOIN equipment e ON e.id=l.equipment_id JOIN historical_repairs h ON h.id=l.historical_repair_id
 WHERE (e.unit LIKE '448(%' OR e.unit LIKE '511(%' OR e.unit LIKE '667(%' OR e.unit LIKE '530(%') AND l.ro_date>='2025-01-01' AND (lower(l.vmrs_description) LIKE '%annual%' OR lower(l.vmrs_description) LIKE '%inspect%' OR lower(l.vmrs_description) LIKE '%pm%' OR (e.unit LIKE '511(%' AND l.ro_date='2026-01-03') OR (e.unit LIKE '448(%' AND l.ro_date='2026-04-04')) ORDER BY e.unit,l.ro_date DESC,l.id`);
 seal({capturedAt:new Date().toISOString(),lines});console.log(JSON.stringify({state:'read_only_verified',lineCount:lines.length,writes:0}));
}catch(error){seal({error:String(error)});console.error('Maintenance history review failed. Encrypted report contains details.');process.exitCode=1;}
