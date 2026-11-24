import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function load(path,modules={}){
  const compiled=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  const exports={};
  new Function('exports','require',compiled.outputText)(exports,name=>{if(!(name in modules))throw new Error('Unexpected dependency '+name);return modules[name];});
  return exports;
}
const motion=load('lib/breakdown-rolling-motion.ts');
const start=Math.floor((Date.now()-60*60_000)/1000)*1000;
const iso=ms=>new Date(ms).toISOString();
const point=(minute,lat,mph)=>({at:start+minute*60_000,lat,lon:-84,mph});
const points=[point(0,43,0),point(1,43.001,40),point(6,43.06,50),point(11,43.1,45)];
const options={reportedAt:start,notBefore:start-10*60_000,origin:{lat:43,lon:-84},anchor:null,rechecking:false};

test('rolling evidence requires actual stopped location, five miles, road speed and ten minutes of movement',()=>{
  const {evidence}=motion.inspectRollingMovement(points,options);
  assert.equal(evidence.startedAt,start+60_000);
  assert.equal(evidence.durationMinutes,10);
  assert.ok(evidence.distanceMiles>=5);
  assert.equal(evidence.maxSpeedMph,50);
  assert.equal(motion.inspectRollingMovement(points.slice(1),options).evidence,null,'no stopped baseline');
  assert.equal(motion.inspectRollingMovement(points.slice(0,3),options).evidence,null,'too short');
  assert.equal(motion.inspectRollingMovement(points.map(p=>({...p,lat:43+(p.lat-43)*0.1})),options).evidence,null,'too little distance');
  assert.equal(motion.inspectRollingMovement(points.map(p=>({...p,mph:Math.min(p.mph,25)})),options).evidence,null,'speed threshold');
  assert.equal(motion.inspectRollingMovement([points[0],points[1],point(20,43.1,50)],options).evidence,null,'sparse telemetry does not prove sustained motion');
  assert.equal(motion.inspectRollingMovement(points,{...options,origin:{lat:40,lon:-84}}).evidence,null,'wrong stopped location');
});

