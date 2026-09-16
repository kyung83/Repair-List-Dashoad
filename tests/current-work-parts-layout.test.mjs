import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const currentWork=readFileSync(new URL('../app/shop/current-work-home.tsx',import.meta.url),'utf8');
const maintenance=readFileSync(new URL('../app/shop/maintenance-checklist-panel-v3.tsx',import.meta.url),'utf8');
const tools=readFileSync(new URL('../app/shop/technician-repair-tools-v2.tsx',import.meta.url),'utf8');

test('Current Work puts part lookup directly below repair photos',()=>{
  const photoIndex=currentWork.indexOf('<RepairPhotoControl');
  const partIndex=currentWork.indexOf('mode="parts"');
  assert.ok(photoIndex>=0&&partIndex>photoIndex);
  assert.doesNotMatch(currentWork,/Open Repair on This Unit/);
});

test('repair switching stays available only when another open repair exists',()=>{
  assert.match(currentWork,/const otherRepairs=unitRepairs\.filter/);
  assert.match(currentWork,/otherRepairs\.length>0/);
  assert.match(currentWork,/Other Repairs on This Unit/);
  assert.match(currentWork,/onChooseRepair\(item\)/);
});

test('notes remain below the maintenance launcher while parts can render separately',()=>{
  assert.match(maintenance,/mode="notes"/);
  assert.match(tools,/mode\?:"all"\|"notes"\|"parts"/);
  assert.match(tools,/showNotes=mode!=="parts"/);
  assert.match(tools,/showParts=mode!=="notes"/);
});

test('Current Work removes most of the blank gap before final review',()=>{
  assert.match(currentWork,/padding:"18px clamp\(10px,2vw,20px\) 36px"/);
});
