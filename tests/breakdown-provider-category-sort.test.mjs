import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('lib/breakdown-board-provider-sort.ts');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const lib={};
new Function('exports',compiled.outputText)(lib);
const {breakdownBoardRows,breakdownProviderNames,UNASSIGNED_PROVIDER}=lib;
const page=read('app/breakdowns/page.tsx');
const css=read('app/breakdowns/breakdown-flow.module.css');
const row=(id,service_provider,repair_needed,stage,status,updated_at='2026-11-19 14:00:00')=>({
  id,unit:'482(SC)',driver_name:'Driver',city:'Clare',state:'MI',repair_category:repair_needed,
  repair_needed,description:'Needs repair',service_provider,eta:null,stage,status,updated_at,
});
const rows=[
  row(9,'Nilo Service','TIRES',4,'ready_for_review','2026-11-19 13:00:00'),
  row(8,'ATS - GR','MECHANICAL',3,'en_route'),
  row(7,null,'TIRES',1,'reported'),
  row(6,'nilo service','MECHANICAL',4,'on_location','2026-11-19 15:00:00'),
  row(5,'ATS - GR','TIRES',4,'ready_for_review'),
];
const base={stage:'all',repairCategory:'',provider:'',search:'',sort:'newest'};

test('service provider picker uses the existing provider snapshots, grouped case-insensitively and alphabetically',()=>{
  assert.deepEqual(breakdownProviderNames(rows),['ATS - GR','Nilo Service']);
  assert.deepEqual(breakdownProviderNames([]),[]);
  assert.match(page,/aria-label="Filter by service provider"/);
  assert.match(page,/<option value=\{UNASSIGNED_PROVIDER\}>Provider Not Assigned<\/option>/);
  assert.match(page,/providerOptions\.map\(provider=>/);
});
test('provider and repair category filters combine with search and stage chips for totals',()=>{
  assert.deepEqual(breakdownBoardRows(rows,{...base,provider:'NILO SERVICE'}).map(x=>x.id),[9,6]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,provider:UNASSIGNED_PROVIDER}).map(x=>x.id),[7]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,provider:'ats - gr',repairCategory:'TIRES'}).map(x=>x.id),[5]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,provider:'ats - gr',search:'Clare',stage:'readyForTotals'}).map(x=>x.id),[5]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,stage:'readyForTotals'}).map(x=>x.id),[9,5]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,stage:'onlocation'}).map(x=>x.id),[6],'On Location excludes the separate review queue');
});
test('newest remains existing server order; provider and category sorts group correctly and place unassigned last',()=>{
  assert.deepEqual(breakdownBoardRows(rows,base).map(x=>x.id),[9,8,7,6,5]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,sort:'provider'}).map(x=>x.id),[8,5,6,9,7]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,sort:'providerCategory'}).map(x=>x.id),[8,5,6,9,7]);
  assert.deepEqual(breakdownBoardRows(rows,{...base,sort:'category'}).map(x=>x.id),[6,8,7,5,9]);
  assert.deepEqual(rows.map(x=>x.id),[9,8,7,6,5],'sorting does not modify the source breakdown list');
});
test('Ready for Totals and provider sorting stay on existing board and keep final-cost workflow untouched',()=>{
  assert.match(page,/label:'Ready for Review',count:summary\.readyForTotals/);
  assert.match(page,/readyForTotals:breakdowns\.filter\(row=>row\.status==='ready_for_review'\)\.length/);
  assert.match(page,/aria-label="Sort breakdowns"/);
  assert.match(page,/Sort: Provider → Category/);
  assert.match(page,/Sort: Repair Category A–Z/);
  assert.match(page,/breakdownBoardRows\(breakdowns/);
  assert.match(page,/row\.service_provider\|\|'Not assigned'/);
  assert.match(page,/DriverReceiptReview breakdownId=\{selected\.id\}/);
  assert.match(page,/openBreakdown\(row\.id\)/);
  assert.match(css,/\.filters \.chips\{grid-column:1\/-1\}/);
  assert.match(css,/@media\(max-width:760px\).*?\.filters\{grid-template-columns:1fr/);
  assert.doesNotMatch(page,/POST .*providerCategory/);
});
