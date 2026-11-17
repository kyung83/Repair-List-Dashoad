import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const shop = readFileSync(new URL('../app/api/shop/original.ts', import.meta.url), 'utf8');
const board = readFileSync(new URL('../app/api/repair-board/original.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/shop/page-v2.tsx', import.meta.url), 'utf8');

test('My Work excludes roadside-breakdown repair rows at the shop data source',()=>{
  assert.match(shop,/LOWER\(TRIM\(COALESCE\(r\.source,''\)\)\) <> 'roadside-breakdown'/);
  assert.match(shop,/AND COALESCE\(r\.source,''\) <> 'shop-duty'/);
});

test('previously started roadside labor is retained until the technician can safely end the session',()=>{
  assert.match(shop,/SELECT 1 FROM repair_labor_timers visible_timer/);
  assert.match(shop,/visible_timer\.repair_id=r\.id AND visible_timer\.user_id=\?/);
  // Timer owner id is bound before the technician sort parameter, matching the SQL.
  assert.match(shop,/\.bind\(user\.id, user\.technicianId \?\? -1\)\.all/);
  assert.match(page,/data\.repairs\.find\(repair=>repair\.id===data\.activeTimer\?\.repairId\)/);
});

test('this filters My Work only, preserving repair board and roadside history',()=>{
  assert.match(board,/FROM repairs r/);
  assert.match(board,/roadside-breakdown/);
  assert.match(page,/fetch\("\/api\/shop",\{cache:"no-store"\}\)/);
});
