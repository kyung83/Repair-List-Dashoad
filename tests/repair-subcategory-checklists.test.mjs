import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const modules=new Map();
function load(path){
 if(modules.has(path))return modules.get(path);
 const output=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(output.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length??0,0);
 const e={};modules.set(path,e);
 new Function('exports','require',output.outputText)(e,name=>{
  assert.match(name,/^\.\/repair-(?:types|checklist-scope|subcategories)$/);
  return load('lib/'+name.slice(2)+'.ts');
 });
 return e;
}
const api=load('lib/repair-checklist-scope.ts'),guards=load('lib/repair-types.ts');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE repairs(id INTEGER PRIMARY KEY,equipment_id INTEGER,status TEXT DEFAULT 'Open',updated_at TEXT);
 CREATE TABLE app_users(id INTEGER PRIMARY KEY);
 CREATE TABLE maintenance_checklist_runs(repair_id INTEGER,event_type TEXT);
 INSERT INTO repairs(id,equipment_id) VALUES(1,101),(2,102),(3,103),(4,104),(5,NULL),(6,106),(7,107),(8,108);
 INSERT INTO app_users VALUES(1);`);
 sqlite.exec(read('migrations/0144_repair_types_and_general_checklists.sql'));
 sqlite.exec(read('migrations/0175_repair_type_subcategories.sql'));
 const parent=sqlite.prepare("SELECT id FROM repair_types WHERE name='NEW EQUIPMENT CHECK'").get().id;
 const other=sqlite.prepare("SELECT id FROM repair_types WHERE name='ENGINE'").get().id;
 const indirect=sqlite.prepare("SELECT id FROM repair_types WHERE name='INDIRECT LABOR-OTHER'").get().id;
 sqlite.prepare('UPDATE repairs SET repair_type_id=?').run(parent);
 sqlite.prepare('UPDATE repairs SET repair_type_id=? WHERE id=5').run(indirect);
 sqlite.prepare('UPDATE repairs SET repair_type_id=? WHERE id=7').run(other);
 sqlite.prepare("INSERT INTO repair_type_subcategories(id,repair_type_id,name) VALUES(10,?,'Truck'),(11,?,'Trailer'),(12,?,'Existing default'),(20,?,'Sensor')").run(parent,parent,parent,other);
 sqlite.exec('UPDATE repairs SET repair_subcategory_id=10 WHERE id IN (1,6);UPDATE repairs SET repair_subcategory_id=11 WHERE id=2;UPDATE repairs SET repair_subcategory_id=12 WHERE id=3;UPDATE repairs SET repair_subcategory_id=20 WHERE id=7;');
 const parentTemplate=sqlite.prepare('SELECT id FROM repair_type_checklist_templates WHERE repair_type_id=? AND active=1').get(parent).id;
 // Simulate inspection started before the new migration, and preserve its answer.
 sqlite.prepare('INSERT INTO repair_type_checklist_runs(id,repair_id,repair_type_id,template_id,template_version) VALUES(1,6,?,?,1)').run(parent,parentTemplate);
 sqlite.exec("INSERT INTO repair_type_checklist_items(checklist_run_id,item_number,section,item_text,result) VALUES(1,1,'Existing','Original recorded answer','pass')");
 sqlite.exec(read('migrations/0176_subcategory_checklists.sql'));
 const db={prepare:sql=>{const st=sqlite.prepare(sql);return {bind:(...args)=>({first:async()=>st.get(...args)??null,all:async()=>({results:st.all(...args)}),run:async()=>({meta:st.run(...args)})})};}};
 function publish(subId,version,name,mode,repairTypeId=parent){
  sqlite.prepare('UPDATE repair_type_checklist_templates SET active=0 WHERE repair_type_id=? AND repair_subcategory_id IS ?').run(repairTypeId,subId);
  const result=sqlite.prepare('INSERT INTO repair_type_checklist_templates(repair_type_id,name,version,active,repair_subcategory_id) VALUES(?,?,?,1,?)').run(repairTypeId,name,version,subId);
  if(subId!==null)sqlite.prepare('UPDATE repair_type_subcategories SET checklist_mode=? WHERE id=?').run(mode,subId);
  return Number(result.lastInsertRowid);
 }
 async function resolve(id){const type=await guards.repairTypeForRepair(db,id);return api.resolveRepairChecklist(db,id,type)}
 return{sqlite,db,parent,other,parentTemplate,publish,resolve};
}
test('migration preserves old checklists, answers, and existing subcategories with inheritance by default',async()=>{
 const f=fixture();try{
  assert.equal(f.sqlite.prepare('SELECT checklist_mode FROM repair_type_subcategories WHERE id=10').get().checklist_mode,'inherit');
  assert.equal((await f.resolve(1)).template.id,f.parentTemplate);
  assert.equal((await f.resolve(3)).source,'parent');
  assert.equal((await f.resolve(6)).source,'started');
  assert.equal(f.sqlite.prepare('SELECT item_text,result FROM repair_type_checklist_items WHERE checklist_run_id=1').get().result,'pass');
  assert.equal(f.sqlite.prepare('SELECT item_text FROM repair_type_checklist_items WHERE checklist_run_id=1').get().item_text,'Original recorded answer');
 }finally{f.sqlite.close()}
});
test('each child can have an independent required or optional checklist while the parent and sibling remain intact',async()=>{
 const f=fixture();try{
  const truck=f.publish(10,2,'Truck checks','required');
  const trailer=f.publish(11,3,'Trailer checks','optional');
  const a=await f.resolve(1),b=await f.resolve(2),c=await f.resolve(3);
  assert.equal(a.template.id,truck);assert.equal(a.mode,'required');
  assert.equal(b.template.id,trailer);assert.equal(b.mode,'optional');
  assert.equal(c.template.id,f.parentTemplate);assert.equal(c.mode,'required');
  assert.equal((await f.resolve(4)).waitingForSubcategory,true);
  assert.equal((await f.resolve(4)).template,null);
  const sensor=f.publish(20,1,'Engine sensor checks','required',f.other);
  assert.equal((await f.resolve(7)).template.id,sensor);
  f.sqlite.exec("UPDATE repair_type_subcategories SET checklist_mode='none' WHERE id=11");
  assert.equal((await f.resolve(2)).mode,'none');
  assert.equal((await f.resolve(2)).template,null);
  f.sqlite.exec("UPDATE repair_type_subcategories SET checklist_mode='inherit' WHERE id=11");
  assert.equal((await f.resolve(2)).template.id,f.parentTemplate);
 }finally{f.sqlite.close()}
});
test('started checklist stays pinned across publication, overrides and retirement; selection cannot be changed',async()=>{
 const f=fixture();try{
  const first=f.publish(10,2,'Truck checks v1','required');
  f.sqlite.prepare('INSERT INTO repair_type_checklist_runs(repair_id,repair_type_id,template_id,template_version) VALUES(1,?,?,2)').run(f.parent,first);
  const latest=f.publish(10,3,'Truck checks v2','required');
  assert.notEqual(first,latest);
  f.sqlite.exec("UPDATE repair_type_subcategories SET checklist_mode='none',active=0 WHERE id=10");
  const pinned=await f.resolve(1);
  assert.equal(pinned.template.id,first);assert.equal(pinned.source,'started');assert.equal(pinned.mode,'required');
  assert.equal((await f.resolve(6)).template.id,f.parentTemplate);
  assert.throws(()=>f.sqlite.exec('UPDATE repairs SET repair_subcategory_id=11 WHERE id=1'),/cannot change after/);
  assert.throws(()=>f.sqlite.exec('UPDATE repair_type_checklist_templates SET repair_subcategory_id=11 WHERE id='+first),/scope cannot change/);
 }finally{f.sqlite.close()}
});
test('server close guard requires the selected child checklist even when parent uses none',async()=>{
 const f=fixture();try{
  const child=f.publish(20,1,'Sensor checks','required',f.other);
  await assert.rejects(guards.validateRepairTypeChecklistBeforeClose(f.db,7),/Complete the ENGINE checklist/);
  f.sqlite.prepare('INSERT INTO repair_type_checklist_runs(id,repair_id,repair_type_id,template_id,template_version) VALUES(2,7,?,?,1)').run(f.other,child);
  f.sqlite.exec("INSERT INTO repair_type_checklist_items(checklist_run_id,item_number,section,item_text,result,require_notes) VALUES(2,1,'Electrical','Check sensor','pending',1)");
  await assert.rejects(guards.validateRepairTypeChecklistBeforeClose(f.db,7),/Finish every/);
  f.sqlite.exec("UPDATE repair_type_checklist_items SET result='pass' WHERE checklist_run_id=2");
  await assert.rejects(guards.validateRepairTypeChecklistBeforeClose(f.db,7),/required checklist notes/);
  f.sqlite.exec("UPDATE repair_type_checklist_items SET notes='Test passed' WHERE checklist_run_id=2");
  await guards.validateRepairTypeChecklistBeforeClose(f.db,7);
  f.sqlite.exec("UPDATE repair_type_subcategories SET checklist_mode='none' WHERE id=20");
  f.sqlite.exec("UPDATE repair_type_checklist_items SET result='fail' WHERE checklist_run_id=2");
  await assert.rejects(guards.validateRepairTypeChecklistBeforeClose(f.db,7),/Correct all failed/);
 }finally{f.sqlite.close()}
});
test('PMs, annuals and indirect labor do not pick up the fleet repair checklists',async()=>{
 const f=fixture();try{
  f.sqlite.exec("INSERT INTO maintenance_checklist_runs VALUES(8,'annual')");
  assert.equal((await f.resolve(8)).mode,'none');
  assert.equal((await f.resolve(5)).mode,'none');
  await guards.validateRepairTypeChecklistBeforeClose(f.db,8);
  await guards.validateRepairTypeChecklistBeforeClose(f.db,5);
 }finally{f.sqlite.close()}
});
test('parent scope and every individual child scope are isolated in publishing and technician UI',()=>{
 const setup=read('app/api/repair-types/route.ts'),panel=read('app/repair-types/subcategory-checklist-settings.tsx'),control=read('app/shop/current-repair-type-control.tsx'),route=read('app/api/repair-type-checklist/route.ts');
 assert.match(setup,/repair_subcategory_id IS \? AND active=1/);
 assert.match(setup,/saveSubcategoryChecklistMode/);
 assert.match(setup,/if\(subId!==null\)return Response.json/);
 assert.match(panel,/PUBLISH SUBCATEGORY CHECKLIST VERSION/);
 assert.match(panel,/Copy main checklist/);
 assert.match(panel,/Require photo/);assert.match(panel,/Measurement/);
 assert.match(route,/r.repair_subcategory_id IS \?/);assert.match(route,/expectedTemplateId/);
 assert.match(control,/disabled=\{busy\|\|data.subcategoryLocked\}/);
 assert.match(route,/repair_type_id,repair_subcategory_id,opened_at/);
});
