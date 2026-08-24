import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AI_READING_PROMPT,parseAiReading} from '../app/outside-work/ai-reading-parser.js';

const demo=`
**Dennis Carney "The Original On-Site" Repair Service, Inc.** — Davison, MI
No. 26754

- **Name:** Northern Logistics
- **City/State:** Clare, MI
- **Date:** 8/19 (year unclear)
- **No.:** 360
- **Ordered by:** Carrie (driver)
- **Service:** To Flint, MI / rear warehouse
  - Left headlight inop — replace plug (broken at bulb)
  - Visor lights all out, power to lights, harness taped end to end, open — recommend replacement of harness
  - Headlamp plug
- **Service Call:** $135.00
- **Labor:** $270.00
- **Parts:** $15.00
- **Tax:** $0.90
- **Total:** $420.90
`;

test('pasted AI reading maps the handwritten demo without guessing the unclear year',()=>{
  const parsed=parseAiReading(demo);
  assert.match(parsed.vendor,/Dennis Carney/i);
  assert.equal(parsed.invoiceNumber,'26754');
  assert.equal(parsed.unit,'360');
  assert.equal(parsed.invoiceDate,'');
  assert.equal(parsed.totalAmount,'420.90');
  assert.equal(parsed.costs.serviceCall,'135.00');
  assert.equal(parsed.costs.labor,'270.00');
  assert.equal(parsed.costs.parts,'15.00');
  assert.equal(parsed.costs.tax,'0.90');
  assert.match(parsed.serviceSummary,/Left headlight inop/i);
  assert.match(parsed.serviceSummary,/Cost breakdown: Service call \$135\.00 · Labor \$270\.00 · Parts \$15\.00 · Tax \$0\.90 · Total \$420\.90/);
  assert.ok(parsed.uncertain.some(value=>/Service date|year unclear/i.test(value)));
});

test('standard ChatGPT or Claude response fills all safe labeled fields',()=>{
  const parsed=parseAiReading(`
VENDOR: The Original On-Site Repair Service, Inc.
INVOICE NUMBER: 26754
SERVICE DATE: 2026-08-19
UNIT: 360
MILEAGE: 523114
SERVICE CALL: $135.00
LABOR: $270.00
PARTS: $15.00
TAX: $0.90
TOTAL: $420.90
WORK PERFORMED: Replace broken left headlamp plug and diagnose open visor-light harness.
UNCERTAIN:
`);
  assert.equal(parsed.invoiceDate,'2026-08-19');
  assert.equal(parsed.mileage,'523114');
  assert.equal(parsed.unit,'360');
  assert.equal(parsed.totalAmount,'420.90');
  assert.match(parsed.serviceSummary,/Replace broken left headlamp plug/);
});

test('reading prompt explicitly tells the chat model not to guess',()=>{
  assert.match(AI_READING_PROMPT,/Do not guess or invent anything/i);
  assert.match(AI_READING_PROMPT,/UNCERTAIN/i);
  assert.match(AI_READING_PROMPT,/WORK PERFORMED/i);
});

test('Outside Work mounts a no-API paste helper that writes into the existing review form',async()=>{
  const [page,bridge]=await Promise.all([
    readFile(new URL('../app/outside-work/page.tsx',import.meta.url),'utf8'),
    readFile(new URL('../app/outside-work/ai-reading-bridge.tsx',import.meta.url),'utf8'),
  ]);
  assert.match(page,/AiReadingBridge/);
  assert.match(bridge,/PASTE AI READING/);
  assert.match(bridge,/COPY READING PROMPT/);
  assert.match(bridge,/APPLY TO OUTSIDE WORK/);
  assert.match(bridge,/input\[placeholder="Unit number"\]/);
  assert.match(bridge,/Dealer \/ repair shop/);
  assert.doesNotMatch(bridge,/fetch\(/);
});
