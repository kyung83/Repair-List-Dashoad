import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const result=ts.transpileModule(read('lib/report-center-print.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const m={};
new Function('exports','require',result.outputText)(m,()=>{throw Error('Unexpected runtime import');});
const repair=(id,extra={})=>({key:'r'+id,kind:'repair',id,fields:{unit:'676',equipmentId:1,category:'Electrical',issue:'Cable',date:'2026-11-01',status:'Completed',source:'repair-board',partsCost:20,laborCost:30,outsideCost:50,totalCost:100,...extra}});
const breakdown=(id,extra={})=>({key:'b'+id,kind:'breakdown',id,fields:{unit:'676',equipmentId:1,category:'Electrical',issue:'Cable',date:'2026-11-02',status:'complete',repairId:1,downtimeHours:2,totalCost:100,partsCost:20,laborCost:30,outsideCost:50,provider:'Vendor',...extra}});
const source=(rows,extra={})=>({title:'Full Fleet',context:'Applied range November 2026',tables:[{title:'All filtered rows',columns:[{key:'unit',label:'Unit'},{key:'issue',label:'Issue'}],rows}],cohorts:[{label:'Cohort A',records:rows}],...extra});
const options=(extra={})=>({sections:m.ALL_SECTIONS,repeatDays:30,volume:1,orientation:'landscape',...extra});
const origin='https://example.test';

test('full mode defaults to all twelve requested sections',()=>{
 assert.equal(m.ALL_SECTIONS.length,12);
 for(const s of ['summary','costs','descriptions','notes','parts','labor','timeline','providers','repeat','charts','photos','invoices'])assert.ok(m.ALL_SECTIONS.includes(s));
 assert.match(read('app/reports/center/full-print-button.tsx'),/useState<Section\[\]>\(\[\.\.\.ALL_SECTIONS\]\)/);
});
test('linked repairs and imported historical line items produce one dossier per original record',()=>{
 const historical={key:'r-10',kind:'historical',id:10,fields:{unit:'676'}};
 const line={...historical,key:'hl1'};
 const rows=[repair(1),breakdown(5),historical,line,repair(2)];
 const jobs=m.detailJobs([{label:'A',records:rows},{label:'B',records:[repair(1),line]}]);
 assert.deepEqual(jobs.map(j=>j.key),['breakdown:5','historical:10','repair:2']);
 assert.deepEqual(jobs[0].cohorts,['A','B']);
 assert.deepEqual(jobs[1].cohorts,['A','B']);
});
test('full report includes all filtered table rows beyond the visible screen page',()=>{
 const rows=Array.from({length:125},(_,i)=>repair(i+1,{issue:'Marker '+(i+1)}));
 const html=m.buildPrintDocument(source(rows),options({sections:['summary','costs']}),[],origin);
 assert.match(html,/Marker 125/);
 assert.match(html,/125 matching rows/);
 assert.match(html,/Executive summary/);
 assert.doesNotMatch(html,/Detailed supporting records/);
});
test('full dossier includes notes, parts, labor, known rolling timeline and supporting file links',()=>{
 const rows=[breakdown(5)];
 const job=m.detailJobs(source(rows).cohorts)[0];
 const detail={repair:{title:'Repair title',source:'roadside-breakdown',description:'Office diagnosis',completed_at:'2026-11-02 20:00:00',labor_hours:2},breakdown:{id:5,description:'Driver complaint',repair_needed:'Electrical',created_at:'2026-11-02 10:00:00',rolling_at:'2026-11-02 12:00:00',rolling_confirmation_source:'office_geotab',service_provider:'Vendor'},receipt:{reviewed_invoice_number:'INV-1',reviewed_total_amount:'50.00',review_status:'reviewed'},notes:[{detail:'Verified terminal repair',technician:'Tech'}],parts:[{part_number:'PN123',quantity:2,recorded_unit_cost:10}],labor:[{hours:2,rate:15,notes:'Labor note'}],photos:[{file_name:'repair.png',content_type:'image/png',url:'/api/photos/repair-work/repair.png'}],receiptPages:[{file_name:'receipt.png',content_type:'image/png',url:'/api/breakdowns/receipts/file?receiptId=1&page=1'}],outsideDocuments:[{vendor_name:'Dealer',invoice_number:'OUT-5',file_name:'invoice.pdf',content_type:'application/pdf',url:'/api/outside-work?fileId=7'}]};
 const html=m.buildPrintDocument(source(rows),options(),[{job,detail}],origin);
 for(const s of ['Executive summary','Cost breakdown','Service provider analysis','Potential repeat failures','Comparison charts','Original driver complaint','Driver complaint','Office diagnosis','Verified terminal repair','PN123','Individual labor entries','Roadside timeline','Office confirmed using Geotab','Recorded equipment downtime','2 hr','INV-1','OUT-5','Repair and driver photos','Receipts and invoices','https://example.test/api/photos/repair-work/repair.png','https://example.test/api/outside-work?fileId=7','Original file requires separate viewing / printing'])assert.ok(html.includes(s),s);
 assert.match(html,/Office closeout is not actual equipment downtime/);
 assert.match(html,/Do not add record groups together/);
});
test('print content is escaped and original links remain within allowed same-origin routes',()=>{
 const rows=[repair(1,{issue:'<script>alert(1)</script>'})];
 const job=m.detailJobs(source(rows).cohorts)[0];
 const html=m.buildPrintDocument(source(rows),options(),[{job,detail:{repair:{title:'<img src=x onerror=alert(1)>'},photos:[{file_name:'evil',url:'https://evil.test/a',content_type:'image/png'},{file_name:'evil2',url:'/api/../secret',content_type:'image/png'}]}}],origin);
 assert.doesNotMatch(html,/<script>|<img src=x|https:\/\/evil\.test\/a|href="https:\/\/example\.test\/secret"/);
 assert.match(html,/&lt;script&gt;alert/);
 assert.match(html,/Original file link unavailable/);
});
test('repeat patterns exclude cleared calls, linked roadside repair records and uncategorized data',()=>{
 const rows=[repair(1),repair(2,{date:'2026-11-07'}),repair(3,{source:'roadside-breakdown'}),repair(4,{category:'Uncategorized'}),breakdown(10),breakdown(11,{date:'2026-11-06'}),breakdown(12,{status:'not_breakdown'})];
 const found=m.repeatPatterns(rows,7);
 assert.equal(found.length,2);
 assert.equal(found.find(r=>r.kind==='repair').ids,'1, 2');
 assert.equal(found.find(r=>r.kind==='breakdown').ids,'10, 11');
});
test('large scopes split into labeled volumes; partial data is disclosed, never silently dropped',()=>{
 const rows=Array.from({length:201},(_,i)=>repair(i+1));
 const s=source(rows,{partial:true});
 const job=m.detailJobs(s.cohorts)[100];
 const html=m.buildPrintDocument(s,options({volume:2}),[{job,error:'Unavailable'}],origin);
 assert.match(html,/Detailed records 101–200 of 201 · Volume 2 of 3/);
 assert.match(html,/PARTIAL REPORT/);
 assert.match(html,/Details could not be loaded/);
 assert.doesNotMatch(html,/125 matching rows/);
 assert.match(html,/summary, comparison charts and all selected table rows are in volume 1/i);
});
test('wide comparison tables repeat group labels and preserve every selected column',()=>{
 const cols=[{key:'group',label:'Group'},...Array.from({length:17},(_,i)=>({key:'x'+i,label:'Metric '+(i+1)}))];
 const row={key:'1',fields:{group:'International',...Object.fromEntries(Array.from({length:17},(_,i)=>['x'+i,i]))}};
 const html=m.renderTable({title:'Compare',columns:cols,rows:[row]});
 assert.equal((html.match(/International/g)||[]).length,3);
 assert.match(html,/Metric 17/);
 assert.match(html,/Column group 3 of 3/);
});
test('existing CSV, Excel and screen print remain; full print uses all filtered rows and comparison drill-down cohorts',()=>{
 const table=read('app/reports/center/report-table.tsx');
 assert.match(table,/Print displayed page/);assert.match(table,/exportFile\('csv'\)/);assert.match(table,/exportFile\('xlsx'\)/);assert.match(table,/rows:filtered,columns:visibleColumns/);
 assert.match(table,/FullPrintButton source=\{printSource\}/);
 const page=read('app/reports/center/page.tsx');
 assert.match(page,/Print Full Fleet Report/);assert.match(page,/Print Full Unit History/);assert.match(page,/Return to classic reports/);
 const comparison=read('app/reports/center/comparison-workspace.tsx');
 assert.match(comparison,/records:rows.flatMap\(r=>r.a\)/);assert.match(comparison,/records:rows.flatMap\(r=>r.b\)/);
 const route=read('app/api/reports/center/detail/route.ts');
 assert.match(route,/outside_work_documents d WHERE d.repair_id=\?/);assert.match(route,/user.role!=='manager'&&user.role!=='admin'/);assert.doesNotMatch(route,/export async function (POST|PATCH|DELETE)/);
});
