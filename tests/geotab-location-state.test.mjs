import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyGeotabLocationState } from '../lib/geotab-location-state.js';

const now=Date.parse('2026-08-21T16:00:00Z');

function state(overrides={}){
  return classifyGeotabLocationState({
    hasAssignment:true,equipmentType:'truck',gpsObservedAt:'2026-08-21T15:55:00Z',
    communicating:true,yard:'clare',...overrides,
  },now);
}

test('old GPS in a known yard is parked/confirmed, not a dead tracker',()=>{
  const result=state({gpsObservedAt:'2026-08-21T12:00:00Z',communicating:null,yard:'clare'});
  assert.equal(result.code,'PARKED_CONFIRMED');
  assert.equal(result.stale,true);
  assert.equal(result.actuallyNotTracking,false);
  assert.equal(result.locationUsable,true);
});

test('Geotab communicating=false is the only actual not-tracking state',()=>{
  const result=state({gpsObservedAt:'2026-08-21T12:00:00Z',communicating:false,yard:'clare'});
  assert.equal(result.code,'NOT_TRACKING');
  assert.equal(result.actuallyNotTracking,true);
  assert.equal(result.locationUsable,true);
});

test('old location outside a yard remains last-known rather than being erased',()=>{
  const result=state({gpsObservedAt:'2026-08-21T12:00:00Z',communicating:null,yard:''});
  assert.equal(result.code,'STALE_LAST_KNOWN');
  assert.equal(result.stale,true);
  assert.equal(result.actuallyNotTracking,false);
  assert.equal(result.locationUsable,true);
});

test('assigned device with no position is separate from offline and stale',()=>{
  const result=state({gpsObservedAt:null,communicating:null,yard:''});
  assert.equal(result.code,'NO_GPS_DATA');
  assert.equal(result.stale,false);
  assert.equal(result.actuallyNotTracking,false);
  assert.equal(result.locationUsable,false);
});

test('missing current assignment is explicitly unmapped',()=>{
  const result=state({hasAssignment:false,gpsObservedAt:null,communicating:null,yard:''});
  assert.equal(result.code,'UNMAPPED');
  assert.equal(result.actuallyNotTracking,false);
});

test('worker uses LogRecord feed on the two-hour schedule and no longer schedules the destructive legacy yard writer',async()=>{
  const worker=await readFile(new URL('../worker/index.ts',import.meta.url),'utf8');
  const wrangler=await readFile(new URL('../wrangler.template.jsonc',import.meta.url),'utf8');
  assert.match(worker,/syncGeotabGpsFeed/);
  assert.doesNotMatch(worker,/syncGeotabGpsShadow/);
  assert.doesNotMatch(worker,/syncGeotabYardPresence/);
  assert.match(worker,/controller\.cron === '0 \*\/2 \* \* \*'/);
  assert.match(wrangler,/"0 \*\/2 \* \* \*"/);
  assert.doesNotMatch(worker,/controller\.cron === '\* \* \* \* \*'/);
  assert.doesNotMatch(wrangler,/"\* \* \* \* \*"/);
});

test('feed mirrors persistent state without clearing every yard first',async()=>{
  const feed=await readFile(new URL('../lib/geotab-gps-feed.ts',import.meta.url),'utf8');
  assert.match(feed,/typeName:'LogRecord'/);
  assert.match(feed,/fromVersion/);
  assert.match(feed,/geotab_feed_cursors/);
  assert.match(feed,/syncGeotabLocationMirror/);
  assert.doesNotMatch(feed,/SET current_yard = '', current_yard_zone = ''/);
});
