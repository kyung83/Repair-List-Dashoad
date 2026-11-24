import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function load(p){
 const result=ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const exports={};new Function('exports','require',result.outputText)(exports,()=>{throw Error('Unexpected runtime dependency');});return exports;
}
const m=load('lib/report-center-model.ts');
const row=(key,fields)=>({key,kind:'breakdown',id:Number(key),fields});
const br=(id,extra={})=>({id,equipmentId:1,unit:'676',category:'Electrical',createdAt:'2026-11-01',status:'complete',totalCost:100,downtimeMinutes:60,...extra});
const repair=(id,extra={})=>({id,equipmentId:1,unit:'676',repairType:'Electrical',date:'2026-11-01',source:'repair-board',status:'Completed',totalCost:100,...extra});

test('comparison metrics distinguish unknown downtime from zero and use only known observations',()=>{
 const rows=[row('1',{equipmentId:1,totalCost:0,downtimeHours:0,arrivalHours:null}),row('2',{equipmentId:1,totalCost:100,downtimeHours:4,arrivalHours:2}),row('3',{equipmentId:2,totalCost:200,downtimeHours:null,arrivalHours:null})];
 assert.equal(m.metric(rows,'count'),3);
 assert.equal(m.metric(rows,'uniqueUnits'),2);
 assert.equal(m.metric(rows,'totalCost'),300);
 assert.equal(m.metric(rows,'averageCost'),100);
 assert.equal(m.metric(rows,'downtimeHours'),4);
 assert.equal(m.metric(rows,'averageDowntime'),2);
 assert.equal(m.metric(rows,'averageArrival'),2);
 assert.equal(m.metric(rows,'unknownDowntime'),1);
 assert.equal(m.metric([rows[2]],'downtimeHours'),null);
 assert.equal(m.metric([rows[2]],'averageDowntime'),null);
 assert.equal(m.metric([],'averageCost'),null);
});

test('unit rollups never add the linked breakdown cost to repair cost twice',()=>{
 const [u]=m.unitRollups([repair(1,{source:'roadside-breakdown',totalCost:100}),repair(2,{totalCost:50})],[br(1),br(2,{status:'not_breakdown',totalCost:900})]);
 assert.equal(u.repairCount,2);
 assert.equal(u.repairCost,150);
 assert.equal(u.roadsideCost,100);
 assert.equal(u.breakdownCount,1);
 assert.equal(u.knownHours,1);
});

test('multidimensional groups retain exact record identities for drill-downs',()=>{
 const rows=[row('1',{unit:'676',category:'Electrical'}),row('2',{unit:'676',category:'Tires'}),row('3',{unit:'676',category:'Electrical'}),row('4',{unit:'431',category:'Electrical'})];
 const groups=m.groups(rows,'unit','category');
 assert.equal(groups.length,3);
 assert.deepEqual(groups.find(g=>g.label==='676 / Electrical').rows.map(r=>r.key),['1','3']);
 assert.equal(m.groups(rows,'__all').length,1);
});

test('repeat patterns exclude linked roadside repairs, cleared calls, uncategorized records and imported ROs',()=>{
 const r=[repair(1),repair(2,{date:'2026-11-05'}),repair(3,{source:'roadside-breakdown'}),repair(-4,{source:'Historical RO import'}),repair(5,{repairType:'Uncategorized'}),repair(6,{date:'2026-10-01'})];
 const b=[br(1),br(2,{createdAt:'2026-11-07'}),br(3,{status:'not_breakdown'})];
 const found=m.repeats(r,b,7);
 assert.equal(found.length,2);
 assert.deepEqual(found.find(x=>x.kind==='Repair').ids,[1,2]);
 assert.deepEqual(found.find(x=>x.kind==='Breakdown').ids,[1,2]);
});

