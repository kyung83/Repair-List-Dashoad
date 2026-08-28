import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('app/breakdowns/page.tsx', 'utf8');
const providerRoute = fs.readFileSync('app/api/breakdown-service-providers/route.ts', 'utf8');
const breakdownRoute = fs.readFileSync('app/api/breakdowns/[id]/route.ts', 'utf8');
const management = fs.readFileSync('lib/breakdown-management.ts', 'utf8');

test('breakdown provider UI has one provider workflow with add-provider fields', () => {
  assert.match(page, /\+ Add Service Provider/);
  assert.match(page, /Company Name/);
  assert.match(page, /City/);
  assert.match(page, /State/);
  assert.match(page, /ZIP/);
  assert.doesNotMatch(page, />\s*Service \/ Tow Company\s*</);
  assert.doesNotMatch(page, />\s*Phone Number\s*\n\s*<input[^>]*draft\.serviceProviderPhone/);
});

test('provider API creates or reactivates a city/state provider safely', () => {
  assert.match(providerRoute, /export async function POST/);
  assert.match(providerRoute, /ON CONFLICT\(name, phone, city, state, zip\) DO UPDATE SET/);
  assert.match(providerRoute, /source, updated_at/);
  assert.match(providerRoute, /Enter a 2-letter state abbreviation/);
});

test('manager can clear an open report as not a breakdown without deleting history', () => {
  assert.match(page, /Clear — Not a Breakdown/);
  assert.match(breakdownRoute, /clearBreakdownAsNotBreakdown/);
  assert.match(management, /status = 'not_breakdown'/);
  assert.match(management, /status = 'Cancelled'/);
  assert.match(management, /env\.DB\.batch/);
  assert.match(management, /ROADSIDE BREAKDOWN CLEARED/);
  assert.match(management, /no roadside response required/);
});
