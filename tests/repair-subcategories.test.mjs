import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function load(p){
 const result=ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal((result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
 const e={};new Function('exports','require',result.outputText)(e,()=>{throw Error('Unexpected runtime import');});return e;
}
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE repair_types(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE repairs(id INTEGER PRIMARY KEY,repair_type_id INTEGER);INSERT INTO repair_types VALUES(1,'Engine'),(2,'Cooling System');INSERT INTO repairs VALUES(1,1),(2,2),(3,NULL);`);
 db.exec(read('migrations/0175_repair_type_subcategories.sql'));
 db.exec("INSERT INTO repair_type_subcategories(id,repair_type_id,name) VALUES(10,1,'Oil leak'),(11,1,'Sensors'),(20,2,'Radiator')");
 return db;
}
test('migration leaves every existing repair and its required parent intact',()=>{
 const db=fixture();try{assert.deepEqual(db.prepare('SELECT id,repair_type_id,repair_subcategory_id FROM repairs ORDER BY id').all().map(x=>[x.id,x.repair_type_id,x.repair_subcategory_id]),[[1,1,null],[2,2,null],[3,null,null]]);}finally{db.close();}
});
test('subcategories must belong to their parent, may be blank, and clear automatically if the parent changes',()=>{
 const db=fixture();try{
  assert.throws(()=>db.exec('UPDATE repairs SET repair_subcategory_id=20 WHERE id=1'),/must belong/);
  assert.throws(()=>db.exec('INSERT INTO repairs(id,repair_type_id,repair_subcategory_id) VALUES(4,1,20)'),/must belong/);
  assert.throws(()=>db.exec('UPDATE repairs SET repair_subcategory_id=10 WHERE id=3'),/must belong/);
  db.exec('UPDATE repairs SET repair_subcategory_id=10 WHERE id=1');
  db.exec('UPDATE repairs SET repair_type_id=1 WHERE id=1');
  assert.equal(db.prepare('SELECT repair_subcategory_id FROM repairs WHERE id=1').get().repair_subcategory_id,10);
  db.exec('UPDATE repairs SET repair_type_id=2 WHERE id=1');
  assert.equal(db.prepare('SELECT repair_subcategory_id FROM repairs WHERE id=1').get().repair_subcategory_id,null);
  db.exec('UPDATE repairs SET repair_type_id=1,repair_subcategory_id=11 WHERE id=1');
  assert.equal(db.prepare('SELECT repair_subcategory_id FROM repairs WHERE id=1').get().repair_subcategory_id,11);
  db.exec('UPDATE repairs SET repair_subcategory_id=NULL WHERE id=1');
  assert.equal(db.prepare('SELECT repair_subcategory_id FROM repairs WHERE id=1').get().repair_subcategory_id,null);
 }finally{db.close();}
});
test('retiring subcategories preserves history; a parent cannot be moved or duplicate names created',()=>{
 const db=fixture();try{
  db.exec('UPDATE repairs SET repair_subcategory_id=10 WHERE id=1;UPDATE repair_type_subcategories SET active=0 WHERE id=10');
  assert.equal(db.prepare('SELECT repair_subcategory_id FROM repairs WHERE id=1').get().repair_subcategory_id,10);
  assert.throws(()=>db.exec('UPDATE repair_type_subcategories SET repair_type_id=2 WHERE id=10'),/Create a new subcategory/);
  assert.throws(()=>db.exec("INSERT INTO repair_type_subcategories(repair_type_id,name) VALUES(1,'OIL LEAK')"),/UNIQUE/);
  db.exec("INSERT INTO repair_type_subcategories(repair_type_id,name) VALUES(2,'Oil leak')");
  assert.throws(()=>db.exec('DELETE FROM repair_type_subcategories WHERE id=10'),/FOREIGN KEY/);
 }finally{db.close();}
});
test('service only permits active subcategories of the selected parent while retaining old selections',async()=>{
 const sqlite=fixture();
 const db={prepare:sql=>{const statement=sqlite.prepare(sql);return {all:async()=>({results:statement.all()}),bind:(...v)=>({first:async()=>statement.get(...v)??null})};}};
 try{
  const api=load('lib/repair-subcategories.ts');
  assert.equal((await api.requireRepairSubcategory(db,1,10)).name,'Oil leak');
  assert.equal(await api.requireRepairSubcategory(db,1,null),null);
  await assert.rejects(api.requireRepairSubcategory(db,1,20),/not available/);
  sqlite.exec('UPDATE repairs SET repair_subcategory_id=10 WHERE id=1;UPDATE repair_type_subcategories SET active=0 WHERE id=10');
  await assert.rejects(api.requireRepairSubcategory(db,1,10),/not available/);
  assert.equal((await api.repairSubcategoryForRepair(db,1)).active,false);
  assert.equal((await api.listRepairSubcategories(db,true)).some(x=>x.id===10),false);
 }finally{sqlite.close();}
});
test('report comparison keeps parent categories and supports separately grouping subcategories',()=>{
 const model=load('lib/report-center-model.ts');
 const r={id:1,equipmentId:1,unit:'676',date:'2026-11-24',repairType:'ENGINE',repairSubcategory:'Oil leak',repair:'Repair',status:'Completed',totalCost:100,partsCost:60,laborCost:40,outsideCost:0,laborHours:1};
 const rows=model.analysisRows({repairs:[r,{...r,id:2,repairSubcategory:''},{...r,id:3,repairSubcategory:'Sensors'}]},null).repairs;
 assert.equal(model.groups(rows,'category').length,1);
 assert.equal(model.groups(rows,'subcategory').length,3);
 assert.equal(rows[0].fields.repairTypePath,'ENGINE / Oil leak');
 assert.equal(rows[1].fields.repairTypePath,'ENGINE / Not specified');
 assert.equal(model.metric(rows,'totalCost'),300);
});
test('setup, technician selection and reporting preserve the existing required parent and checklist behavior',()=>{
 const setup=read('app/api/repair-types/route.ts'),shop=read('app/api/shop/repair-type/route.ts'),control=read('app/shop/current-repair-type-control.tsx'),helpers=read('lib/repair-types.ts');
 assert.match(setup,/createSubcategory/);assert.match(setup,/updateSubcategory/);assert.match(setup,/if\(!manager\(user\)\)/);
 assert.match(shop,/repairForUser\(request,repairId,true\)/);assert.match(shop,/action==='setSubcategory'/);
 assert.match(shop,/repair_type_id=\?/);assert.match(shop,/This Repair Type cannot be changed after its checklist has been started/);
 assert.match(control,/SUBCATEGORY · OPTIONAL/);assert.match(control,/No subcategory \/ not specified/);
 assert.match(helpers,/Choose the Repair Type before leaving this work/);assert.doesNotMatch(helpers,/repair_subcategory_id/);
 assert.match(read('lib/report-search.ts'),/repairSubcategory: row.repair_subcategory/);
 assert.match(read('lib/report-center-print.ts'),/\['Subcategory',repair.repair_subcategory\]/);
});
