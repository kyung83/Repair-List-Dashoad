import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('driver follow-up receives service provider and ETA only after token verification',async()=>{
  const route=await read('app/api/breakdowns/driver/route.ts');
  assert.match(route,/getDriverBreakdownFollowup\(breakdownId,token\)/);
  assert.match(route,/SELECT service_provider,service_provider_phone,eta,updated_at/);
  assert.match(route,/serviceProvider:String\(dispatch\?\.service_provider/);
  assert.match(route,/serviceProviderPhone:String\(dispatch\?\.service_provider_phone/);
  assert.match(route,/eta:String\(dispatch\?\.eta/);
  const getSection=route.slice(route.indexOf('export async function GET'),route.indexOf('export async function PATCH'));
  assert.ok(getSection.indexOf('getDriverBreakdownFollowup(breakdownId,token)')<getSection.indexOf('withDispatch(breakdownId,verified)'));
});

test('driver waiting screen automatically refreshes and displays dispatch notice above arrival control',async()=>{
  const page=await read('app/report-breakdown/driver-followup.tsx');
  assert.match(page,/serviceProvider:string/);
  assert.match(page,/serviceProviderPhone:string/);
  assert.match(page,/eta:string/);
  assert.match(page,/window\.setInterval\(\(\)=>void load\(true\),10000\)/);
  assert.match(page,/visibilitychange/);
  assert.match(page,/SERVICE UPDATE/);
  assert.match(page,/Roadside help is on the way/);
  assert.match(page,/Service Provider:/);
  assert.match(page,/ETA:/);
  assert.match(page,/Provider Phone:/);
  assert.match(page,/service provider and ETA will appear here automatically/);
  assert.ok(page.indexOf('SERVICE UPDATE')<page.indexOf("onClick={()=>void action('tech_arrived')}"));
});