function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE equipment(id INTEGER PRIMARY KEY,active INTEGER,archived_at TEXT);
    CREATE TABLE equipment_geotab_devices(id INTEGER PRIMARY KEY,equipment_id INTEGER,geotab_device_id TEXT,assigned_at TEXT,current INTEGER);
    CREATE TABLE roadside_breakdowns(id INTEGER PRIMARY KEY,equipment_id INTEGER,repair_id INTEGER,created_at TEXT,latitude REAL,longitude REAL,gps_observed_at TEXT,snapshot_source TEXT,stage INTEGER,status TEXT,rolling_at TEXT,ready_for_review_at TEXT,updated_at TEXT,driver_status TEXT,tech_arrived_at TEXT,repair_finished_at TEXT);
    CREATE TABLE repair_job_events(id INTEGER PRIMARY KEY,repair_id INTEGER,user_id INTEGER,technician_id INTEGER,action TEXT,detail TEXT);
    INSERT INTO equipment VALUES(1,1,NULL),(2,1,NULL);
  `);
  sqlite.exec(read('migrations/0174_breakdown_geotab_rolling_review.sql'));
  sqlite.prepare('INSERT INTO equipment_geotab_devices VALUES(1,1,?,?,1)').run('direct-trailer',iso(start-86400000));
  sqlite.prepare('INSERT INTO roadside_breakdowns(id,equipment_id,repair_id,created_at,latitude,longitude,gps_observed_at,snapshot_source,stage,status,driver_status) VALUES(1,1,101,?,43,-84,?,\'geotab\',3,\'en_route\',\'waiting\')').run(iso(start),iso(start));
  function prepare(sql){
    function statement(args=[]){
      const q=()=>sqlite.prepare(sql);
      return {bind:(...values)=>statement(values),run:async()=>{const result=q().run(...args);return {success:true,meta:{changes:Number(result.changes)}}},all:async()=>({results:q().all(...args)}),first:async()=>q().get(...args)??null};
    }
    return statement();
  }
  const db={prepare,batch:async statements=>{sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  return {sqlite,db};
}
function fixture(){
  const {sqlite,db}=database();
  const calls=[];
  const logs=points.map((p,i)=>({id:'log-'+i,device:{id:'direct-trailer'},dateTime:iso(p.at),latitude:p.lat,longitude:p.lon,speed:p.mph*1.609344}));
  // The related tractor may travel, but it must not be used as the affected trailer's evidence.
  const otherLogs=logs.map(p=>({...p,device:{id:'tractor'}}));
  const geotab={createGeotabClient:async()=>({call:async(method,params)=>{calls.push(params);return [...otherLogs,...logs]}}),geotabArray:value=>Array.isArray(value)?value:[],geotabGet:(obj,...keys)=>keys.map(k=>obj?.[k]).find(v=>v!==undefined),geotabObjectId:value=>value?.id??'',geotabText:value=>String(value??'')};
  const lib=load('lib/breakdown-rolling-review.ts',{'./geotab-client':geotab,'./breakdown-rolling-motion':motion});
  let role='manager';
  const env={DB:db};
  const route=load('app/api/breakdowns/rolling-review/route.ts',{'cloudflare:workers':{env},'@/lib/auth':{getSessionUser:async()=>({id:99,role})},'@/lib/breakdown-rolling-review':lib,'@/lib/breakdown-rolling-motion':motion});
  const patch=body=>route.PATCH(new Request('https://example.test/api/breakdowns/rolling-review',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
  return {sqlite,db,calls,lib,env,patch,setRole:r=>{role=r}};
}

test('scheduled GPS scan flags only the affected equipment and does not alter breakdown or closeout before manager confirmation',async()=>{
  const f=fixture();
  try{
    const result=await f.lib.checkBreakdownRolling(f.env);
    assert.deepEqual(result,{checked:1,flagged:1,errors:0});
    assert.equal(f.calls[0].search.deviceSearch.id,'direct-trailer');
    const review=await f.lib.getRollingReview(f.db,1);
    assert.equal(review.candidateAt,iso(start+60_000));
    assert.equal(f.sqlite.prepare('SELECT rolling_at FROM roadside_breakdowns WHERE id=1').get().rolling_at,null);
    assert.equal((await f.lib.checkBreakdownRolling(f.env)).flagged,0,'pending review is not duplicated');
    f.setRole('driver');
    assert.equal((await f.patch({breakdownId:1,action:'confirm',candidateAt:review.candidateAt})).status,403);
    f.setRole('manager');
    const response=await f.patch({breakdownId:1,action:'confirm',candidateAt:review.candidateAt});
    assert.equal(response.status,200,await response.clone().text());
    const row=f.sqlite.prepare('SELECT * FROM roadside_breakdowns WHERE id=1').get();
    assert.equal(row.stage,4);
    assert.equal(row.status,'ready_for_review');
    assert.equal(row.rolling_confirmation_source,'office_geotab');
    assert.equal(motion.parseRollingTime(row.rolling_at),start+60_000);
    assert.equal(row.driver_status,'waiting');
    assert.equal(row.tech_arrived_at,null);
    assert.equal(row.repair_finished_at,null);
    assert.equal((await f.lib.getRollingReview(f.db,1)),null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM repair_job_events').get().n,1);
    assert.equal((await f.patch({breakdownId:1,action:'confirm',candidateAt:review.candidateAt})).status,400);
  }finally{f.sqlite.close()}
});

test('rejecting a tow keeps breakdown open and prevents the same travel from immediately returning',async()=>{
  const f=fixture();
  try{
    await f.lib.checkBreakdownRolling(f.env);
    const review=await f.lib.getRollingReview(f.db,1);
    const response=await f.patch({breakdownId:1,action:'reject',candidateAt:review.candidateAt,reason:'Tow to service facility'});
    assert.equal(response.status,200,await response.clone().text());
    assert.equal(await f.lib.getRollingReview(f.db,1),null);
    assert.equal(f.sqlite.prepare('SELECT rolling_at FROM roadside_breakdowns WHERE id=1').get().rolling_at,null);
    assert.equal(f.sqlite.prepare('SELECT stage FROM roadside_breakdowns WHERE id=1').get().stage,3);
    assert.equal((await f.lib.checkBreakdownRolling(f.env)).flagged,0);
    assert.equal(f.sqlite.prepare('SELECT action FROM repair_job_events').get().action,'breakdown_rolling_rejected');
  }finally{f.sqlite.close()}
});

test('unit correction resets movement evidence and manual Rolling requires a verified time and reason',async()=>{
  const f=fixture();
  try{
    await f.lib.checkBreakdownRolling(f.env);
    f.sqlite.exec('UPDATE roadside_breakdowns SET equipment_id=2 WHERE id=1');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM breakdown_rolling_checks').get().n,0);
    assert.equal((await f.patch({breakdownId:1,action:'manual',rollingAt:iso(start+1000)})).status,400);
    assert.equal((await f.patch({breakdownId:1,action:'manual',rollingAt:iso(start-1000),reason:'Office verified'})).status,400);
    const response=await f.patch({breakdownId:1,action:'manual',rollingAt:iso(start+1000),reason:'Office verified'});
    assert.equal(response.status,200,await response.clone().text());
    assert.equal(f.sqlite.prepare('SELECT rolling_confirmation_source FROM roadside_breakdowns WHERE id=1').get().rolling_confirmation_source,'office_manual');
  }finally{f.sqlite.close()}
});

test('scheduler, active queue, Section 4 and reports are wired without financial auto-close',()=>{
  assert.match(read('wrangler.template.jsonc'),/\*\/30 \* \* \* \*/);
  assert.match(read('worker/index.ts'),/checkBreakdownRolling\(env, controller\.scheduledTime\)/);
  assert.match(read('app/breakdowns/page.tsx'),/Geotab Rolling Review/);
  assert.match(read('app/breakdowns/driver-receipt-review.tsx'),/RollingReviewPanel/);
  assert.match(read('app/breakdowns/rolling-review-panel.tsx'),/Still Broken Down \/ Towed/);
  assert.match(read('app/api/breakdowns/receipts/route.ts'),/Review the detected Geotab travel before closing/);
  assert.doesNotMatch(read('lib/breakdown-reports.ts'),/COALESCE\(b\.rolling_at,r\.completed_at\)/);
  assert.doesNotMatch(read('app/api/breakdowns/rolling-review/route.ts'),/outside_cost|UPDATE repairs|stage=5/);
});
