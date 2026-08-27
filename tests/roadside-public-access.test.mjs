import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../app/app-nav.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/breakdowns/route.ts', import.meta.url), 'utf8');

test('driver roadside page and only its public data entrypoints bypass dashboard login', () => {
  assert.match(worker, /['"]\/report-breakdown['"]/);
  assert.match(worker, /['"]\/api\/equipment\/search['"]/);
  assert.match(worker, /['"]\/api\/breakdowns['"]/);
  assert.match(worker, /['"]\/api\/breakdowns\/geotab-preview['"]/);
  assert.doesNotMatch(worker, /['"]\/breakdowns['"][\s,]*\n?[\s\S]{0,40}PUBLIC_PATHS/);
});

test('driver roadside page stays visually separate from authenticated app navigation', () => {
  assert.match(nav, /pathname\.startsWith\(["']\/report-breakdown["']\)/);
});

test('public breakdown submission rejects cross-site browser posts', () => {
  assert.match(route, /Cross-site breakdown submission rejected/);
  assert.match(route, /origin !== requestUrl\.origin/);
});
