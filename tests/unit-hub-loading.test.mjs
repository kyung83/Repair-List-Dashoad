import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const unit=readFileSync(new URL('../app/unit/page.tsx',import.meta.url),'utf8');
const pmApi=readFileSync(new URL('../app/api/pm-inspections/route.ts',import.meta.url),'utf8');
const annualApi=readFileSync(new URL('../app/api/annual-inspections/route.ts',import.meta.url),'utf8');

test('Unit Hub no longer blocks initial render on every supporting API',()=>{
  assert.doesNotMatch(unit,/Promise\.all\(\[/);
  assert.match(unit,/fetch\('\/api\/equipment'/);
  assert.match(unit,/fetch\('\/api\/repair-board'/);
  assert.match(unit,/fetch\('\/api\/maintenance-actions'/);
});

test('PM and Annual history load only for the selected unit',()=>{
  assert.match(unit,/api\/pm-inspections\?unit=/);
  assert.match(unit,/api\/annual-inspections\?unit=/);
  assert.match(pmApi,/searchParams\.get\('unit'\)/);
  assert.match(annualApi,/searchParams\.get\('unit'\)/);
  assert.match(pmApi,/e\.unit = \? COLLATE NOCASE/);
  assert.match(annualApi,/e\.unit = \? COLLATE NOCASE/);
});

test('slow maintenance form history cannot prevent equipment from loading',()=>{
  const equipmentIndex=unit.indexOf("fetch('/api/equipment'");
  const pmIndex=unit.indexOf('api/pm-inspections?unit=');
  const annualIndex=unit.indexOf('api/annual-inspections?unit=');
  assert.ok(equipmentIndex>=0);
  assert.ok(pmIndex>equipmentIndex);
  assert.ok(annualIndex>equipmentIndex);
  assert.match(unit,/setEquipment\(eq\.equipment\)/);
});


test('mobile Unit lookup avoids fleet-wide native datalist and uses native GET navigation',()=>{
  assert.doesNotMatch(unit,/<datalist/);
  assert.doesNotMatch(unit,/list="unit-list"/);
  assert.match(unit,/<form className="easy-finder" action="\/unit" method="get">/);
  assert.match(unit,/name="unit"/);
  assert.match(unit,/type="submit"/);
  assert.match(unit,/slice\(0,8\)/);
});

test('Unit Hub tolerates missing role and malformed unit text without crashing client controls',()=>{
  assert.match(unit,/board\?\.user\?\.role/);
  assert.match(unit,/function safeText\(value:unknown\)/);
  assert.match(unit,/filter\(item=>item&&safeText\(item\.unit\)\)/);
});
