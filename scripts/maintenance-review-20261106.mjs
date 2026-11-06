import {randomBytes, publicEncrypt, privateDecrypt, createCipheriv, createDecipheriv, scryptSync, createHash} from 'node:crypto';
import {writeFileSync, readFileSync} from 'node:fs';
import {gzipSync, brotliDecompressSync} from 'node:zlib';
const purpose='norlow-maintenance-review-20261106';
const expectedHash='1ea3b5fe9d47e6e9dbfa7c19e4f91b017c91bd6554ed17a1223fb77b7872a61c';
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
const report={batch:'maintenance-review-2026-11-06',state:'preparing',phases:[],completedOperations:[]};
const bytes=x=>Buffer.from(x,'base64');
const hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>x==null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
function assert(ok,message){if(!ok)throw new Error(message);}
function seal(data){const key=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(data)))),c.final()]);writeFileSync('encrypted-report.json',JSON.stringify({version:1,key:publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));}
const token=(process.env.CLOUDFLARE_API_TOKEN||'').replace(/\s/g,'').replace(/^CLOUDFLARE_API_TOKEN=/,'').replace(/^Bearer/,'').replace(/^"|"$/g,'');
async function cf(path,body){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const j=await r.json();if(!r.ok||!j.success||(Array.isArray(j.result)&&j.result.some(x=>x.success===false)))throw new Error('Cloudflare request rejected '+JSON.stringify(j.errors||j.result));return j.result;}
try{
 assert(token,'Authorization missing');
 const envelope=JSON.parse(readFileSync('scripts/maintenance-review-20261106/payload.json','utf8'));
 assert(envelope.purpose===purpose,'Wrong encrypted purpose');
 // Immutable earlier key package. Only its public key and wrapped private key are public.
 // The Cloudflare token is never sent to GitHub or printed; it remains in Actions secrets.
 const r=await fetch('https://raw.githubusercontent.com/kyung83/Repair-List-Dashoad/b5097cd14f13fb58e7e2adf96d626ba0d68ffb68/scripts/maintenance-sheet-oneoff/sealed.json',{signal:AbortSignal.timeout(30000)});
 assert(r.ok,'Key package unavailable');const kp=(await r.json()).keyPackage;
 assert(kp.purpose==='norlow-maintenance-sheet-20261104'&&hash(kp.publicKey)==='f9448d44e375db0ece0f19841f2246c24fdd7a933c91f6d2c7fcaa48b2783a09','Wrong wrapping key package');
 const w=kp.wrappedPrivateKey,d=createDecipheriv('aes-256-gcm',scryptSync(token,bytes(w.salt),32),bytes(w.iv));d.setAAD(Buffer.from(kp.purpose));d.setAuthTag(bytes(w.tag));const privateKey=Buffer.concat([d.update(bytes(w.ciphertext)),d.final()]);
 const key=privateDecrypt({key:privateKey,oaepHash:'sha256'},bytes(envelope.key));const c=createDecipheriv('aes-256-gcm',key,bytes(envelope.iv));c.setAAD(Buffer.from(purpose));c.setAuthTag(bytes(envelope.tag));const approval=JSON.parse(brotliDecompressSync(Buffer.concat([c.update(bytes(envelope.ciphertext)),c.final()])).toString());privateKey.fill(0);key.fill(0);
 assert(approval.purpose===purpose&&approval.mode==='apply'&&Date.parse(approval.expiresAt)>Date.now(),'Approval expired or incorrect');
 const plan=approval.manifest;assert(hash(JSON.stringify(plan))==='9631cee34b15be7b7dc2aee8d105be83ffd4cd033c408ec6c5519df9567e9513'&&approval.manifestSha256===expectedHash,'Plan does not match tested approval');
 const phaseOrder=['trailer_annual','truck_annual','trailer_pm','truck_pm'];assert(JSON.stringify(plan.phases.map(x=>x.phase))===JSON.stringify(phaseOrder),'Phase order changed');assert(plan.batch===report.batch&&plan.newEquipment.length===25&&plan.phases.reduce((n,x)=>n+x.operations.length,0)===60,'Unexpected plan scope');report.planSha256=expectedHash;
 let account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();if(!account){const a=await cf('/accounts');assert(a.length===1,'Ambiguous account');account=a[0].id;}
 const ds=(await cf('/accounts/'+account+'/d1/database?name=norlow-repair-production&per_page=100')).filter(x=>x.name==='norlow-repair-production');assert(ds.length===1,'Ambiguous database');const base='/accounts/'+account+'/d1/database/'+(ds[0].uuid||ds[0].id);
 async function query(sql){return (await cf(base+'/query',{sql})).flatMap(x=>x.results||[]);}
 async function snapshot(){return {capturedAt:new Date().toISOString(),equipment:await query('SELECT e.*,ps.id AS status_id,ps.service_date AS status_service_date,ps.annual_date AS status_annual_date,ps.pm_type,ps.last_mileage,ps.status AS pm_status_text FROM equipment e LEFT JOIN pm_status ps ON ps.equipment_id=e.id ORDER BY e.id'),events:await query('SELECT * FROM maintenance_events ORDER BY id'),pmSettings:await query('SELECT * FROM equipment_pm_settings ORDER BY equipment_id'),annualSettings:await query('SELECT * FROM equipment_annual_settings ORDER BY equipment_id'),saleStates:await query('SELECT equipment_id,sale_status,off_road_at,returned_to_road_at,sold_at FROM fleet_truck_sales ORDER BY equipment_id')};}
 report.beforeBookmark=await cf(base+'/time_travel/bookmark');report.before=await snapshot();seal(report);
 await query(plan.bootstrapSql);
 assert((await query('SELECT COUNT(*) AS n FROM maintenance_review_20261106_audit'))[0].n===0,'One-time correction already started; refusing replay');
 const probe='probe-'+randomBytes(8).toString('hex');let rejected=false;
 try{await query(`INSERT INTO maintenance_review_20261106_audit(op_id,phase,unit,before_json,after_json,evidence,guard_ok) VALUES(${quote(probe)},'probe','','{}','{}','atomicity test',1); INSERT INTO maintenance_review_20261106_audit(op_id,phase,unit,before_json,after_json,evidence,guard_ok) VALUES(${quote(probe+'-fail')},'probe','','{}','{}','expected rollback',0);`);}catch(error){rejected=/CHECK constraint failed|guard_ok/i.test(String(error));}
 assert(rejected&&(await query(`SELECT COUNT(*) AS n FROM maintenance_review_20261106_audit WHERE op_id LIKE ${quote(probe+'%')}`))[0].n===0,'Atomic rollback not verified; no equipment writes allowed');report.atomicRollbackVerified=true;
 async function verifyPhase(phase){
  const audits=await query('SELECT * FROM maintenance_review_20261106_audit WHERE phase='+quote(phase.phase)+' ORDER BY op_id');assert(audits.length===phase.operations.length,'Audit count mismatch');
  const units=[...new Set(phase.operations.map(o=>o.unit))];const rows=await query('SELECT e.*,ps.service_date AS status_service_date,ps.annual_date AS status_annual_date,ps.pm_type,ps.last_mileage FROM equipment e LEFT JOIN pm_status ps ON ps.equipment_id=e.id WHERE e.unit IN ('+units.map(quote).join(',')+')');const byUnit=new Map(rows.map(x=>[x.unit,x]));
  for(const audit of audits){const after=JSON.parse(audit.after_json);if(after.event_type){const ev=(await query('SELECT * FROM maintenance_events WHERE id='+Number(after.id)))[0];for(const [k,v]of Object.entries(after))assert(ev?.[k]===v,'Historical correction did not verify');continue;}
   const eq=byUnit.get(audit.unit);assert(eq,'Equipment not found after apply');for(const[k,v]of Object.entries(after)){const field=k==='next_pm'?'pm_type':k;assert(eq[field]===v,'Maintenance field did not verify: '+field);if(k==='annual_date'||k==='service_date')assert(eq['status_'+k]===v,'Status summary not aligned');}
  }
  return {phase:phase.phase,operations:audits.length,state:'verified',verifiedAt:new Date().toISOString()};
 }
 report.state='applying';
 for(const phase of plan.phases){
  console.log(JSON.stringify({phase:phase.phase,state:'starting',operations:phase.operations.length}));
  for(const op of phase.operations){await query(op.sql);report.completedOperations.push(op.opId);}
  const v=await verifyPhase(phase);report.phases.push(v);console.log(JSON.stringify(v));seal(report);
 }
 report.after=await snapshot();
 const afterById=new Map(report.after.equipment.map(x=>[x.id,x]));const afterByUnit=new Map(report.after.equipment.map(x=>[x.unit,x]));
 for(const[unit,fields]of Object.entries(plan.expected)){const eq=afterByUnit.get(unit);assert(eq,'Final equipment missing');for(const[k,v]of Object.entries(fields))assert(eq[k]===v,'Final expected field mismatch');}
 const changedFields=new Map();for(const phase of plan.phases)for(const op of phase.operations){if(op.kind==='archived_history_update'){const a=(await query('SELECT after_json FROM maintenance_review_20261106_audit WHERE op_id='+quote(op.opId)))[0];for(const k of Object.keys(JSON.parse(a.after_json))){if(!changedFields.has(op.unit))changedFields.set(op.unit,new Set());changedFields.get(op.unit).add(k);changedFields.get(op.unit).add('status_'+k);changedFields.get(op.unit).add('status_id');}}else if(op.kind==='existing_pm_correction')changedFields.set(op.unit,new Set(['service_date','status_service_date','last_mileage']));}
 report.backgroundMileageUpdates=[];
 for(const old of report.before.equipment){const now=afterById.get(old.id);assert(now,'Existing equipment was removed');const allowed=changedFields.get(old.unit)||new Set();for(const[k,v]of Object.entries(old)){if(allowed.has(k)||k==='updated_at')continue;if(now[k]!==v){if(['current_mileage','mileage_updated_at'].includes(k)&&old.geotab_device_id&&now.mileage_updated_at!==old.mileage_updated_at){report.backgroundMileageUpdates.push({equipmentId:old.id,field:k});continue;}throw new Error('Unexpected existing-equipment field change: '+k);}}}
 const events=new Map(report.after.events.map(x=>[x.id,x]));for(const old of report.before.events){const now=events.get(old.id);assert(now,'Existing maintenance history was removed');for(const[k,v]of Object.entries(old)){const expected=old.id===502&&['event_date','notes'].includes(k)?plan.correctedEvent[k]:v;assert(now[k]===expected,'Unexpected maintenance history change');}}
 for(const kind of ['pmSettings','annualSettings']){const byId=new Map(report.after[kind].map(x=>[x.id,x]));for(const old of report.before[kind])assert(JSON.stringify(byId.get(old.id))===JSON.stringify(old),'Existing maintenance interval changed');}
 assert(JSON.stringify(report.before.saleStates)===JSON.stringify(report.after.saleStates),'Sale states changed');
 assert(report.after.equipment.length-report.before.equipment.length===25,'New equipment count mismatch');
 for(const n of plan.newEquipment){const e=afterByUnit.get(n.unit);assert(e&&e.vin===n.vin&&e.active===1&&e.archived_at==null&&e.geotab_device_id==null&&e.geotab_trailer_id==null&&e.current_mileage==null,'New unit identity or hardware state mismatch');const ps=report.after.pmSettings.find(x=>x.equipment_id===e.id),ans=report.after.annualSettings.find(x=>x.equipment_id===e.id);for(const k of ['profile_id','mileage_interval','time_interval_days'])assert(ps?.[k]===n.preset[k],'New unit did not inherit approved category settings');assert(ans?.interval_days===n.preset.annual_interval_days,'New annual interval mismatch');}
 report.audits=await query('SELECT * FROM maintenance_review_20261106_audit ORDER BY op_id');
 report.summary={newEquipment:25,auditedOperations:60,historyAdded:report.after.events.filter(x=>x.source===report.batch).length,historicalDatesCorrected:1,existingEquipmentPreserved:report.before.equipment.length,phaseOrder};assert(report.summary.historyAdded===58,'New history count mismatch');report.state='verified';report.verifiedAt=new Date().toISOString();seal(report);console.log(JSON.stringify({state:report.state,...report.summary}));
}catch(error){report.state='failed_or_partial';report.error=String(error);seal(report);console.error('Maintenance review stopped. The encrypted report contains the exact state; no completion claim is made.');process.exitCode=1;}
