import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/breakdowns/page.tsx', import.meta.url), 'utf8');

test('reported breakdowns are claimed into diagnostics instead of showing a separate diagnostics advance button', () => {
  assert.ok(page.includes("!row.claimed_by_user_id && <button"));
  assert.ok(page.includes("row.stage >= 2 && row.stage < 4"));
  assert.ok(!page.includes('Advance to Diagnostics'));
});
