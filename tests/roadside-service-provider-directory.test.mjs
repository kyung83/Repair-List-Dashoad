import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../migrations/0104_roadside_service_provider_schema.sql', import.meta.url), 'utf8');
const seeds = [1, 2, 3, 4, 5, 6]
  .map((index) => readFileSync(new URL(`../migrations/0${104 + index}_roadside_service_providers_seed_${index}.sql`, import.meta.url), 'utf8'))
  .join('\n');
const route = readFileSync(new URL('../app/api/breakdown-service-providers/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/breakdowns/page.tsx', import.meta.url), 'utf8');

test('full supplied roadside provider directory is seeded without exact duplicate rows', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS roadside_service_providers/);
  const seededRows = seeds.split('\n').filter((line) => /^\s*\('/.test(line)).length;
  assert.equal(seededRows, 378);
});

test('Indiana directory contains the supplied Indiana locations', () => {
  const indianaRows = seeds.split('\n').filter((line) => /, 'IN',/.test(line));
  assert.equal(indianaRows.length, 36);
  assert.ok(indianaRows.some((line) => line.includes("'A-1 Express'")));
  assert.ok(indianaRows.some((line) => line.includes("'Hamilton Fleet Services'")));
  assert.ok(indianaRows.some((line) => line.includes("'Stoops Freightliner- Freemont'")));
});

test('provider API requires a state and filters at the database level', () => {
  assert.match(route, /State is required/);
  assert.match(route, /'state = \?'/);
  assert.match(route, /CASE WHEN lower\(city\) = lower\(\?\) THEN 0 ELSE 1 END/);
  assert.match(route, /Manager or administrator access is required/);
});

test('breakdown page loads only the breakdown state directory and auto-fills company and phone', () => {
  assert.match(page, /new URLSearchParams\(\{ state \}\)/);
  assert.match(page, /\/api\/breakdown-service-providers\?\$\{params\.toString\(\)\}/);
  assert.match(page, /Only providers in \{state\} are shown/);
  assert.match(page, /serviceProvider: provider\.name/);
  assert.match(page, /serviceProviderPhone: provider\.phone/);
});
