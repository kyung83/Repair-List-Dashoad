import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8');
const photoRoute=readFileSync(new URL('../app/api/shop/repair-photos/route.ts',import.meta.url),'utf8');
const photoControl=readFileSync(new URL('../app/shop/repair-photo-control.tsx',import.meta.url),'utf8');

test('mechanic worker gate allows repair photo uploads',()=>{
  assert.match(worker,/TECHNICIAN_SHOP_WRITE_PATHS[\s\S]*'\/api\/shop\/repair-photos'/);
  assert.match(worker,/if \(ASSIGNED_MAINTENANCE_WRITE_PATHS\.has\(pathname\) \|\| TECHNICIAN_SHOP_WRITE_PATHS\.has\(pathname\)\) return true/);
});

test('repair photo API still limits mechanics to their assigned repair',()=>{
  assert.match(photoRoute,/user\.role === 'mechanic'/);
  assert.match(photoRoute,/Number\(repair\.technician_id \?\? 0\) === Number\(user\.technicianId\)/);
  assert.match(photoRoute,/if \(!manager && !mechanicOwner\) throw new Error\('This repair is not assigned to you\.'\)/);
});

test('Current Work repair photo control posts to the allowed repair-photo API',()=>{
  assert.match(photoControl,/fetch\("\/api\/shop\/repair-photos",\{method:"POST"/);
  assert.match(photoControl,/capture="environment"/);
});
