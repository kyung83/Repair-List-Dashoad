import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/reports/breakdowns/page.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../app/reports/breakdowns/report-actions.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/reports/breakdowns/layout.tsx', import.meta.url), 'utf8');

test('breakdown reports expose obvious export and print actions', () => {
  assert.match(actions, /Print \/ Save PDF/);
  assert.match(actions, /Export CSV/);
  assert.match(actions, /Export Summary CSV/);
  assert.match(layout, /BreakdownReportActions/);
  assert.match(layout, /breakdown-report-print-scope/);
});

test('export action reuses the report current filtered and sorted CSV logic', () => {
  assert.match(page, /const csvRows = sorted\.map/);
  assert.match(page, /Export Breakdown CSV/);
  assert.match(actions, /data-breakdown-original-export/);
  assert.match(actions, /button\.click\(\)/);
});

test('print action prints a cleaned clone of the current report only', () => {
  assert.match(actions, /cloneNode\(true\)/);
  assert.match(actions, /cleanPrintClone\(clone\)/);
  assert.match(actions, /root\.querySelectorAll\("nav"\)/);
  assert.match(actions, /replaceFormControlsWithValues/);
  assert.match(actions, /@page \{ size: landscape/);
  assert.match(actions, /printWindow\.print\(\)/);
});

test('each breakdown summary table gets its own export and print controls', () => {
  assert.match(actions, /injectIndividualSummaryActions/);
  assert.match(actions, /downloadOneSummaryCsv/);
  assert.match(actions, /makeMiniButton\("Print \/ Save PDF"/);
  assert.match(actions, /makeMiniButton\("Export CSV"/);
  assert.match(actions, /Breakdown Cost by Unit/);
  assert.match(actions, /Monthly Breakdown Trend/);
  assert.match(actions, /By Breakdown Category/);
  assert.match(actions, /By Service Provider/);
  assert.match(actions, /By Location/);
});

test('breakdown detail is constrained to an internal scroll area with sticky headers', () => {
  assert.match(actions, /configureBreakdownDetailScroller/);
  assert.match(actions, /wrapper\.style\.maxHeight = "560px"/);
  assert.match(actions, /wrapper\.style\.overflowY = "auto"/);
  assert.match(actions, /cell\.style\.position = "sticky"/);
  assert.match(actions, /Scroll inside the detail table to review more breakdowns/);
});
