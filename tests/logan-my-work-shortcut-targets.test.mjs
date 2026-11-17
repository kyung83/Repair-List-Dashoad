import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const work=readFileSync(new URL('../app/shop/current-work-home.tsx',import.meta.url),'utf8');
const checklist=readFileSync(new URL('../app/shop/maintenance-checklist-panel-v3.tsx',import.meta.url),'utf8');

test('Logan pilot work tabs have correctly linked targets, with original tools mounted',()=>{
  assert.match(work,/role="tablist"/);
  assert.match(work,/aria-controls=\{`pilot-panel-\$\{tool\}`\}/);
  assert.match(work,/onClick=\{\(\)=>setPilotTool\(tool\)\}/);
  for(const target of ['notes','parts','photos','checklist','history']){
    assert.ok(work.includes(`id="pilot-panel-${target}"`));
    assert.ok(work.includes(`aria-labelledby="pilot-tab-${target}"`));
  }
  assert.match(work,/<TechnicianRepairTools repairId=\{repair\.id\} canWork mode="notes" compact\/>/);
  assert.match(work,/<TechnicianRepairTools repairId=\{repair\.id\} canWork mode="parts" compact\/>/);
  assert.match(work,/<RepairPhotoControl repairId=\{repair\.id\} canWork compact\/>/);
  assert.match(work,/<MechanicUnitHistory repairId=\{repair\.id\} unit=\{repair\.unit\} currentIssue=\{repair\.issue\}\/>/);
  assert.match(work,/maintenanceBlock\?\?/);
});

test('classic notes and existing PM annual checklist stay mounted and unchanged',()=>{
  assert.match(checklist,/showNotes\?:boolean/);
  assert.match(checklist,/props\.showNotes!==false/);
  assert.match(checklist,/mode="notes" compact=\{props\.compact\}/);
  assert.match(work,/showNotes=\{!pilot\}/);
  assert.match(work,/!pilot&&partsAndLaborPanel/);
  assert.match(work,/!pilot&&maintenanceBlock/);
});

test('Logan can reach other repairs immediately and change tools without changing job selection',()=>{
  const other=work.indexOf('id="pilot-other-repairs"');
  const actions=work.indexOf('<section id={pilot?"pilot-actions"');
  const tab=work.indexOf('id="pilot-workspace"');
  assert.ok(other>0 && other<actions && actions<tab);
  assert.match(work,/onChooseRepair\(item\)/);
  assert.match(work,/defaultOpen style=\{pilotOtherCard\}/);
  assert.match(work,/setPilotTool\(tool\)/);
  assert.match(work,/display:pilotTool==="notes"\?"grid":"none"/);
  assert.match(work,/display:pilotTool==="checklist"\?"grid":"none"/);
});
