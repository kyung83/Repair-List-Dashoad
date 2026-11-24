import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const modules=new Map();
function load(path){
 if(modules.has(path))return modules.get(path);
 const output=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(output.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length??0,0);
 const result={};modules.set(path,result);
 new Function('exports','require',output.outputText)(result,name=>{assert.match(name,/^\.\/(maintenance-checklists|pm-body-types)$/);return load('lib/'+name.slice(2)+'.ts');});
 return result;
}
const body=load('lib/pm-body-types.ts'),templates=load('lib/maintenance-checklist-templates.ts'),reuse=load('lib/trailer-pm-annual-shared-items.ts');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE app_users(id INTEGER PRIMARY KEY);
 INSERT INTO app_users VALUES(1);
 CREATE TABLE equipment(id INTEGER PRIMARY KEY,equipment_type TEXT,trailer_type TEXT,trailer_subtype TEXT);
 INSERT INTO equipment VALUES(1,'truck',NULL,NULL),(2,'trailer','Conestoga','Step Deck'),(3,'trailer','Dry Van',NULL),(4,'trailer','Flat Bed',NULL),(5,'switcher',NULL,NULL);
 CREATE TABLE maintenance_checklist_runs(id INTEGER PRIMARY KEY,repair_id INTEGER,equipment_id INTEGER,event_type TEXT,status TEXT);
 CREATE TABLE maintenance_checklist_items(id INTEGER PRIMARY KEY,checklist_run_id INTEGER,item_number INTEGER,section TEXT,item_text TEXT,result TEXT);
 INSERT INTO maintenance_checklist_runs VALUES(90,91,2,'pm','in_progress');
 INSERT INTO maintenance_checklist_items VALUES(1,90,1,'Original','Original saved PM question','pass');`);
 sqlite.exec(read('migrations/0138_maintenance_checklist_templates.sql'));
 sqlite.exec(read('migrations/0141_maintenance_checklist_template_assignments.sql'));
 const add=(kind,key,name,version=1)=>{
  const id=Number(sqlite.prepare('INSERT INTO maintenance_checklist_templates(event_type,template_key,name,version,active) VALUES(?,?,?,?,1)').run(kind,key,name,version).lastInsertRowid);
  sqlite.prepare('INSERT INTO maintenance_checklist_template_items(template_id,position,section,item_text) VALUES(?,1,?,?)').run(id,'General',name+' question');
  return id;
 };
 const truckDefault=add('pm','default','Truck PM'),trailerDefault=add('pm','trailer-service','Trailer PM'),annual=add('annual','default','Truck Annual'),trailerAnnual=add('annual','trailer-annual-dot','Trailer Annual');
 add('pm','conestoga-step','Conestoga Step Deck PM');add('pm','dry-van','Dry Van PM');add('pm','box-truck','Box Truck PM');
 sqlite.exec("UPDATE maintenance_checklist_template_assignments SET template_key='trailer-service' WHERE event_type='pm' AND applies_to='trailer';UPDATE maintenance_checklist_template_assignments SET template_key='trailer-annual-dot' WHERE event_type='annual' AND applies_to='trailer';UPDATE maintenance_checklist_runs SET template_id="+trailerDefault+",template_version=1 WHERE id=90");
 sqlite.exec(read('migrations/0177_body_specific_pm_checklists.sql'));
 const prepare=sql=>{
  const statement=sqlite.prepare(sql);
  const bound=args=>({first:async()=>statement.get(...args)??null,all:async()=>({results:statement.all(...args)}),run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})});
  return {...bound([]),bind:(...args)=>bound(args)};
 };
 const db={prepare};
 const equipment=id=>sqlite.prepare('SELECT * FROM equipment WHERE id=?').get(id);
 return{sqlite,db,equipment,truckDefault,trailerDefault,annual,trailerAnnual};
}
test('migration does not rewrite existing PM answers, versions, annual assignments or truck classifications',()=>{
 const f=fixture();try{
  const run=f.sqlite.prepare('SELECT template_id,template_version,pm_body_type_snapshot,status FROM maintenance_checklist_runs WHERE id=90').get();
  assert.equal(run.template_id,f.trailerDefault);assert.equal(run.template_version,1);assert.equal(run.pm_body_type_snapshot,null);assert.equal(run.status,'in_progress');
  assert.equal(f.sqlite.prepare('SELECT item_text,result FROM maintenance_checklist_items WHERE id=1').get().result,'pass');
  assert.equal(f.sqlite.prepare('SELECT item_text FROM maintenance_checklist_items WHERE id=1').get().item_text,'Original saved PM question');
  assert.equal(f.equipment(1).truck_body_type,'');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pm_body_checklist_assignments').get().n,0);
  assert.equal(f.sqlite.prepare("SELECT template_key FROM maintenance_checklist_template_assignments WHERE event_type='annual' AND applies_to='trailer'").get().template_key,'trailer-annual-dot');
 }finally{f.sqlite.close()}
});
test('body-specific PM assignments distinguish the trailer body and subtype, with safe default fallback',async()=>{
 const f=fixture();try{
  await body.assignBodyPMTemplate(f.db,'trailer','Conestoga Step Deck','conestoga-step',1);
  await body.assignBodyPMTemplate(f.db,'trailer','Dry Van','dry-van',1);
  assert.equal(body.equipmentBodyType(f.equipment(2)),'Conestoga Step Deck');
  const selected=await templates.getAssignedChecklistTemplate(f.db,'pm','trailer',f.equipment(2));
  assert.equal(selected.templateKey,'conestoga-step');assert.equal(selected.bodyTypeAssignment,'Conestoga Step Deck');
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'pm','trailer',f.equipment(3))).templateKey,'dry-van');
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'pm','trailer',f.equipment(4))).id,f.trailerDefault);
  await body.clearBodyPMTemplate(f.db,'trailer','Conestoga Step Deck');
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'pm','trailer',f.equipment(2))).id,f.trailerDefault);
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'annual','trailer',f.equipment(3))).id,f.trailerAnnual);
 }finally{f.sqlite.close()}
});
test('truck body type must be explicitly classified; no group or trailer override leaks into truck or other equipment',async()=>{
 const f=fixture();try{
  await assert.rejects(body.assignBodyPMTemplate(f.db,'truck','Box Truck','box-truck',1),/not configured/);
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'pm','truck',f.equipment(1))).id,f.truckDefault);
  f.sqlite.exec("UPDATE equipment SET truck_body_type='Box Truck' WHERE id=1");
  await body.assignBodyPMTemplate(f.db,'truck','box truck','box-truck',1);
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'pm','truck',f.equipment(1))).templateKey,'box-truck');
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'annual','truck',f.equipment(1))).id,f.annual);
  assert.equal((await templates.getAssignedChecklistTemplate(f.db,'pm','truck',{...f.equipment(5),truck_body_type:'Box Truck'})).id,f.truckDefault);
  await assert.rejects(body.assignBodyPMTemplate(f.db,'truck','Box Truck','trailer-annual-dot',1),/active PM/);
  assert.deepEqual((await body.listPMBodyTypes(f.db)).truck,['Box Truck']);
 }finally{f.sqlite.close()}
});
test('body-specific PM answers only carry previously verified exact questions to the original signed-separately Annual',()=>{
 const now=new Date('2026-11-24T19:00:00Z');
 const pm={template_key:'custom-body-pm',template_version:3,event_type:'pm',status:'in_progress',started_at:'2026-11-24 12:00:00',pm_body_type_snapshot:'Flat Bed'};
 const annual={template_key:'trailer-annual-dot',template_version:1,event_type:'annual',status:'in_progress',started_at:'2026-11-24 12:15:00',signed_at:null};
 assert.equal(reuse.canReuseTrailerBodyPmAnnual(pm,annual,now),true);
 assert.equal(reuse.canReuseTrailerBodyPmAnnual({...pm,pm_body_type_snapshot:null},annual,now),false);
 assert.equal(reuse.canReuseTrailerBodyPmAnnual(pm,{...annual,template_version:2},now),false);
 assert.equal(reuse.canReuseTrailerBodyPmAnnual(pm,{...annual,signed_at:'2026-11-24 13:00:00'},now),false);
 assert.equal(reuse.canReuseTrailerBodyPmAnnual({...pm,started_at:'2026-11-20 12:00:00'},annual,now),false);
 const pair=reuse.VERIFIED_TRAILER_PM_ANNUAL_V1[0];
 const answer={item_number:44,item_text:pair.pmText,result:'pass',updated_by_user_id:1,require_photo:0,require_measurement:0,require_notes:0};
 assert.equal(reuse.verifiedTrailerPmAnswer(pm,[answer],pair,1).item_number,44);
 for(const wrong of [{item_text:pair.pmText+' modified'},{result:'fail'},{result:'na'},{updated_by_user_id:2},{require_photo:1},{require_measurement:1},{require_notes:1}])assert.equal(reuse.verifiedTrailerPmAnswer(pm,[{...answer,...wrong}],pair,1),null);
 assert.equal(reuse.verifiedTrailerPmAnswer(pm,[answer,{...answer,item_number:45}],pair,1),null);
});
test('new PM selection snapshots its body override only on first start and keeps the Annual form/shortcut separate',()=>{
 const route=read('app/api/maintenance-checklist/route.ts'),setup=read('app/maintenance-checklists/editor-client.tsx'),api=read('app/api/maintenance-checklist-templates/route.ts'),shortcut=read('app/api/shop/trailer-annual-shortcut/route.ts');
 const existing=route.indexOf('if (existing) return existing;'),selection=route.indexOf('getAssignedChecklistTemplate(env.DB, kind, appliesTo, repair)');
 assert.ok(existing>=0&&selection>existing);assert.match(route,/template.bodyTypeAssignment\?\?null/);
 assert.match(api,/kind!=='pm'/);assert.match(setup,/BODY TYPE<select/);assert.match(setup,/const willCreate=.*!isAssigned\|\|shared/);
 assert.match(shortcut,/verifiedTrailerPmAnswer\(pmRun,pmAnswers.results,pair,user.id\)/);assert.match(shortcut,/signed_by_user_id!==user.id/);
});
