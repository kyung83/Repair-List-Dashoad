import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const route=readFileSync(new URL('../app/api/shop/unit-history/route.ts',import.meta.url),'utf8');
const panel=readFileSync(new URL('../app/shop/mechanic-unit-history.tsx',import.meta.url),'utf8');
const currentWork=readFileSync(new URL('../app/shop/current-work-home.tsx',import.meta.url),'utf8');

test('mechanic unit history is limited to the repair that is WORKING NOW',()=>{
  assert.match(route,/FROM repair_labor_timers/);
  assert.match(route,/Number\(active\.repair_id\)!==currentRepairId/);
  assert.match(route,/This repair is not assigned to you/);
});

test('mechanic history response does not return technician identity metadata',()=>{
  assert.match(route,/privacy:\{technicianIdentityIncluded:false\}/);
  assert.doesNotMatch(route,/technician_name/);
  assert.doesNotMatch(route,/uploadedBy/);
  assert.doesNotMatch(route,/uploadedByUserId/);
  assert.match(route,/fileName:'Repair photo'/);
  assert.match(route,/historyPhotoUrl\(currentRepairId,row\.photo_key\)/);
  assert.match(route,/content-disposition','inline'/);
  assert.match(route,/redactIdentity\(row\.detail,identitiesList\)/);
});

test('mechanic history includes repair notes parts photos and historical ROs',()=>{
  assert.match(route,/action='technician_note'/);
  assert.match(route,/FROM repair_parts rp/);
  assert.match(route,/FROM repair_work_photos/);
  assert.match(route,/FROM maintenance_checklist_photos/);
  assert.match(route,/FROM repair_type_checklist_photos/);
  assert.match(route,/FROM historical_repairs h/);
});

test('Current Work shows related all and PM Annual history without leaving the job',()=>{
  assert.match(currentWork,/MechanicUnitHistory/);
  assert.match(panel,/id="unit-work-history"/);
  assert.match(panel,/RELATED \(\{relatedCount\}\)/);
  assert.match(panel,/ALL HISTORY \(\{totalCount\}\)/);
  assert.match(panel,/PM \/ ANNUAL \(\{maintenanceCount\}\)/);
  assert.match(panel,/POSSIBLE REPEAT REPAIR/);
  assert.match(panel,/Search history/);
});
