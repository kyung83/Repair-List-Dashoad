import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('driver follow-up uses an opaque hashed token and fixed public endpoint',async()=>{
  const [migration,lib,route,worker,submit]=await Promise.all([
    read('migrations/0111_breakdown_driver_followup_receipts.sql'),
    read('lib/breakdown-driver-followup.ts'),
    read('app/api/breakdowns/driver/route.ts'),
    read('worker/index.ts'),
    read('app/api/breakdowns/route.ts'),
  ]);
  assert.match(migration,/driver_access_token_hash TEXT/);
  assert.doesNotMatch(migration,/driver_access_token\s+TEXT(?!_hash)/);
  assert.match(lib,/crypto\.getRandomValues/);
  assert.match(lib,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(lib,/driver_access_token_hash=\?/);
  assert.match(route,/verified|recordDriverBreakdownAction/);
  assert.match(worker,/'\/api\/breakdowns\/driver'/);
  assert.match(submit,/issueDriverAccessToken\(breakdownId\)/);
  assert.match(submit,/driverToken/);
});

test('driver page has the exact three sequential roadside progress buttons',async()=>{
  const page=await read('app/report-breakdown/driver-followup.tsx');
  assert.match(page,/Tech Has Arrived/);
  assert.match(page,/Repair Finished/);
  assert.match(page,/Rolling/);
  assert.match(page,/disabled=\{busy!==''\|\|!arrived\|\|repaired/);
  assert.match(page,/disabled=\{busy!==''\|\|!repaired\|\|rolling/);
  assert.match(page,/Northern will review and close the breakdown/);
});

test('rolling is ready for review and does not directly complete the linked repair',async()=>{
  const lib=await read('lib/breakdown-driver-followup.ts');
  assert.match(lib,/driver_status='rolling'/);
  assert.match(lib,/status='ready_for_review'/);
  assert.match(lib,/stage=CASE WHEN stage<4 THEN 4 ELSE stage END/);
  const rollingSection=lib.slice(lib.indexOf("action==='rolling'"),lib.indexOf('return getDriverBreakdownFollowup',lib.indexOf("action==='rolling'")));
  assert.doesNotMatch(rollingSection,/status='Completed'/);
  assert.doesNotMatch(rollingSection,/stage=5/);
});

test('optional receipt uses the same Outside Work AI reader and preserves the original for review',async()=>{
  const [driverLib,sharedReader,migration]=await Promise.all([
    read('lib/breakdown-driver-followup.ts'),
    read('lib/outside-work-ai-reader.ts'),
    read('migrations/0111_breakdown_driver_followup_receipts.sql'),
  ]);
  assert.match(driverLib,/readOutsideWorkInvoice/);
  assert.match(driverLib,/roadside-breakdown-receipts\//);
  assert.match(driverLib,/env\.FILES\.put/);
  assert.match(driverLib,/ai_status='failed'/);
  assert.match(sharedReader,/openai\/gpt-5\.6-sol/);
  assert.match(sharedReader,/@cf\/qwen\/qwen3\.8-27b/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS roadside_breakdown_receipts/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS roadside_breakdown_receipt_pages/);
  assert.match(migration,/review_status TEXT NOT NULL DEFAULT 'pending'/);
});

test('office must confirm before the breakdown and linked repair close',async()=>{
  const [lib,panel,page]=await Promise.all([
    read('lib/breakdown-driver-followup.ts'),
    read('app/breakdowns/driver-receipt-review.tsx'),
    read('app/breakdowns/page.tsx'),
  ]);
  assert.match(lib,/if\(!row\.rolling_at\)throw new Error\('The driver has not marked Rolling yet\.'/);
  assert.match(lib,/review_status='confirmed'/);
  assert.match(lib,/UPDATE roadside_breakdowns SET stage=5,status='complete'/);
  assert.match(lib,/UPDATE repairs SET status='Completed'/);
  assert.match(panel,/Confirm & Close Breakdown/);
  assert.match(panel,/Receipt Review/);
  assert.match(page,/DriverReceiptReview/);
  assert.doesNotMatch(page,/row\.stage < 5 && <button[^>]*Advance to/s);
});

test('driver follow-up survives refresh without storing a raw token in D1',async()=>{
  const [page,migration]=await Promise.all([
    read('app/report-breakdown/page.tsx'),
    read('migrations/0111_breakdown_driver_followup_receipts.sql'),
  ]);
  assert.match(page,/norlow-active-driver-breakdown/);
  assert.match(page,/window\.localStorage\.setItem/);
  assert.match(page,/window\.localStorage\.getItem/);
  assert.match(page,/DriverFollowup/);
  assert.doesNotMatch(migration,/driverToken/);
});
