import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const navigation=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const coresPage=readFileSync(new URL('../app/cores/page.tsx',import.meta.url),'utf8');
const coresApi=readFileSync(new URL('../app/api/cores/route.ts',import.meta.url),'utf8');
const controlsPage=readFileSync(new URL('../app/inventory-controls/page.tsx',import.meta.url),'utf8');
const controlsApi=readFileSync(new URL('../app/api/inventory-controls/route.ts',import.meta.url),'utf8');

test('Cores is a first-class Parts navigation page',()=>{
  assert.match(navigation,/href: "\/cores", label: "Cores"/);
});

test('Cores page owns the core workflows',()=>{
  assert.match(coresPage,/Open Cores/);
  assert.match(coresPage,/Core Return Rule/);
  assert.match(coresPage,/\/api\/cores/);
  assert.match(coresPage,/RETURN CORE/);
  assert.match(coresPage,/WAIVE/);
});

test('Returned core part supports the same catalog part',()=>{
  assert.match(coresPage,/SAME AS ISSUED/);
  assert.match(coresPage,/setCorePartId\(selected\.core_return_part_id==null\?String\(selected\.id\)/);
  assert.doesNotMatch(coresApi,/corePartId === partId/);
});

test('Dedicated cores API owns configuration and return actions',()=>{
  assert.match(coresApi,/action === 'configureCore'/);
  assert.match(coresApi,/action === 'closeCore'/);
  assert.match(coresApi,/Core obligation disposition depends on the original issued part/);
  assert.match(coresApi,/Core return did not save/);
});

test('Inventory Controls no longer contains core workflow',()=>{
  assert.doesNotMatch(controlsPage,/Core-return rules|Open core obligations|RETURNED CORE PART/);
  assert.doesNotMatch(controlsApi,/action === 'configureCore'|action === 'closeCore'/);
});
