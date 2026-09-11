import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shopRoute = readFileSync(new URL('../app/api/shop/route.ts', import.meta.url), 'utf8');
const geotab = readFileSync(new URL('../lib/geotab.ts', import.meta.url), 'utf8');

test('mechanic REPAIRED action closes linked DVIR in Geotab before shop completion', () => {
  assert.match(shopRoute, /markGeotabDefectRepaired/);
  assert.match(shopRoute, /action === 'repairOutcome'.*outcome.*repaired/s);
  assert.match(shopRoute, /r\.geotab_defect_id/);
  assert.match(shopRoute, /d\.geotab_log_id/);
  assert.match(shopRoute, /repair_labor_timers WHERE user_id/);

  const geotabCall = shopRoute.indexOf('await markGeotabDefectRepaired');
  const legacyCompletion = shopRoute.indexOf('const response = await legacyPOST(request)');
  assert.ok(geotabCall >= 0, 'linked DVIR must call Geotab');
  assert.ok(legacyCompletion > geotabCall, 'Geotab must be updated before local shop completion');
});

test('Geotab DVIR repair sends required repaired fields', () => {
  assert.match(geotab, /target\.repairStatus = 'Repaired'/);
  assert.match(geotab, /target\.repairDateTime = new Date\(\)\.toISOString\(\)/);
  assert.match(geotab, /target\.repairUser = \{ id: repairUserId \}/);
  assert.match(geotab, /markDvirRepairedLocal/);
});

test('Geotab failure leaves mechanic repair open with labor timer running', () => {
  assert.match(shopRoute, /Geotab could not mark this DVIR repaired/);
  assert.match(shopRoute, /shop repair is still open and your labor timer is still running/);
  assert.match(shopRoute, /geotab_dvir_repair_failed/);
});

test('ordinary non-DVIR repairs continue through the existing shop completion flow', () => {
  assert.match(shopRoute, /if \(!defectId\) return \{ linked:false, geotabRepaired:false \}/);
  assert.match(shopRoute, /if \(!response\.ok \|\| !dvir\.linked\) return response/);
});
