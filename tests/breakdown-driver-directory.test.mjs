import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const directory = readFileSync(new URL('../lib/breakdown-driver-directory.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/breakdowns/route.ts', import.meta.url), 'utf8');
const searchRoute = readFileSync(new URL('../app/api/breakdowns/driver-search/route.ts', import.meta.url), 'utf8');
const breakdowns = readFileSync(new URL('../lib/roadside-breakdowns.ts', import.meta.url), 'utf8');
const browser = readFileSync(new URL('../public/breakdown-driver-directory.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0116_breakdown_driver_directory.sql', import.meta.url), 'utf8');

test('Recruiting A-C is cached instead of queried from the browser hot path', () => {
  assert.match(directory, /Master Data EI|MASTER_DATA_SPREADSHEET_ID/);
  assert.match(directory, /Recruiting/);
  assert.match(directory, /range=A:C/);
  assert.match(directory, /breakdown_driver_directory/);
  assert.doesNotMatch(browser, /docs\.google\.com|spreadsheets\/d\//);
});

test('driver directory sync runs once daily without replacing a good cache on read failure', () => {
  assert.match(worker, /controller\.cron === '15 6 \* \* \*'/);
  assert.match(worker, /syncBreakdownDriverDirectory/);
  assert.doesNotMatch(worker, /minute % 5 === 0/);
  assert.match(directory, /active_generation/);
  assert.match(directory, /keeping the previous cache/);
  assert.match(migration, /breakdown_driver_directory_sync/);
});

test('public driver search exposes only name and phone last four', () => {
  assert.match(searchRoute, /searchBreakdownDrivers/);
  assert.match(directory, /phoneLast4/);
  assert.doesNotMatch(searchRoute, /phone_e164|phone_display/);
  assert.doesNotMatch(browser, /phone_e164|phone_display/);
  assert.match(browser, /Phone ending/);
});

test('breakdown submit resolves full driver phone server-side', () => {
  assert.match(route, /resolveBreakdownDriverDirectorySelection/);
  assert.match(route, /driverDirectoryId/);
  assert.match(route, /directoryDriver\?\.phone/);
  assert.match(breakdowns, /driverPhone\?: string/);
  assert.match(breakdowns, /Driver Phone:/);
  assert.match(breakdowns, /directory-fallback/);
});

test('manual driver entry remains an explicit emergency choice', () => {
  assert.match(browser, /Driver not listed/);
  assert.match(browser, /driverNotListed/);
  assert.match(route, /Search for and select the driver from Recruiting, or use Driver not listed/);
});
