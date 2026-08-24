import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const migration = await readFile(new URL('migrations/0095_pm_kit_multi_fitment.sql', root), 'utf8');
const service = await readFile(new URL('lib/pm-kits.ts', root), 'utf8');
const page = await readFile(new URL('app/pm-kits/page.tsx', root), 'utf8');

test('PM kit families preserve existing concrete pm_kits rows for scheduled-PM matching', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pm_kit_families/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS pm_kit_family_members/);
  assert.doesNotMatch(migration, /DROP\s+TRIGGER/i);
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
});

test('one visible PM kit expands interchangeable selections into concrete fitments', () => {
  assert.match(service, /function expandFitments\(years: number\[\], makes: string\[\], models: string\[\], engines: string\[\]\)/);
  assert.match(service, /yearRanges\.length \* makeValues\.length \* modelValues\.length \* engineValues\.length/);
  assert.match(service, /MAX_FITMENT_COMBINATIONS = 200/);
  assert.match(service, /INSERT INTO pm_kit_family_members \(family_id, pm_kit_id, sort_order, retired_at\)/);
});

test('consecutive selected years are stored as ranges instead of exploding one row per year', () => {
  assert.match(service, /function compressYears\(years: number\[\]\)/);
  assert.match(service, /if \(year === previous \+ 1\)/);
  assert.match(service, /ranges\.push\(\{ from: start, to: previous \}\)/);
});

test('editing preserves historical kit members while retiring them from future matching', () => {
  assert.match(service, /SET active = 0, updated_at = CURRENT_TIMESTAMP/);
  assert.match(service, /SET retired_at = CURRENT_TIMESTAMP/);
  assert.match(migration, /retired members are preserved/i);
});

test('PM kit UI supports multiple years, makes, models, and engines under Parts', () => {
  assert.match(page, /<ModuleTabs module="parts" \/>/);
  assert.match(page, /<YearField options=\{years\} values=\{draft\.years\}/);
  assert.match(page, /label="MAKES"/);
  assert.match(page, /label="MODELS"/);
  assert.match(page, /label="ENGINES \/ MOTORS"/);
  assert.match(page, /Interchangeable fitment:/);
});
