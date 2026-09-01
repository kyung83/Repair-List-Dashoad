import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('breakdown reporting uses the same repair and unit cost source of truth', async () => {
  const service = await read('lib/breakdown-reports.ts');
  assert.match(service, /FROM roadside_breakdowns b/);
  assert.match(service, /JOIN repairs r ON r\.id=b\.repair_id/);
  assert.match(service, /JOIN equipment e ON e\.id=b\.equipment_id/);
  assert.match(service, /repair_parts rp/);
  assert.match(service, /COALESCE\(r\.labor_hours,0\)\*COALESCE\(r\.labor_rate,0\)/);
  assert.match(service, /COALESCE\(r\.outside_cost,0\)/);
  assert.match(service, /AS total_cost/);
});

test('breakdown report calculates arrival and downtime from recorded roadside timestamps', async () => {
  const service = await read('lib/breakdown-reports.ts');
  assert.match(service, /COALESCE\(b\.tech_arrived_at,b\.on_location_at\)/);
  assert.match(service, /claim_minutes/);
  assert.match(service, /arrival_minutes/);
  assert.match(service, /repair_minutes/);
  assert.match(service, /downtime_minutes/);
  assert.match(service, /COALESCE\(b\.rolling_at,r\.completed_at\)/);
});

test('breakdown report provides unit category provider location and monthly analysis', async () => {
  const service = await read('lib/breakdown-reports.ts');
  for (const token of ['byUnit','byCategory','byProvider','byLocation','monthlyTrend']) assert.match(service, new RegExp(token));
  assert.match(service, /COUNT\(DISTINCT equipment_id\)/);
  assert.match(service, /average_arrival_minutes/);
  assert.match(service, /total_downtime_hours/);
});

test('breakdown reporting API is protected and office-report compatible', async () => {
  const route = await read('app/api/reports/breakdowns/route.ts');
  assert.match(route, /getSessionUser/);
  assert.match(route, /user\.role === 'mechanic'/);
  assert.match(route, /getBreakdownReportData/);
  assert.match(route, /cache-control': 'no-store'/);
});

test('reports UI exposes dedicated sortable breakdown reports and CSV export', async () => {
  const [page, nav] = await Promise.all([
    read('app/reports/breakdowns/page.tsx'),
    read('app/navigation-config.ts'),
  ]);
  assert.match(nav, /href: "\/reports\/breakdowns", label: "Breakdowns"/);
  assert.match(page, /Roadside Breakdown Cost & Performance/);
  assert.match(page, /Export Breakdown CSV/);
  assert.match(page, /Click a column heading to sort this breakdown data on its own/);
  assert.match(page, /Breakdown Cost by Unit/);
  assert.match(page, /Monthly Breakdown Trend/);
  assert.match(page, /By Service Provider/);
  assert.match(page, /Unit-cost connection/);
});

test('general report search continues to include roadside breakdown repair costs', async () => {
  const search = await read('lib/report-search.ts');
  assert.match(search, /FROM repairs r/);
  assert.match(search, /COALESCE\(r\.outside_cost,0\) AS outside_cost/);
  assert.match(search, /parts_cost\+labor_hours\*labor_rate\+outside_cost/);
  assert.match(search, /if \(input\.repairSource\).*r\.source/);
  assert.doesNotMatch(search, /COALESCE\(r\.source,''\) <> 'roadside-breakdown'/);
});
