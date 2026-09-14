import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/shop/page.tsx',import.meta.url),'utf8');
const tools=readFileSync(new URL('../app/shop/technician-repair-tools-v2.tsx',import.meta.url),'utf8');
const shopRoute=readFileSync(new URL('../app/api/shop/route.ts',import.meta.url),'utf8');
const unmatchedRoute=readFileSync(new URL('../app/api/shop/unmatched-part/route.ts',import.meta.url),'utf8');

test('mobile repair actions no longer require a separate Waiting on Part outcome button',()=>{
  assert.doesNotMatch(page,/style=\{waitingButton\}/);
  assert.match(page,/<strong>REPAIRED<\/strong><span style=\{outcomeHint\}>/);
  assert.match(page,/<strong>SKIP FOR NOW<\/strong><span style=\{outcomeHint\}>/);
  assert.match(page,/const outcomeBase=\{[^\n]*display:"grid",gap:4/);
});

test('catalog Part Lookup keeps working when stock exists and auto-waits when stock is short',()=>{
  assert.match(shopRoute,/stock\.available \+ 0\.000001 >= quantity/);
  assert.match(shopRoute,/applyPartToRepair/);
  assert.match(shopRoute,/requestPartDerived/);
  assert.match(shopRoute,/autoWaitAfterPartShortage/);
  assert.match(shopRoute,/action:'repairOutcome'/);
  assert.match(shopRoute,/outcome:'waiting_part'/);
  assert.match(shopRoute,/awaitingParts:true/);
});

test('automatic waiting reuses the normal repair outcome so labor is saved and next work can start',()=>{
  assert.match(shopRoute,/legacyPOST\(waitingRequest\)/);
  assert.match(shopRoute,/Part shortage requested from Part Lookup/);
  assert.match(tools,/automatically saves labor and moves the repair to Waiting on Part/);
  assert.match(tools,/shop-jobs-refresh/);
  assert.match(page,/addEventListener\("shop-jobs-refresh"/);
});

test('typed unmatched part requests also auto-wait instead of requiring another technician button',()=>{
  assert.match(unmatchedRoute,/autoWaitAfterRequest/);
  assert.match(unmatchedRoute,/action:'repairOutcome'/);
  assert.match(unmatchedRoute,/outcome:'waiting_part'/);
  assert.match(unmatchedRoute,/awaitingParts:true/);
});

test('working managers and admins can use the same unmatched part request flow as mechanics',()=>{
  assert.match(unmatchedRoute,/\['mechanic','manager','admin'\]\.includes\(user\.role\)/);
  assert.match(unmatchedRoute,/!user\.technicianId/);
  assert.match(unmatchedRoute,/This repair is not assigned to you/);
  assert.doesNotMatch(unmatchedRoute,/user\.role !== 'mechanic'/);
});

test('unmatched part requests resolve a shop from live Geotab yard before legacy and user fallbacks',()=>{
  assert.match(unmatchedRoute,/equipment_geotab_devices/);
  assert.match(unmatchedRoute,/geotab_unit_state/);
  assert.match(unmatchedRoute,/COALESCE\(s\.yard,''\) AS live_yard/);
  assert.match(unmatchedRoute,/COALESCE\(u\.yard,''\) AS user_yard/);
  assert.match(unmatchedRoute,/fallbackYard:repair\.live_yard \|\| repair\.current_yard \|\| repair\.repair_location \|\| repair\.user_yard/);
});

test('unmatched part auto-wait does not clone the request after its JSON body has been consumed',()=>{
  assert.match(unmatchedRoute,/const requestContext:RequestContext = \{[\s\S]*headers:new Headers\(request\.headers\)/);
  assert.match(unmatchedRoute,/const body = await request\.json\(\)/);
  assert.match(unmatchedRoute,/autoWaitAfterRequest\([\s\S]*requestContext/);
  assert.doesNotMatch(unmatchedRoute,/request\.clone\(\)/);
});

test('automatic waiting does not delete used inventory or existing part demand',()=>{
  assert.doesNotMatch(shopRoute,/DELETE FROM repair_parts/);
  assert.doesNotMatch(shopRoute,/DELETE FROM repair_part_requests/);
  assert.doesNotMatch(unmatchedRoute,/DELETE FROM repair_parts/);
  assert.doesNotMatch(unmatchedRoute,/DELETE FROM repair_part_requests/);
});
