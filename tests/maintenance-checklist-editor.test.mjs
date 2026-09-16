import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('checklist editor schema versions PM and Annual templates without rewriting old runs',async()=>{
  const migration=await read('migrations/0138_maintenance_checklist_templates.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS maintenance_checklist_templates/);
  assert.match(migration,/UNIQUE \(event_type, template_key, version\)/);
  assert.match(migration,/ALTER TABLE maintenance_checklist_runs ADD COLUMN template_version/);
  assert.match(migration,/trg_snapshot_published_checklist_after_run/);
  assert.match(migration,/AFTER INSERT ON maintenance_checklist_runs/);
  assert.match(migration,/trg_block_legacy_items_for_versioned_checklist/);
});

test('published checklist items can control answers and required proof',async()=>{
  const migration=await read('migrations/0138_maintenance_checklist_templates.sql');
  assert.match(migration,/allow_pass INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration,/allow_fail INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration,/allow_na INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration,/require_notes INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration,/require_photo INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration,/require_measurement INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration,/A photo is required for this checklist item/);
  assert.match(migration,/A measurement is required for this checklist item/);
});

test('checklist template API is manager-only and publishes a new version',async()=>{
  const route=await read('app/api/maintenance-checklist-templates/route.ts');
  const helper=await read('lib/maintenance-checklist-templates.ts');
  assert.match(route,/user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(route,/action[\s\S]*publish/);
  assert.match(route,/publishChecklistTemplate/);
  assert.match(helper,/MAX\(version\)/);
  assert.match(helper,/active = 0/);
  assert.match(helper,/active = 1/);
});

test('technician checklist question loads configured requirements and saves measurements',async()=>{
  const question=await read('app/shop/inspection-question.tsx');
  const fieldRoute=await read('app/api/maintenance-checklist-item/route.ts');
  assert.match(question,/maintenance-checklist-item\?itemId/);
  assert.match(question,/requireNotes/);
  assert.match(question,/requirePhoto/);
  assert.match(question,/requireMeasurement/);
  assert.match(question,/allowPass/);
  assert.match(question,/allowFail/);
  assert.match(question,/allowNa/);
  assert.match(fieldRoute,/setMeasurement/);
  assert.match(fieldRoute,/measurement_value/);
});

test('manager navigation exposes the PM and Annual checklist editor',async()=>{
  const navigation=await read('app/navigation-config.ts');
  const page=await read('app/maintenance-checklists/editor-client.tsx');
  assert.match(navigation,/href:\s*"\/maintenance-checklists",\s*label:\s*"PM & Annual Checklists"/);
  assert.match(page,/Publish New Version/);
  assert.match(page,/Add Section/);
  assert.match(page,/Require photo/);
  assert.match(page,/Require measurement/);
});
