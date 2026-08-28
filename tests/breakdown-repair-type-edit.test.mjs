import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/breakdowns/page.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/breakdowns/[id]/repair-type/route.ts', import.meta.url), 'utf8');

test('browser breakdown card allows managers to change the repair type in diagnostics', () => {
  assert.ok(page.includes('DIAGNOSTICS'));
  assert.ok(page.includes('Repair Type<select'));
  assert.ok(page.includes("fetch(`/api/breakdowns/${id}/repair-type`"));
  assert.ok(page.includes('Save Repair Type'));
});

test('repair type update validates the category and keeps the linked repair title synchronized', () => {
  assert.ok(route.includes('REPAIR_CATEGORIES.has(repairCategory)'));
  assert.ok(route.includes('UPDATE roadside_breakdowns'));
  assert.ok(route.includes('SET repair_category = ?'));
  assert.ok(route.includes('UPDATE repairs'));
  assert.ok(route.includes('Roadside breakdown - ${breakdown.driver_name}: ${repairCategory}'));
  assert.ok(route.includes('env.DB.batch'));
});
