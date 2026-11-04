import { randomBytes, publicEncrypt, privateDecrypt, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
const ROOT='scripts/maintenance-sheet-oneoff/';
const BATCH='maintenance-sheet-2026-11-04';
const PURPOSE='norlow-maintenance-sheet-20261104';
const ORDER=['trailer_annual','truck_annual','trailer_pm','truck_pm'];
const reportPublicKey=readFileSync(ROOT+'report-public.pem','utf8');
function sealReport(data){
 const key=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);
 const bytes=Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(data)))),c.final()]);
 writeFileSync('encrypted-report.json',JSON.stringify({version:1,key:publicEncrypt({key:reportPublicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:bytes.toString('base64')}));
}
const unb64=x=>Buffer.from(x,'base64');
function decrypt(key,envelope,aad){const d=createDecipheriv('aes-256-gcm',key,unb64(envelope.iv));if(aad)d.setAAD(Buffer.from(aad));d.setAuthTag(unb64(envelope.tag));return Buffer.concat([d.update(unb64(envelope.ciphertext)),d.final()]);}
const token=(process.env.CLOUDFLARE_API_TOKEN||'').replace(/\s/g,'').replace(/^CLOUDFLARE_API_TOKEN=/,'').replace(/^Bearer/,'').replace(/^"|"$/g,'');
let report={batch:BATCH,mode:'not_applied',completedPhases:[]};
const tmp=['source.xlsx','before.json','plan.json','compiled.json'];
const qs=v=>"'"+String(v).replaceAll("'","''")+"'";
async function cf(path,body){
 const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});
 const j=await r.json();if(!r.ok||!j.success)throw new Error('Cloudflare request rejected; HTTP '+r.status+' codes '+(j.errors||[]).map(x=>x.code).join(','));return j.result;
}
function py(script,...args){const r=spawnSync('python',[ROOT+script,...args],{encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error('Private import validation failed in '+script);}
try{
 if(!existsSync(ROOT+'sealed.json')){console.log('Import runner installed; awaiting the approved encrypted source. No writes performed.');}
 else {
 if(!token)throw new Error('Cloudflare authorization missing');
 const bundle=JSON.parse(readFileSync(ROOT+'sealed.json','utf8'));
 if(bundle.keyPackage.purpose!==PURPOSE)throw new Error('Wrong import purpose');
 const wrap=bundle.keyPackage.wrappedPrivateKey;
 const pk=decrypt(scryptSync(token,unb64(wrap.salt),32),wrap,PURPOSE).toString('utf8');
 const secret=privateDecrypt({key:pk,oaepHash:'sha256'},unb64(bundle.payload.key));
 const approval=JSON.parse(decrypt(secret,bundle.payload,PURPOSE).toString('utf8'));
 if(approval.batch!==BATCH||approval.mode!=='apply'||Date.now()>Date.parse(approval.expiresAt)||!Number.isFinite(Date.parse(approval.expiresAt)))throw new Error('Approval expired or invalid');
 const url=new URL(approval.sourceUrl);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.oaiusercontent.com')||!url.pathname.startsWith('/files/'))throw new Error('Unexpected source download location');
 const source=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!source.ok)throw new Error('Approved source download expired or unavailable');
 const workbook=Buffer.from(await source.arrayBuffer());if(workbook.length>10000000)throw new Error('Source size exceeds approved maximum');
 writeFileSync('source.xlsx',workbook,{mode:0o600});
 let account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 if(!account){const all=await cf('/accounts');if(all.length!==1)throw new Error('Account identity is ambiguous');account=all[0].id;}
 const dbs=await cf('/accounts/'+account+'/d1/database?name=norlow-repair-production&per_page=100');
 const matched=dbs.filter(x=>x.name==='norlow-repair-production');if(matched.length!==1)throw new Error('Database identity is ambiguous');
 const base='/accounts/'+account+'/d1/database/'+(matched[0].uuid||matched[0].id);
 async function query(sql){const a=await cf(base+'/query',{sql});if(a.some(x=>x.success===false))throw new Error('Database statement rejected');return a.flatMap(x=>x.results||[]);}
 async function snapshot(){
  const equipment=await query(`SELECT e.id,e.unit,e.equipment_type,e.active,e.archived_at,e.merged_into_equipment_id,e.service_date,e.annual_date,e.current_mileage,
 ps.id AS status_id,ps.service_date AS status_service_date,ps.annual_date AS status_annual_date,ps.pm_type,ps.last_mileage,ps.status,
 s.profile_id,p.name AS profile_name,p.sequence_json,s.mileage_interval,s.time_interval_days,sale.sale_status
 FROM equipment e LEFT JOIN pm_status ps ON ps.equipment_id=e.id LEFT JOIN equipment_pm_settings s ON s.equipment_id=e.id LEFT JOIN pm_profiles p ON p.id=s.profile_id LEFT JOIN fleet_truck_sales sale ON sale.equipment_id=e.id ORDER BY e.id`);
  const events=await query("SELECT id,equipment_id,event_type,pm_type,event_date,mileage,source FROM maintenance_events WHERE event_type IN ('annual','pm','service') ORDER BY equipment_id,event_date,id");
  return {capturedAt:new Date().toISOString(),equipment,events};
 }
 const before=await snapshot();report.before=before;report.bookmark=await cf(base+'/time_travel/bookmark');
 writeFileSync('before.json',JSON.stringify(before),{mode:0o600});
 py('plan_import.py','source.xlsx','before.json','plan.json');
 const plan=JSON.parse(readFileSync('plan.json','utf8'));report.plan=plan;
 if(plan.sourceDigest!==approval.sourceDigest||plan.planDigest!==approval.planDigest){report.mode='changed_since_review';throw new Error('Source or production baseline changed; no maintenance writes attempted');}
 py('sql_import.py','plan.json','compiled.json');const compiled=JSON.parse(readFileSync('compiled.json','utf8'));
 if(compiled.phases.map(x=>x.phase).join(',')!==ORDER.join(','))throw new Error('Phase order invalid');
 await query('CREATE TABLE IF NOT EXISTS maintenance_sheet_atomicity_probe (id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));');
 const probe=randomBytes(16).toString('hex');let rejected=false;
 try{await query(`INSERT INTO maintenance_sheet_atomicity_probe VALUES(${qs(probe)},1); INSERT INTO maintenance_sheet_atomicity_probe VALUES(${qs(probe+'-fail')},0);`);}catch{rejected=true;}
 const leftovers=await query(`SELECT COUNT(*) AS n FROM maintenance_sheet_atomicity_probe WHERE id=${qs(probe)};`);
 if(!rejected||Number(leftovers[0].n)!==0)throw new Error('Atomic rollback could not be verified; maintenance import stopped');
 await query(compiled.bootstrapSql);
 const oldRuns=await query(`SELECT * FROM maintenance_sheet_import_runs WHERE batch=${qs(BATCH)};`);
 if(oldRuns.length)throw new Error('Batch already exists; stop instead of repeating a partially completed import');
 await query(`INSERT INTO maintenance_sheet_import_runs(batch,source_sha256,plan_sha256,before_bookmark,state) VALUES(${qs(BATCH)},${qs(plan.sourceDigest)},${qs(plan.planDigest)},${qs(JSON.stringify(report.bookmark))},'running');`);
 report.mode='applying';report.phaseResults=[];const applied=[];
 function verify(snap,ops){
  const latest=new Map();for(const op of ops)latest.set(op.equipmentId,op.after);
  const equipment=new Map(snap.equipment.map(e=>[e.id,e]));let mismatches=0;
  for(const [id,expected] of latest){const row=equipment.get(id);if(!row){mismatches++;continue;}
   for(const [k,v] of Object.entries(expected)){
    const value=k==='event_count'?snap.events.filter(e=>e.equipment_id===id).length:k==='status_exists'?row.status_id!==null:row[k]??null;
    if(value!==v)mismatches++;
   }
  }
  for(const op of ops)for(const event of op.events){
   if(snap.events.filter(x=>x.equipment_id===event.equipment_id&&x.event_type===event.event_type&&x.event_date===event.event_date&&x.source===event.source&&x.pm_type===event.pm_type&&x.mileage===event.mileage).length!==1)mismatches++;
  }
  const byId=new Map(snap.events.map(e=>[e.id,e]));
  for(const e of before.events){const now=byId.get(e.id);if(!now||Object.keys(e).some(k=>e[k]!==now[k]))mismatches++;}
  if(mismatches)throw new Error('Post-write verification differs in '+mismatches+' fields; later phases stopped');
 }
 for(const phase of compiled.phases){
  console.log(JSON.stringify({phase:phase.phase,state:'starting',operations:phase.operations.length}));
  let group=[];let bytes=0;
  const send=async()=>{if(group.length){await query(group.join('\n'));group=[];bytes=0;}};
  for(const op of phase.operations){const n=Buffer.byteLength(op.sql);if(n>90000)throw new Error('Single operation exceeds safe SQL size');if(bytes+n>80000||group.length>=10)await send();group.push(op.sql);bytes+=n;}
  await send();applied.push(...plan.operations.filter(x=>x.phase===phase.phase));
  const after=await snapshot();verify(after,applied);
  const audited=await query(`SELECT COUNT(*) AS n FROM maintenance_sheet_import_items WHERE batch=${qs(BATCH)} AND phase=${qs(phase.phase)} AND guard_ok=1;`);
  if(Number(audited[0].n)!==phase.operations.length)throw new Error('Audit count mismatch');
  report.completedPhases.push(phase.phase);report.after=after;
  const summary=plan.phases.find(x=>x.phase===phase.phase);
  const result={phase:phase.phase,state:'verified',matchedUnits:summary.matchedUnits,updatedUnits:summary.updatedUnits,eventsAdded:summary.eventsAdded,skippedRows:summary.skippedRows};
  report.phaseResults.push(result);
  await query(`UPDATE maintenance_sheet_import_runs SET phases_json=${qs(JSON.stringify(report.completedPhases))} WHERE batch=${qs(BATCH)};`);
  sealReport(report);console.log(JSON.stringify(result));
 }
 await query(`UPDATE maintenance_sheet_import_runs SET state='verified',verified_at=CURRENT_TIMESTAMP WHERE batch=${qs(BATCH)};`);
 report.receipt=await query(`SELECT * FROM maintenance_sheet_import_runs WHERE batch=${qs(BATCH)};`);
 report.mode='verified';report.finishedAt=new Date().toISOString();sealReport(report);
 console.log(JSON.stringify({batch:BATCH,state:'verified',phaseOrder:report.completedPhases,operations:applied.length}));
 }
}catch(error){report.error=String(error);sealReport(report);console.error('Maintenance import stopped. Encrypted verification report contains details. No subsequent phase was attempted.');process.exitCode=1;}
finally{for(const p of tmp)rmSync(p,{force:true});}
