import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const api=readFileSync(new URL('../app/api/pm-inspections/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/pm-inspections/page.tsx',import.meta.url),'utf8');
const printPage=readFileSync(new URL('../app/annual-inspections/print/page.tsx',import.meta.url),'utf8');
const nav=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const unit=readFileSync(new URL('../app/unit/page.tsx',import.meta.url),'utf8');
const dock=readFileSync(new URL('../app/technician-mobile-dock.tsx',import.meta.url),'utf8');
const today=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('completed PM forms are listed from completed scheduled PM checklist runs',()=>{
  assert.match(api,/c\.event_type='pm'/);
  assert.match(api,/c\.status='completed'/);
  assert.match(api,/r\.source='scheduled-pm'/);
  assert.match(api,/lower\(COALESCE\(r\.status,''\)\) LIKE '%complete%'/);
  assert.match(api,/NLW-PM-/);
});

test('PM records page matches Annual print and Save PDF workflow',()=>{
  assert.match(page,/Completed PM Forms/);
  assert.match(page,/Print \/ Save PDF/);
  assert.match(page,/fetch\("\/api\/pm-inspections"/);
  assert.match(api,/\/annual-inspections\/print\?repairId=/);
  assert.match(printPage,/report\.eventType==='pm'\?<Pm report=\{report\}/);
  assert.match(printPage,/window\.print\(\)/);
});

test('PM Records and Forms is available anywhere Annual forms are surfaced',()=>{
  assert.match(nav,/href: "\/pm-inspections", label: "PM Records \/ Forms"/);
  assert.match(dock,/\["PM Forms","\/pm-inspections"\]/);
  assert.match(today,/href="\/pm-inspections"/);
});

test('Unit Hub loads, lists, and prints PM forms alongside Annual forms',()=>{
  assert.match(unit,/api\/pm-inspections\?unit=/);
  assert.match(unit,/Print Latest PM/);
  assert.match(unit,/PM forms/);
  assert.match(unit,/Print \/ PDF/);
  assert.match(unit,/Browse PM Records \/ Forms/);
});
