import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = (path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const current = read('app/shop/current-work-home.tsx');
const page = read('app/shop/page-v2.tsx');
const banner = read('app/shop/yard-scope-banner.tsx');
const found = read('app/shop/found-repair-control.tsx');
const notes = read('app/shop/technician-repair-tools-v2.tsx');

test('only Logan account hides the informational work-yard notice; all yard authorization remains intact',()=>{
  assert.match(banner,/user\.id===29&&user\.username==="loganr"&&user\.role==="mechanic"/);
  assert.match(page,/data\?\.user\.id===29&&data\.user\.username==="loganr"&&data\.user\.role==="mechanic"/);
  assert.doesNotMatch(page,/LOGAN PILOT ·/);
  assert.doesNotMatch(current,/LOGAN PILOT ·/);
  assert.match(banner,/No work yard is assigned/);
});

test('pilot has a single compact working header while the original view is preserved for other technicians',()=>{
  assert.match(current,/\{!pilot&&<section style=\{unitStrip\}>/);
  assert.match(current,/MY WORK · WORKING NOW/);
  assert.match(current,/pilot&&!noUnit/);
  assert.match(current,/minHeight:82/);
  assert.match(current,/compact=\{pilot\}/);
  assert.match(current,/!pilot&&maintenanceBlock/);
});

test('tire-position controls and blocking guard stay within the same action grid as REPAIRED',()=>{
  const grid = current.indexOf('<section id={pilot?"pilot-actions"');
  const end = current.indexOf('</section>', grid);
  const region = current.slice(grid,end);
  assert.ok(grid>0 && end>grid);
  assert.match(region,/onClick=\{props\.onRepaired\}/);
  assert.match(region,/<FoundRepairControl repairId=\{repair\.id\}/);
  assert.ok(region.indexOf('onClick={props.onRepaired}')<region.indexOf('<FoundRepairControl'));
  assert.equal((current.match(/<FoundRepairControl repairId=\{repair\.id\}/g)||[]).length,1);
  assert.match(found,/const parent=controlRef\.current\?\.parentElement/);
  assert.match(found,/startsWith\("REPAIRED"\)/);
  assert.match(found,/gridRow:"1"/);
});

test('Logan work tools switch within one sticky panel without changing the repair APIs',()=>{
  assert.match(current,/position:"sticky" as const,top:0,zIndex:40/);
  assert.match(current,/role="tablist"/);
  assert.match(current,/setPilotTool\(tool\)/);
  assert.match(current,/aria-selected=\{pilotTool===tool\}/);
  assert.match(current,/hidden=\{pilotTool!=="notes"\}/);
  assert.match(current,/hidden=\{pilotTool!=="parts"\}/);
  assert.match(current,/hidden=\{pilotTool!=="photos"\}/);
  assert.match(current,/hidden=\{pilotTool!=="checklist"\}/);
  assert.match(current,/hidden=\{pilotTool!=="history"\}/);
  assert.match(current,/<LoganPilotAddRepair onSaved=\{props\.onFoundRepairAdded\}/);
  assert.match(current,/!pilot&&maintenanceBlock/);
});

test('compact notes, photos and team are pilot-only; the existing work APIs and operations remain',()=>{
  assert.match(current,/<RepairPhotoControl repairId=\{repair\.id\} canWork compact/);
  assert.match(current,/<TechnicianRepairTools repairId=\{repair\.id\} canWork mode="parts" compact/);
  assert.match(notes,/compact=false/);
  assert.match(notes,/Stock shortages may stop labor/);
  assert.match(read('app/shop/repair-photo-control.tsx'),/compact=false/);
  assert.match(read('app/shop/repair-team-panel.tsx'),/compact=false/);
  assert.match(read('app/shop/maintenance-checklist-panel-v3.tsx'),/mode="notes" compact=\{props\.compact\}/);
  assert.match(current,/onChooseRepair\(item\)/);
  assert.match(current,/padding:"8px 10px"/);
});
