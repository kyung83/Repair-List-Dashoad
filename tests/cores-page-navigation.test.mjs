import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const navigation=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const cores=readFileSync(new URL('../app/cores/page.tsx',import.meta.url),'utf8');

test('Cores is a first-class Parts navigation page',()=>{
  assert.match(navigation,/href: "\/cores", label: "Cores"/);
});

test('Cores page exposes the two core workflows',()=>{
  assert.match(cores,/Open Cores/);
  assert.match(cores,/Core Return Rule/);
  assert.match(cores,/configureCore/);
  assert.match(cores,/closeCore/);
  assert.match(cores,/RETURNED/);
  assert.match(cores,/WAIVE/);
});

test('Cores page reuses inventory controls API without moving other controls',()=>{
  assert.match(cores,/\/api\/inventory-controls/);
  assert.match(cores,/href="\/inventory-controls"/);
});
