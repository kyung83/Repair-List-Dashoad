import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [service, route, page, nav] = await Promise.all([
  readFile(new URL('../lib/report-search.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/reports/search/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/reports/search/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/navigation-config.ts', import.meta.url), 'utf8'),
]);

test('report search supports arbitrary inclusive date ranges', () => {
  assert.match(service, /BETWEEN \? AND \?/);
  assert.match(route, /startDate: params\.get\('start'\)/);
  assert.match(route, /endDate: params\.get\('end'\)/);
  assert.match(page, /Custom dates/);
  assert.match(page, /All history/);
});

test('report search spans current repairs and imported historical ROs', () => {
  assert.match(service, /FROM repairs r/);
  assert.match(service, /FROM historical_repairs h/);
  assert.match(service, /Historical RO import/);
  assert.match(page, /software repairs \+ .* imported historical ROs/);
});

test('report search exposes equipment repair maintenance and expense filters', () => {
  for (const term of ['equipmentType', 'repairStatus', 'technician', 'repairLocation', 'maintenanceType', 'pmType', 'expenseCategory']) {
    assert.ok(service.includes(term), `service missing ${term}`);
    assert.ok(page.includes(term), `page missing ${term}`);
  }
});

test('report search exports all major result sets', () => {
  assert.match(page, /repairs-\$\{rangeSlug\}\.csv/);
  assert.match(page, /maintenance-\$\{rangeSlug\}\.csv/);
  assert.match(page, /expenses-\$\{rangeSlug\}\.csv/);
  assert.match(page, /parts-\$\{rangeSlug\}\.csv/);
});

test('Reports module exposes Search Reports as a first-class tab', () => {
  assert.match(nav, /href: "\/reports\/search", label: "Search Reports"/);
  assert.match(nav, /href: "\/reports", label: "Summary"/);
});
