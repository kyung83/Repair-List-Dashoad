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

test('driver second screen has exactly Tech Has Arrived, Upload Receipt, and one combined Repair Finished Rolling control',async()=>{
  const page=await read('app/report-breakdown/driver-followup.tsx');
  assert.match(page,/BREAKDOWN SUBMITTED/);
  assert.match(page,/Tech Has Arrived/);
  assert.match(page,/Upload Receipt/);
  assert.match(page,/Repair Finished \/ Rolling/);
  assert.doesNotMatch(page,/action\('repair_finished'\)/);
  assert.match(page,/receiptInputRef\.current\?\.click\(\)/);
  assert.match(page,/onChange=\{\(event\)=>void uploadReceipt/);
  assert.match(page,/disabled=\{busy!==''\|\|!arrived\|\|rolling/);
  assert.match(page,/window\.setTimeout\(\(\)=>onReportAnother\(\),650\)/);
  assert.match(page,/Receipt upload is optional/);
});

test('an already rolling or closed breakdown automatically returns to a fresh report form',async()=>{
  const page=await read('app/report-breakdown/driver-followup.tsx');
  assert.match(page,/payload\.breakdown\.rollingAt\|\|payload\.breakdown\.closed/);
  assert.match(page,/payload\.breakdown\.status==='not_breakdown'/);
  assert.match(page,/payload\.breakdown\.status==='complete'/);
  assert.match(page,/onReportAnother\(\);\n\s+return;/);
});

test('tech arrival and rolling send idempotent replies to the original breakdown email thread',async()=>{
  const lib=await read('lib/breakdown-driver-followup.ts');
  assert.match(lib,/notifyBreakdownEmailGroup/);
  assert.match(lib,/TECH HAS ARRIVED/);
  assert.match(lib,/DRIVER IS ROLLING/);
  assert.match(lib,/`Breakdown - \$\{row\.driver_name\}`/);
  assert.match(lib,/WHERE id=\? AND tech_arrived_at IS NULL/);
  assert.match(lib,/WHERE id=\? AND rolling_at IS NULL/);
  assert.match(lib,/Number\(result\.meta\.changes\|\|0\)===1/);
  assert.match(lib,/sendDriverProgressEmail\(updated,'tech_arrived'\)/);
  assert.match(lib,/sendDriverProgressEmail\(updated,'rolling'\)/);
});

test('rolling follows tech arrival, marks repair finished internally, and stays ready for office review',async()=>{
  const lib=await read('lib/breakdown-driver-followup.ts');
  assert.match(lib,/if\(!row\.tech_arrived_at\)throw new Error\('Tap Tech Has Arrived first\.'/);
  const rollingSection=lib.slice(lib.indexOf("action==='rolling'"),lib.indexOf("}else{\n    throw new Error('Unknown driver breakdown action.')",lib.indexOf("action==='rolling'")));
  assert.match(rollingSection,/repair_finished_at=COALESCE\(repair_finished_at,CURRENT_TIMESTAMP\)/);
  assert.match(rollingSection,/driver_status='rolling'/);
  assert.match(rollingSection,/status='ready_for_review'/);
  assert.match(rollingSection,/stage=CASE WHEN stage<4 THEN 4 ELSE stage END/);
  assert.doesNotMatch(rollingSection,/Tap Repair Finished first/);
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
