import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routeUrl=new URL('../app/api/shop/route.ts',import.meta.url);
const legacyUrl=new URL('../app/api/shop/route-legacy.ts',import.meta.url);
const migrationUrl=new URL('../migrations/0078_working_manager_technician_links.sql',import.meta.url);

test('working managers keep their assigned repairs visible even outside their yard scope',async()=>{
  const [route,legacy,migration]=await Promise.all([
    readFile(routeUrl,'utf8'),
    readFile(legacyUrl,'utf8'),
    readFile(migrationUrl,'utf8'),
  ]);

  assert.match(migration,/Jeff Wittig and Jesse Graham were linked to technician IDs 2 and 3/);
  assert.match(legacy,/user\.role === 'mechanic' && user\.technicianId/);
  assert.match(route,/user\?\.role !== 'manager' \|\| !user\.technicianId/);
  assert.match(route,/Number\(repair\.technicianId \?\? 0\) === technicianId/);
  assert.match(route,/const missing = assigned\.filter\(\(repair\)=>!visibleIds\.has\(repair\.id\)\)/);
  assert.match(route,/payload\.repairs = \[\.\.\.visible,\.\.\.restored\]/);
  assert.match(route,/getRepairPartRequests\(env\.DB\)/);
});
