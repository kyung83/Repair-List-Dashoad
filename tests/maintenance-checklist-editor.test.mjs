import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('checklist editor schema versions PM and Annual templates without D1 triggers',async()=>{
  const migration=await read('migrations/0138_maintenance_checklist_templates.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS maintenance_checklist_templates/);
  assert.match(migration,/UNIQUE \(event_type, template_key, version\)/);
  assert.match(migration,/ALTER TABLE maintenance_checklist_runs ADD COLUMN template_version/);
  assert.match(migration,/allow_pass INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration,/require_photo INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(migration,/CREATE\s+TRIGGER/i);
});

test('truck and trailer assignments are additive and default to the existing checklist',async()=>{
  const migration=await read('migrations/0141_maintenance_checklist_template_assignments.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS maintenance_checklist_template_assignments/);
  assert.match(migration,/applies_to TEXT NOT NULL CHECK \(applies_to IN \('truck','trailer'\)\)/);
  assert.match(migration,/PRIMARY KEY \(event_type, applies_to\)/);
  assert.match(migration,/\('pm', 'truck', 'default'\)/);
  assert.match(migration,/\('pm', 'trailer', 'default'\)/);
  assert.match(migration,/\('annual', 'truck', 'default'\)/);
  assert.match(migration,/\('annual', 'trailer', 'default'\)/);
  assert.doesNotMatch(migration,/CREATE\s+TRIGGER/i);
  assert.doesNotMatch(migration,/ALTER\s+TABLE/i);
});

test('new runs choose the assigned template from equipment type while existing runs are left alone',async()=>{
  const route=await read('app/api/maintenance-checklist/route.ts');
  assert.match(route,/const existing = await loadRun\(repair\.id\);[\s\S]*if \(existing\) return existing/);
  assert.match(route,/e\.equipment_type/);
  assert.match(route,/equipment_type: string \| null/);
  assert.match(route,/getAssignedChecklistTemplate/);
  assert.match(route,/equipment_type[\s\S]*=== 'trailer' \? 'trailer' : 'truck'/);
  assert.match(route,/await env\.DB\.batch\(\[/);
  assert.match(route,/INSERT OR IGNORE INTO maintenance_checklist_runs/);
  assert.match(route,/JOIN maintenance_checklist_template_items i ON i\.template_id = \?/);
  assert.match(route,/r\.template_id = \?/);
});

test('not-started checklist preview uses the same assigned template technicians will start',async()=>{
  const route=await read('app/api/maintenance-checklist/route.ts');
  const payloadStart=route.indexOf('async function payloadFor');
  const payloadEnd=route.indexOf('export async function GET',payloadStart);
  const payload=route.slice(payloadStart,payloadEnd);
  assert.match(payload,/getAssignedChecklistTemplate/);
  assert.match(payload,/template\.items\.filter\(\(item\) => item\.enabled\)/);
  assert.doesNotMatch(payload,/checklistFor\(kind\)/);
});

test('published checklist answers and required proof are enforced by the Worker and at completion',async()=>{
  const route=await read('app/api/maintenance-checklist/route.ts');
  assert.match(route,/Pass is not allowed for this checklist item/);
  assert.match(route,/Fail is not allowed for this checklist item/);
  assert.match(route,/N\/A is not allowed for this checklist item/);
  assert.match(route,/A note is required for this checklist item/);
  assert.match(route,/A photo is required for this checklist item/);
  assert.match(route,/A measurement is required for this checklist item/);
  assert.match(route,/missing_notes/);
  assert.match(route,/missing_measurement/);
  assert.match(route,/missing_photo/);
  assert.match(route,/Validate the run's own item snapshot/);
});

test('required photo delete is atomic in D1 and removes R2 only after the row is gone',async()=>{
  const route=await read('app/api/maintenance-checklist/route.ts');
  const start=route.indexOf("if (action === 'removePhoto')");
  const end=route.indexOf("if (action === 'markReady')",start);
  assert.ok(start>=0&&end>start,'removePhoto block must exist');
  const block=route.slice(start,end);
  const d1Delete=block.indexOf('DELETE FROM maintenance_checklist_photos');
  const r2Delete=block.indexOf('env.FILES.delete');
  assert.ok(d1Delete>=0&&r2Delete>d1Delete,'D1 row must be deleted before R2');
  assert.match(block,/other\.id <> maintenance_checklist_photos\.id/);
  assert.match(block,/removed\.meta\.changes/);
});

test('corrective migration removes every editor trigger regardless of partial production state',async()=>{
  const migration0139=await read('migrations/0139_checklist_required_photo_guard.sql');
  const corrective=await read('migrations/0140_checklist_editor_trigger_cleanup.sql');
  assert.doesNotMatch(migration0139,/CREATE\s+TRIGGER/i);
  assert.match(corrective,/DROP TRIGGER IF EXISTS trg_snapshot_published_checklist_after_run/);
  assert.match(corrective,/DROP TRIGGER IF EXISTS trg_block_legacy_items_for_versioned_checklist/);
  assert.match(corrective,/DROP TRIGGER IF EXISTS trg_validate_versioned_checklist_answer/);
  assert.match(corrective,/DROP TRIGGER IF EXISTS trg_keep_required_checklist_photo_after_answer/);
});

test('deployment still probes the recovered checklist schema before publish',async()=>{
  const deploy=await read('scripts/cloudflare-bootstrap.sh');
  assert.match(deploy,/d1_migrations/);
  assert.match(deploy,/pragma_table_info\('maintenance_checklist_runs'\)/);
  assert.match(deploy,/sqlite_master WHERE type='trigger'/);
  assert.match(deploy,/checklist_editor_schema_ok/);
  assert.match(deploy,/refusing to publish the Worker/);
});

test('template helper supports a reusable library, versioning, assignment and automatic lookup',async()=>{
  const helper=await read('lib/maintenance-checklist-templates.ts');
  assert.match(helper,/createChecklistTemplate/);
  assert.match(helper,/listActiveChecklistTemplates/);
  assert.match(helper,/assignChecklistTemplate/);
  assert.match(helper,/getAssignedChecklistTemplate/);
  assert.match(helper,/template-\$\{crypto\.randomUUID\(\)\}/);
  assert.match(helper,/ON CONFLICT\(event_type, applies_to\) DO UPDATE/);
  assert.match(helper,/MAX\(version\)/);
  assert.match(helper,/active = 0/);
  assert.match(helper,/active = 1/);
});

test('checklist template API is manager-only and supports create, publish and assign',async()=>{
  const route=await read('app/api/maintenance-checklist-templates/route.ts');
  assert.match(route,/user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(route,/action === 'create'/);
  assert.match(route,/action === 'publish'/);
  assert.match(route,/action === 'assign'/);
  assert.match(route,/createChecklistTemplate/);
  assert.match(route,/publishChecklistTemplate/);
  assert.match(route,/assignChecklistTemplate/);
  assert.match(route,/listActiveChecklistTemplates/);
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

test('manager editor builds blank or copied templates and assigns them to trucks or trailers',async()=>{
  const navigation=await read('app/navigation-config.ts');
  const page=await read('app/maintenance-checklists/editor-client.tsx');
  assert.match(navigation,/href:\s*"\/maintenance-checklists",\s*label:\s*"PM & Annual Checklists"/);
  assert.match(page,/PM & Annual Template Builder/);
  assert.match(page,/New Blank Template/);
  assert.match(page,/Copy Selected/);
  assert.match(page,/APPLIES TO/);
  assert.match(page,/Trucks/);
  assert.match(page,/Trailers/);
  assert.match(page,/Use Selected Template/);
  assert.match(page,/Publish New Version/);
  assert.match(page,/Add Section/);
  assert.match(page,/Required proof/);
});
