import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');

function runWrangler(args) {
  return execFileSync(wrangler, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', CLOUDFLARE_API_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('editor migrations preserve a PM that was already in progress before deployment', { timeout: 60_000 }, async () => {
  assert.ok(existsSync(wrangler), 'Wrangler must be installed before running the D1 preservation test.');

  const temp = await mkdtemp(join(tmpdir(), 'checklist-existing-run-'));
  try {
    const migrations = join(temp, 'migrations');
    const persist = join(temp, 'd1-state');
    const config = join(temp, 'wrangler.toml');
    const prelude = join(temp, 'prelude.sql');

    await mkdir(migrations, { recursive: true });
    for (const name of [
      '0138_maintenance_checklist_templates.sql',
      '0139_checklist_required_photo_guard.sql',
      '0140_checklist_editor_trigger_cleanup.sql',
      '0141_maintenance_checklist_template_assignments.sql',
    ]) {
      await copyFile(join(root, 'migrations', name), join(migrations, name));
    }

    const tomlPath = migrations.replaceAll('\\', '\\\\');
    await writeFile(config, `name = "checklist-existing-run-test"\ncompatibility_date = "2026-01-01"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "norlow-repair-production"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\nmigrations_dir = "${tomlPath}"\n`);

    await writeFile(prelude, `
PRAGMA foreign_keys = ON;

CREATE TABLE app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE maintenance_checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE,
  equipment_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('pm','annual')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','ready','completed')),
  started_by_user_id INTEGER,
  completed_by_user_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (started_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE maintenance_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','na')),
  notes TEXT,
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES maintenance_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE(checklist_run_id, item_number)
);

CREATE TABLE maintenance_checklist_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  checklist_item_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT,
  content_type TEXT,
  uploaded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES maintenance_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (checklist_item_id) REFERENCES maintenance_checklist_items(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

INSERT INTO repairs(id) VALUES (101);
INSERT INTO equipment(id) VALUES (202);
INSERT INTO maintenance_checklist_runs(
  id, repair_id, equipment_id, event_type, status, started_at, updated_at
) VALUES (
  303, 101, 202, 'pm', 'in_progress', '2026-09-15 08:00:00', '2026-09-15 08:30:00'
);
INSERT INTO maintenance_checklist_items(
  id, checklist_run_id, item_number, section, item_text, result, notes, updated_at
) VALUES (
  404, 303, 7, 'Existing Section', 'Original pre-deploy question', 'pass', 'Existing answer', '2026-09-15 08:25:00'
);
`);

    runWrangler([
      'd1', 'execute', 'norlow-repair-production',
      '--local', '--persist-to', persist, '--config', config, '--file', prelude,
    ]);

    runWrangler([
      'd1', 'migrations', 'apply', 'norlow-repair-production',
      '--local', '--persist-to', persist, '--config', config,
    ]);

    const verificationSql = `
CREATE TABLE existing_run_preservation_check(ok INTEGER NOT NULL CHECK(ok = 1));
INSERT INTO existing_run_preservation_check(ok)
SELECT CASE WHEN
  EXISTS(
    SELECT 1 FROM maintenance_checklist_runs
    WHERE id = 303
      AND repair_id = 101
      AND equipment_id = 202
      AND event_type = 'pm'
      AND status = 'in_progress'
      AND started_at = '2026-09-15 08:00:00'
      AND updated_at = '2026-09-15 08:30:00'
      AND template_id IS NULL
      AND template_version IS NULL
  )
  AND EXISTS(
    SELECT 1 FROM maintenance_checklist_items
    WHERE id = 404
      AND checklist_run_id = 303
      AND item_number = 7
      AND section = 'Existing Section'
      AND item_text = 'Original pre-deploy question'
      AND result = 'pass'
      AND notes = 'Existing answer'
      AND updated_at = '2026-09-15 08:25:00'
      AND allow_pass = 1
      AND allow_fail = 1
      AND allow_na = 1
      AND require_notes = 0
      AND require_photo = 0
      AND require_measurement = 0
      AND measurement_value IS NULL
  )
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'maintenance_checklist_templates')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'maintenance_checklist_template_items')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'maintenance_checklist_template_assignments')
  AND 4 = (SELECT COUNT(*) FROM maintenance_checklist_template_assignments WHERE template_key = 'default')
  AND NOT EXISTS(
    SELECT 1 FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (
        'trg_snapshot_published_checklist_after_run',
        'trg_block_legacy_items_for_versioned_checklist',
        'trg_validate_versioned_checklist_answer',
        'trg_keep_required_checklist_photo_after_answer'
      )
  )
THEN 1 ELSE 0 END;
`;

    runWrangler([
      'd1', 'execute', 'norlow-repair-production',
      '--local', '--persist-to', persist, '--config', config, '--command', verificationSql,
    ]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Worker keeps existing runs on their own item snapshot through completion', async () => {
  const route = await readFile(join(root, 'app/api/maintenance-checklist/route.ts'), 'utf8');

  const existingLookup = route.indexOf('const existing = await loadRun(repair.id);');
  const existingReturn = route.indexOf('if (existing) return existing;', existingLookup);
  const templateLookup = route.indexOf('const template = await getAssignedChecklistTemplate(env.DB, kind, appliesTo);');
  assert.ok(existingLookup >= 0 && existingReturn > existingLookup && templateLookup > existingReturn,
    'ensureRun must return a pre-existing run before loading the assigned published template.');

  const validationStart = route.indexOf('async function validateRunForCompletion');
  const validationEnd = route.indexOf('\nfunction photoUrl', validationStart);
  assert.ok(validationStart >= 0 && validationEnd > validationStart, 'Completion validation function must exist.');
  const validation = route.slice(validationStart, validationEnd);
  assert.match(validation, /FROM maintenance_checklist_items i/);
  assert.doesNotMatch(validation, /maintenance_checklist_templates/,
    'Completion must validate the run snapshot, not the currently published template.');
  assert.match(route, /await validateRunForCompletion\(run\.id\)/);

  const removeStart = route.indexOf("if (action === 'removePhoto')");
  const removeEnd = route.indexOf("if (action === 'markReady')", removeStart);
  const removeBlock = route.slice(removeStart, removeEnd);
  const d1Delete = removeBlock.indexOf('DELETE FROM maintenance_checklist_photos');
  const r2Delete = removeBlock.indexOf('await env.FILES.delete(photo.object_key)');
  assert.ok(d1Delete >= 0 && r2Delete > d1Delete,
    'Photo metadata must be deleted conditionally in D1 before the R2 object is removed.');
});
