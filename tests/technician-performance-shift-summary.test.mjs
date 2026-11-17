import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/maintenance-shift-summary.ts',import.meta.url),'utf8');
test('individual technician name appears beside each unit and work order',()=>{
 assert.match(source,/const unitTitle=\(unit:string,name:string\)/);
 assert.match(source,/unitTitle\(job\.unit,techName\)/);
 assert.match(source,/\$\{job\.unit\} — \$\{name\}/);
});
test('the summary leads with per-tech performance and deduplicates shared repair totals',()=>{
 assert.match(source,/Technician performance at a glance/);
 assert.match(source,/What each technician accomplished/);
 assert.match(source,/new Set\(prepared\.flatMap\(person=>person\.completed\.map/);
 assert.match(source,/new Set\(prepared\.flatMap\(person=>person\.worked\.map/);
 assert.match(source,/const labor=activity\.labor\.reduce/);
});
test('notes and unfinished parts are visible without echoing every timer stop',()=>{
 assert.match(source,/Tech notes:/);
 assert.match(source,/technician_note/);
 assert.match(source,/part\.remaining/);
 assert.match(source,/Next shift — unfinished work/);
 assert.doesNotMatch(source,/Key outcomes:/);
});
test('both normal and late-work addendum use the same reporting layout',()=>{
 assert.match(source,/function renderSummary\([^)]*lateAddendum=false\)/);
 assert.match(source,/renderSummary\(shift,workDate,start,end,due,activities\)/);
 assert.match(source,/renderSummary\(shift,workDate,originalDue,addendumDue,addendumDue,lateActivities,true\)/);
});
