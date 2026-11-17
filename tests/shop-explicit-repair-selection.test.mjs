import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app/shop/page-v2.tsx',import.meta.url),'utf8');
test('Shop Jobs starts the exact selected repair instead of the first repair on a unit',()=>{
 assert.match(source,/group\.repairs\.map\(repair=>/);
 assert.match(source,/onClick=\{\(\)=>void startRepair\(repair\)\}/);
 assert.match(source,/START THIS REPAIR/);
 assert.doesNotMatch(source,/onClick=\{\(\)=>void startRepair\(workable\)\}/);
 assert.match(source,/Choose the exact repair above to start labor/);
});
test('Only the assigned technician, team helper, or unassigned job is startable',()=>{
 assert.match(source,/repair\.technicianId===data\.user\.technicianId/);
 assert.match(source,/repair\.teamIds\|\|\[\]/);
 assert.match(source,/repair\.technicianId===null/);
});