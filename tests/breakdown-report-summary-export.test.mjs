import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const actions = fs.readFileSync("app/reports/breakdowns/report-actions.tsx", "utf8");

test("breakdown report actions expand scrollable summary tables for print", () => {
  assert.match(actions, /max-height:\s*none\s*!important/i);
  assert.match(actions, /overflow:\s*visible\s*!important/i);
  assert.match(actions, /height:\s*auto\s*!important/i);
});

test("breakdown report actions can export all summary tables", () => {
  assert.match(actions, /Export Summary CSV/);
  assert.match(actions, /Breakdown Cost by Unit/);
  assert.match(actions, /Monthly Breakdown Trend/);
  assert.match(actions, /By Breakdown Category/);
  assert.match(actions, /By Service Provider/);
  assert.match(actions, /By Location/);
  assert.match(actions, /downloadSummaryCsv/);
});
