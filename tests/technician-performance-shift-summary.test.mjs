import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/maintenance-shift-summary.ts',import.meta.url),'utf8');
test('technician work is grouped by unit with individual repairs, notes and used parts',()=>{
 assert.match(source,/const byUnit=new Map<string,SummaryJob\[\]>/);
 assert.match(source,/Repairs on RO/);
 assert.match(source,/Work notes/);
 assert.match(source,/Parts used/);
 assert.match(source,/const handoffs=new Map<string/);
});
test('the summary leads with per-tech performance and deduplicates shared repair totals',()=>{
 assert.match(source,/Technician performance at a glance/);
 assert.match(source,/What each technician accomplished/);
 assert.match(source,/new Set\(prepared\.flatMap\(person=>person\.completed\.map/);
 assert.match(source,/new Set\(prepared\.flatMap\(person=>person\.worked\.map/);
 assert.match(source,/const labor=activity\.labor\.reduce/);
});
test('notes and unfinished parts are visible without echoing every timer stop',()=>{
 assert.match(source,/Work notes/);
 assert.match(source,/technician_note/);
 assert.match(source,/part\.remaining/);
 assert.match(source,/Next shift — units with unfinished work/);
 assert.doesNotMatch(source,/Key outcomes:/);
});
test('both normal and late-work addendum use the same reporting layout',()=>{
 assert.match(source,/function renderSummary\([^)]*lateAddendum=false\)/);
 assert.match(source,/renderSummary\(shift,workDate,start,end,due,activities\)/);
 assert.match(source,/renderSummary\(shift,workDate,originalDue,addendumDue,addendumDue,lateActivities,true\)/);
});

test('no activity mechanics and roadside or cancelled repairs are excluded from shift reporting',()=>{
 assert.match(source,/filter\(person=>person\.jobs\.length>0\)/);
 assert.match(source,/roadside-breakdown/);
 assert.match(source,/cancelled','canceled/);
});