test('historical VMRS grouping counts distinct repair orders and only line costs',()=>{
 const lines=[row('1',{historicalRepairId:1,equipmentId:1,totalCost:30}),row('2',{historicalRepairId:1,equipmentId:1,totalCost:20}),row('3',{historicalRepairId:2,equipmentId:1,totalCost:70})];
 assert.equal(m.metric(lines,'count'),3);
 assert.equal(m.metric(lines,'uniqueROs'),2);
 assert.equal(m.metric(lines,'uniqueUnits'),1);
 assert.equal(m.metric(lines,'totalCost'),120);
});

test('historical VMRS endpoint uses bound filters and includes the full original order identity',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  sqlite.exec(`CREATE TABLE equipment(id INTEGER PRIMARY KEY,unit TEXT,category TEXT,equipment_type TEXT,make TEXT,model TEXT,model_year INTEGER);
  CREATE TABLE historical_repair_lines(id INTEGER PRIMARY KEY,historical_repair_id INTEGER,equipment_id INTEGER,ro_number TEXT,ro_date TEXT,major_category TEXT,system_code TEXT,assembly_code TEXT,vmrs_description TEXT,labor_hours REAL,labor_cost REAL,parts_cost REAL,sublet_cost REAL,total_cost REAL);
  INSERT INTO equipment VALUES(1,'676','Fleet','truck','International','LT',2020),(2,'330','Trailers','trailer','','',2021);
  INSERT INTO historical_repair_lines VALUES(1,11,1,'WO100','2026-11-01','Electrical','001','002','Battery cable',1,50,25,0,75),(2,11,1,'WO100','2026-11-01','Electrical','001','003','Battery',1,50,100,0,150),(3,12,2,'WO101','2026-11-01','Tires','010','002','Tire',1,50,300,0,350);`);
  const db={prepare:sql=>({bind:(...values)=>({all:async()=>({results:sqlite.prepare(sql).all(...values)})})})};
  const history=load('lib/report-center-history.ts');
  const found=await history.getReportCenterHistoryLines(db,{startDate:'2026-11-01',endDate:'2026-11-30',equipmentType:'truck',equipmentId:'1',query:'battery'});
  assert.equal(found.totalCount,2);
  assert.equal(found.rows[0].historical_repair_id,11);
  assert.equal(found.truncated,false);
  assert.equal(found.rows.reduce((n,r)=>n+r.total_cost,0),225);
 }finally{sqlite.close();}
});

test('pilot endpoints are manager/admin read-only and classic reporting remains available',()=>{
 for(const p of ['app/api/reports/center/route.ts','app/api/reports/center/detail/route.ts']){
  const s=read(p);assert.match(s,/getSessionUser/);assert.match(s,/user\.role!=='manager'&&user\.role!=='admin'/);assert.match(s,/export async function GET/);assert.doesNotMatch(s,/export async function (POST|PATCH|DELETE|PUT)/);assert.doesNotMatch(s,/\b(?:UPDATE|INSERT INTO|DELETE FROM)\b/);
 }
 const nav=read('app/navigation-config.ts');
 assert.match(nav,/Reporting Center \(Trial\)/);
 for(const path of ['/reports','/reports/search','/reports/breakdowns','/reports/history','/reports/parts-usage','/reports/technician-productivity','/reports/technician-productivity/comparisons'])assert.ok(nav.includes('"'+path+'"'));
 const page=read('app/reports/center/page.tsx');assert.match(page,/Return to classic reports/);assert.match(page,/All existing reports/);
 assert.match(read('lib/report-search.ts'),/deepSearch: raw\.deepSearch === true/);
 assert.match(read('lib/report-search.ts'),/includeInactive: raw\.includeInactive === true/);
 assert.match(read('lib/breakdown-reports.ts'),/deepSearch: raw\.deepSearch === true/);
 assert.doesNotMatch(read('lib/breakdown-reports.ts'),/COALESCE\(b\.rolling_at,r\.completed_at\)/);
});

test('CSV cells neutralize formula-like text and preserve quoted content',()=>{
 assert.equal(m.csvCell('=HYPERLINK("x")'),"\"'=HYPERLINK(\"\"x\"\")\"");
 assert.equal(m.csvCell('a,b'),'"a,b"');
 assert.equal(m.csvCell(-10),'"-10"');
});
