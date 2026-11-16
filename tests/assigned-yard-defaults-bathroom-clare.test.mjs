import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('authenticated session exposes assigned yard and parts warehouse to client screens',()=>{
 const api=read('app/api/auth/me/route.ts');
 assert.match(api,/FROM app_users u LEFT JOIN warehouses w/);
 assert.match(api,/yard: assigned\?\.yard/);
 assert.match(api,/assignedWarehouseCode: assigned\?\.warehouse_code/);
 const helper=read('lib/client-assigned-yard.ts');
 assert.match(helper,/normalizeYard/);
 assert.match(helper,/\/api\/auth\/me/);
});

test('bathroom auto rotation and manual assignment require Clare yard',()=>{
 const lib=read('lib/shop-duties.ts');
 assert.match(lib,/template\.template_key === 'bathroom-weekly' \? "AND lower\(trim\(COALESCE\(yard,''\)\)\)='clare'"/);
 assert.match(lib,/template\.template_key === 'bathroom-weekly' \? "AND lower\(trim\(COALESCE\(u\.yard,''\)\)\)='clare'"/);
 assert.match(lib,/Bathroom Cleaning & Check is for Clare technicians only/);
 assert.match(lib,/Bathroom Cleaning & Check can only be assigned to Clare technicians/);
});
test('yard-oriented screens initialize to the authenticated site while preserving switcher',()=>{
 for(const p of ['app/repair-board/planning-center.tsx','app/repair-board/dashboard-v2.tsx','app/inventory/page.tsx','app/parts-desk/page.tsx','app/parts-receiving/page.tsx','app/inventory-transfer/page.tsx','app/cores/page.tsx']){
  assert.match(read(p),/getAssignedYard/,`missing yard default in ${p}`);
 }
});
