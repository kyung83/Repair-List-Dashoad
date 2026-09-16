import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8')}

test('Reports navigation exposes dedicated Parts Usage report',async()=>{
  const nav=await read('app/navigation-config.ts');
  assert.match(nav,/href: "\/reports\/parts-usage", label: "Parts Usage"/);
});

test('Parts Usage API is protected and accepts date part unit and search filters',async()=>{
  const route=await read('app/api/reports/parts-usage/route.ts');
  assert.match(route,/getSessionUser/);
  assert.match(route,/user\.role === 'mechanic' \|\| user\.role === 'dispatch'/);
  assert.match(route,/startDate: params\.get\('start'\)/);
  assert.match(route,/endDate: params\.get\('end'\)/);
  assert.match(route,/partId: params\.get\('part'\)/);
  assert.match(route,/equipmentId: params\.get\('unit'\)/);
  assert.match(route,/query: params\.get\('q'\)/);
  assert.match(route,/cache-control': 'no-store'/);
});

test('Parts Usage service reports actual repair part usage with repair unit technician quantity and cost',async()=>{
  const service=await read('lib/parts-usage-report.ts');
  assert.match(service,/FROM repair_parts rp/);
  assert.match(service,/JOIN parts p ON p\.id=rp\.part_id/);
  assert.match(service,/JOIN repairs r ON r\.id=rp\.repair_id/);
  assert.match(service,/LEFT JOIN equipment e ON e\.id=r\.equipment_id/);
  assert.match(service,/LEFT JOIN technicians t ON t\.id=r\.technician_id/);
  assert.match(service,/COALESCE\(rp\.created_at,r\.opened_at\) AS used_at/);
  assert.match(service,/rp\.quantity\*COALESCE\(rp\.unit_cost,p\.unit_cost,0\) AS line_cost/);
  assert.match(service,/COUNT\(DISTINCT rp\.repair_id\) AS repair_count/);
  assert.match(service,/COUNT\(DISTINCT r\.equipment_id\) AS unit_count/);
});

test('Parts Usage page provides summary drilldown detail and CSV exports',async()=>{
  const page=await read('app/reports/parts-usage/page.tsx');
  assert.match(page,/Find exactly where a part went/);
  assert.match(page,/PART LINES/);
  assert.match(page,/QUANTITY USED/);
  assert.match(page,/RECORDED COST/);
  assert.match(page,/View Usage/);
  assert.match(page,/Individual Part Usage/);
  assert.match(page,/Mechanic/);
  assert.match(page,/Unit Cost/);
  assert.match(page,/Line Cost/);
  assert.match(page,/Export Summary CSV/);
  assert.match(page,/Export Detail CSV/);
  assert.match(page,/more than 5,000 detail lines/);
});
