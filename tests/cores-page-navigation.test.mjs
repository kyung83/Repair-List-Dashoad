import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const navigation=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const corePage=readFileSync(new URL('../app/cores/page.tsx',import.meta.url),'utf8');
const coreApi=readFileSync(new URL('../app/api/cores/route.ts',import.meta.url),'utf8');
const controlsPage=readFileSync(new URL('../app/inventory-controls/page.tsx',import.meta.url),'utf8');
const controlsApi=readFileSync(new URL('../app/api/inventory-controls/route.ts',import.meta.url),'utf8');

test('Core is the single Parts navigation destination',()=>{
  assert.match(navigation,/href: "\/cores", label: "Core"/);
  assert.doesNotMatch(navigation,/href: "\/inventory-controls", label: "Inventory Controls"/);
});

test('Core page owns every former Inventory Controls workflow',()=>{
  assert.match(corePage,/Open Cores/);
  assert.match(corePage,/Core Return Rule/);
  assert.match(corePage,/Physical-count discrepancies/);
  assert.match(corePage,/Recover a Used Tire/);
  assert.match(corePage,/Recovered Tires Available/);
  assert.match(corePage,/\/api\/cores/);
});

test('Returned core part supports the same catalog part',()=>{
  assert.match(corePage,/SAME AS ISSUED/);
  assert.match(corePage,/setCorePartId\(selected\.core_return_part_id==null\?String\(selected\.id\)/);
  assert.doesNotMatch(coreApi,/corePartId === partId/);
});

test('Core API owns all four control action groups',()=>{
  assert.match(coreApi,/action === 'configureCore'/);
  assert.match(coreApi,/action === 'closeCore'/);
  assert.match(coreApi,/action === 'resolvePhysicalCount'/);
  assert.match(coreApi,/action === 'recoverUsedTire'/);
  assert.match(coreApi,/action === 'disposeUsedTire'/);
  assert.match(coreApi,/Core return did not save/);
});

test('old Inventory Controls routes only forward to Core',()=>{
  assert.match(controlsPage,/redirect\("\/cores"\)/);
  assert.match(controlsApi,/export \{ GET, POST \} from "\.\.\/cores\/route"/);
});
