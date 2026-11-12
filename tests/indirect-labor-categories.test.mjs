import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const migration=read('migrations/0157_indirect_labor_categories.sql');
const api=read('app/api/indirect-labor-categories/route.ts');
const launcher=read('app/shop/indirect-labor-launcher.tsx');
const create=read('app/api/shop/indirect-labor/route.ts');
const setup=read('app/setup-center/page.tsx');
const nav=read('app/navigation-config.ts');
const page=read('app/indirect-labor-categories/page.tsx');

test('indirect labor default choices are maintained in a standalone catalog',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS indirect_labor_categories/);
  for(const choice of ['Shop cleanup','Parts run','Training','Inventory','Meeting','Other']){
    assert.ok(migration.includes(choice),choice);
  }
  assert.doesNotMatch(migration,/DELETE FROM repairs|UPDATE repairs|DELETE FROM repair_labor_entries/);
});
test('manager/admin can change categories, technicians can only read active categories',()=>{
  assert.match(api,/\['manager','admin'\]\.includes\(user\.role\)/);
  assert.match(api,/\['mechanic','manager','admin'\]\.includes\(user\.role\)/);
  assert.match(api,/WHERE active=1/);
  assert.match(api,/action==='create'/);
  assert.match(api,/action==='update'/);
  assert.match(api,/category already exists/);
});
test('technicians use configured active category IDs validated by the server',()=>{
  assert.doesNotMatch(launcher,/const PRESETS=/);
  assert.match(launcher,/api\/indirect-labor-categories/);
  assert.match(launcher,/categoryId:category\.id/);
  assert.match(create,/FROM indirect_labor_categories WHERE id=\? AND active=1/);
  assert.match(create,/category\.name/);
  assert.match(create,/indirect-labor/);
});
test('setup link exists and disable/rename does not rewrite stored repair history',()=>{
  assert.match(setup,/Indirect Labor Categories/);
  assert.match(nav,/indirect-labor-categories/);
  assert.match(page,/Save/);
  assert.match(page,/window\.confirm/);
  assert.doesNotMatch(api,/UPDATE repairs|DELETE FROM repairs|DELETE FROM repair_labor_entries/);
});
