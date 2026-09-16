#!/usr/bin/env bash
set -euo pipefail

DB_NAME="norlow-repair-production"
BUCKET_NAME="norlow-repair-files"
CONFIG_FILE="wrangler.jsonc"
TEMPLATE_FILE="wrangler.template.jsonc"
OUTPUT_CONFIG="dist/server/wrangler.json"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Missing CLOUDFLARE_API_TOKEN"
  exit 1
fi

# GitHub secrets can accidentally contain copied line breaks, labels, or quotes.
# Normalize the token without printing it.
CLOUDFLARE_API_TOKEN="$(printf '%s' "$CLOUDFLARE_API_TOKEN" | tr -d '[:space:]')"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN#CLOUDFLARE_API_TOKEN=}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN#Bearer}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN#\"}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN%\"}"
export CLOUDFLARE_API_TOKEN

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Cloudflare token is empty after normalization."
  exit 1
fi

ACCOUNT_ARG=()
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  ACCOUNT_ARG=(--account-id "$CLOUDFLARE_ACCOUNT_ID")
fi

create_db_output="$(npx wrangler d1 create "$DB_NAME" --location enam "${ACCOUNT_ARG[@]}" 2>&1 || true)"
echo "$create_db_output"

DB_ID="$(printf '%s\n' "$create_db_output" | sed -n 's/.*database_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"

if [ -z "$DB_ID" ]; then
  list_output="$(npx wrangler d1 list --json "${ACCOUNT_ARG[@]}")"
  DB_ID="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); const row=data.find(x=>x.name==="norlow-repair-production"); if(row) process.stdout.write(row.uuid||row.id||row.database_id||"");' <<<"$list_output")"
fi

if [ -z "$DB_ID" ]; then
  echo "Could not determine the D1 database ID."
  exit 1
fi

npx wrangler r2 bucket create "$BUCKET_NAME" "${ACCOUNT_ARG[@]}" >/tmp/r2-create.log 2>&1 || true
cat /tmp/r2-create.log

sed "s/REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID/$DB_ID/g" "$TEMPLATE_FILE" > "$CONFIG_FILE"

# Migration 0056 failed before being applied because the original matcher could not safely
# distinguish trailer-number duplicates. Use the reviewed guarded body so D1 records the same
# unapplied migration name while updating only the intended active trailer representations.
cp scripts/manual-trailer-date-fix-20260813.sql migrations/0056_apply_manual_trailer_dates.sql

chmod +x scripts/*.sh

# Compile and validate the exact Worker snapshot before mutating production D1.
export CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="$CONFIG_FILE"
npm run build

if [ ! -s "$OUTPUT_CONFIG" ]; then
  echo "Cloudflare output configuration was not produced at $OUTPUT_CONFIG"
  exit 1
fi

# Migration 0094 previously failed while Wrangler parsed trigger bodies. The Worker was not
# deployed, but defensively probe remote D1 before retrying in case any early ALTER TABLE
# statements persisted. Rewrite only this still-unapplied migration so each missing column is
# added exactly once and the trigger-free indexes are created idempotently.
parts_v2_probe_sql="SELECT
  EXISTS(SELECT 1 FROM pragma_table_info('parts') WHERE name='core_return_part_id') AS core_return_part_id,
  EXISTS(SELECT 1 FROM pragma_table_info('parts') WHERE name='core_return_quantity') AS core_return_quantity,
  EXISTS(SELECT 1 FROM pragma_table_info('recovered_used_tires') WHERE name='disposition_repair_id') AS disposition_repair_id,
  EXISTS(SELECT 1 FROM pragma_table_info('recovered_used_tires') WHERE name='disposition_position_code') AS disposition_position_code;"

npx wrangler d1 execute "$DB_NAME" \
  --remote \
  --config "$CONFIG_FILE" \
  "${ACCOUNT_ARG[@]}" \
  --command "$parts_v2_probe_sql" \
  --json > /tmp/parts-v2-pre-migration.json

node - /tmp/parts-v2-pre-migration.json migrations/0094_inventory_v2_operational_controls.sql <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function findRow(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRow(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'core_return_part_id')) return value;
  for (const child of Object.values(value)) {
    const found = findRow(child);
    if (found) return found;
  }
  return null;
}
const row = findRow(payload);
if (!row) {
  console.error('Could not determine remote Parts v2 column state before migration 0094.');
  process.exit(1);
}
const statements = ['PRAGMA foreign_keys = ON;'];
if (Number(row.core_return_part_id) !== 1) statements.push('ALTER TABLE parts ADD COLUMN core_return_part_id INTEGER;');
if (Number(row.core_return_quantity) !== 1) statements.push('ALTER TABLE parts ADD COLUMN core_return_quantity REAL NOT NULL DEFAULT 0;');
statements.push(`CREATE INDEX IF NOT EXISTS idx_parts_core_return_part
ON parts(core_return_part_id)
WHERE core_return_part_id IS NOT NULL;`);
statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_core_obligation_source_operation
ON part_core_obligations(source_operation_id);`);
if (Number(row.disposition_repair_id) !== 1) statements.push('ALTER TABLE recovered_used_tires ADD COLUMN disposition_repair_id INTEGER;');
if (Number(row.disposition_position_code) !== 1) statements.push('ALTER TABLE recovered_used_tires ADD COLUMN disposition_position_code TEXT;');
statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recovered_tire_source_position
ON recovered_used_tires(repair_id, position_code)
WHERE repair_id IS NOT NULL AND position_code IS NOT NULL;`);
fs.writeFileSync(process.argv[3], statements.join('\n\n') + '\n');
console.log('Prepared recovery-safe trigger-free migration 0094 from remote D1 schema state.');
NODE

# Deploy #746 failed while introducing the checklist editor. Probe the live database before
# retrying so the same branch works for a clean, half-applied, or fully-applied 0138/0139.
# This first query is read-only and also tells us whether the risky required-photo trigger
# exists on the currently running production Worker.
checklist_probe_sql="SELECT
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='d1_migrations') AS has_d1_migrations,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_checklist_templates') AS templates_table,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_checklist_template_items') AS template_items_table,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_maintenance_checklist_templates_active') AS templates_active_index,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_maintenance_checklist_template_items_template') AS template_items_index,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_runs') WHERE name='template_id') AS run_template_id,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_runs') WHERE name='template_version') AS run_template_version,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='allow_pass') AS item_allow_pass,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='allow_fail') AS item_allow_fail,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='allow_na') AS item_allow_na,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='require_notes') AS item_require_notes,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='require_photo') AS item_require_photo,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='require_measurement') AS item_require_measurement,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='measurement_label') AS item_measurement_label,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='measurement_unit') AS item_measurement_unit,
  EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='measurement_value') AS item_measurement_value,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_snapshot_published_checklist_after_run') AS trigger_snapshot,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_block_legacy_items_for_versioned_checklist') AS trigger_legacy_block,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_validate_versioned_checklist_answer') AS trigger_answer_validation,
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_keep_required_checklist_photo_after_answer') AS trigger_required_photo;"

npx wrangler d1 execute "$DB_NAME" \
  --remote \
  --config "$CONFIG_FILE" \
  "${ACCOUNT_ARG[@]}" \
  --command "$checklist_probe_sql" \
  --json > /tmp/checklist-editor-pre-migration.json

has_d1_migrations="$(node - /tmp/checklist-editor-pre-migration.json <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function find(value) {
  if (Array.isArray(value)) for (const item of value) { const row = find(item); if (row) return row; }
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'has_d1_migrations')) return value;
  for (const child of Object.values(value)) { const row = find(child); if (row) return row; }
  return null;
}
const row = find(payload);
process.stdout.write(String(Number(row?.has_d1_migrations ?? 0)));
NODE
)"

if [ "$has_d1_migrations" = "1" ]; then
  npx wrangler d1 execute "$DB_NAME" \
    --remote \
    --config "$CONFIG_FILE" \
    "${ACCOUNT_ARG[@]}" \
    --command "SELECT name FROM d1_migrations WHERE name LIKE '0138_%' OR name LIKE '0139_%' OR name LIKE '0140_%' ORDER BY id;" \
    --json > /tmp/checklist-editor-migrations.json
else
  printf '[]\n' > /tmp/checklist-editor-migrations.json
fi

node - \
  /tmp/checklist-editor-pre-migration.json \
  /tmp/checklist-editor-migrations.json \
  migrations/0138_maintenance_checklist_templates.sql \
  migrations/0140_checklist_editor_trigger_cleanup.sql <<'NODE'
const fs = require('fs');
const probe = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const migrations = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const migration0138Path = process.argv[4];
const migration0140Path = process.argv[5];

function findProbe(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProbe(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'templates_table')) return value;
  for (const child of Object.values(value)) {
    const found = findProbe(child);
    if (found) return found;
  }
  return null;
}
function collectNames(value, names = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectNames(item, names);
    return names;
  }
  if (!value || typeof value !== 'object') return names;
  if (typeof value.name === 'string') names.add(value.name);
  for (const child of Object.values(value)) collectNames(child, names);
  return names;
}
const row = findProbe(probe);
if (!row) {
  console.error('Could not determine remote checklist editor schema state before migrations 0138/0139.');
  process.exit(1);
}
const names = collectNames(migrations);
const applied = (prefix) => [...names].some((name) => name.startsWith(prefix));
const applied0138 = applied('0138_maintenance_checklist_templates');
const applied0139 = applied('0139_checklist_required_photo_guard');
const applied0140 = applied('0140_checklist_editor_trigger_cleanup');
console.log(`Checklist editor migration state: 0138=${applied0138 ? 'applied' : 'pending'}, 0139=${applied0139 ? 'applied' : 'pending'}, 0140=${applied0140 ? 'applied' : 'pending'}.`);
console.log(`Checklist editor trigger state before repair: snapshot=${Number(row.trigger_snapshot) === 1}, legacyBlock=${Number(row.trigger_legacy_block) === 1}, answerValidation=${Number(row.trigger_answer_validation) === 1}, requiredPhoto=${Number(row.trigger_required_photo) === 1}.`);
if (Number(row.trigger_required_photo) === 1) {
  console.warn('Live D1 contains the required-photo trigger. The corrective migration will remove it before the new Worker is published.');
}

const templatesTable = `CREATE TABLE IF NOT EXISTS maintenance_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('pm','annual')),
  template_key TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (event_type, template_key, version)
);`;
const templatesIndex = `CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_checklist_templates_active
ON maintenance_checklist_templates(event_type, template_key)
WHERE active = 1;`;
const templateItemsTable = `CREATE TABLE IF NOT EXISTS maintenance_checklist_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  allow_pass INTEGER NOT NULL DEFAULT 1 CHECK (allow_pass IN (0,1)),
  allow_fail INTEGER NOT NULL DEFAULT 1 CHECK (allow_fail IN (0,1)),
  allow_na INTEGER NOT NULL DEFAULT 1 CHECK (allow_na IN (0,1)),
  require_notes INTEGER NOT NULL DEFAULT 0 CHECK (require_notes IN (0,1)),
  require_photo INTEGER NOT NULL DEFAULT 0 CHECK (require_photo IN (0,1)),
  require_measurement INTEGER NOT NULL DEFAULT 0 CHECK (require_measurement IN (0,1)),
  measurement_label TEXT,
  measurement_unit TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES maintenance_checklist_templates(id) ON DELETE CASCADE,
  UNIQUE (template_id, position)
);`;
const templateItemsIndex = `CREATE INDEX IF NOT EXISTS idx_maintenance_checklist_template_items_template
ON maintenance_checklist_template_items(template_id, position);`;

function baseSchema(includeMissingAlters) {
  const statements = [
    'PRAGMA foreign_keys = ON;',
    templatesTable,
    templatesIndex,
    templateItemsTable,
    templateItemsIndex,
  ];
  if (includeMissingAlters) {
    if (Number(row.run_template_id) !== 1) statements.push('ALTER TABLE maintenance_checklist_runs ADD COLUMN template_id INTEGER;');
    if (Number(row.run_template_version) !== 1) statements.push('ALTER TABLE maintenance_checklist_runs ADD COLUMN template_version INTEGER;');
    if (Number(row.item_allow_pass) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN allow_pass INTEGER NOT NULL DEFAULT 1;');
    if (Number(row.item_allow_fail) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN allow_fail INTEGER NOT NULL DEFAULT 1;');
    if (Number(row.item_allow_na) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN allow_na INTEGER NOT NULL DEFAULT 1;');
    if (Number(row.item_require_notes) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN require_notes INTEGER NOT NULL DEFAULT 0;');
    if (Number(row.item_require_photo) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN require_photo INTEGER NOT NULL DEFAULT 0;');
    if (Number(row.item_require_measurement) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN require_measurement INTEGER NOT NULL DEFAULT 0;');
    if (Number(row.item_measurement_label) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN measurement_label TEXT;');
    if (Number(row.item_measurement_unit) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN measurement_unit TEXT;');
    if (Number(row.item_measurement_value) !== 1) statements.push('ALTER TABLE maintenance_checklist_items ADD COLUMN measurement_value TEXT;');
  }
  return statements;
}

if (!applied0138) {
  fs.writeFileSync(migration0138Path, baseSchema(true).join('\n\n') + '\n');
  console.log('Prepared recovery-safe trigger-free migration 0138 from remote D1 schema state.');
}

if (!applied0140) {
  // If 0138 is still pending it will add the missing columns first, so 0140 must not
  // repeat those ALTER TABLE statements. If 0138 is already recorded, 0140 repairs
  // any unexpectedly missing columns itself.
  const corrective = baseSchema(applied0138);
  corrective.push(
    'DROP TRIGGER IF EXISTS trg_snapshot_published_checklist_after_run;',
    'DROP TRIGGER IF EXISTS trg_block_legacy_items_for_versioned_checklist;',
    'DROP TRIGGER IF EXISTS trg_validate_versioned_checklist_answer;',
    'DROP TRIGGER IF EXISTS trg_keep_required_checklist_photo_after_answer;',
  );
  fs.writeFileSync(migration0140Path, corrective.join('\n\n') + '\n');
  console.log('Prepared checklist editor corrective migration 0140.');
}
NODE

# Apply schema/data migrations only after the application build is known-good.
npx wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}"

# Prove the operational Parts & Inventory v2 migration exists on REMOTE D1 before
# publishing application code that depends on it. This is intentionally a direct D1
# check rather than an HTTP health endpoint so the internal diagnostics route stays
# authenticated.
parts_v2_schema_sql="SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_core_obligation_source_operation' AND type='index')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_recovered_tire_source_position' AND type='index')
  AND EXISTS(SELECT 1 FROM pragma_table_info('parts') WHERE name='core_return_part_id')
  AND EXISTS(SELECT 1 FROM pragma_table_info('parts') WHERE name='core_return_quantity')
  AND EXISTS(SELECT 1 FROM pragma_table_info('recovered_used_tires') WHERE name='disposition_repair_id')
  AND EXISTS(SELECT 1 FROM pragma_table_info('recovered_used_tires') WHERE name='disposition_position_code')
THEN 1 ELSE 0 END AS parts_v2_0094_ok;"

npx wrangler d1 execute "$DB_NAME" \
  --remote \
  --config "$CONFIG_FILE" \
  "${ACCOUNT_ARG[@]}" \
  --command "$parts_v2_schema_sql" \
  --json > /tmp/parts-v2-schema.json

node - /tmp/parts-v2-schema.json <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function findFlag(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFlag(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'parts_v2_0094_ok')) return Number(value.parts_v2_0094_ok);
  for (const child of Object.values(value)) {
    const found = findFlag(child);
    if (found !== undefined) return found;
  }
  return undefined;
}
const flag = findFlag(payload);
if (flag !== 1) {
  console.error('Remote D1 is missing required Parts & Inventory v2 migration 0094 objects.');
  console.error(JSON.stringify(payload));
  process.exit(1);
}
console.log('Verified remote Parts & Inventory v2 schema 0094.');
NODE

# Refuse to publish the checklist editor unless the exact trigger-free production
# schema is present and D1 has recorded 0138, 0139, and the corrective 0140.
checklist_schema_sql="SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_checklist_templates')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_checklist_template_items')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_maintenance_checklist_templates_active')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_maintenance_checklist_template_items_template')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_runs') WHERE name='template_id')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_runs') WHERE name='template_version')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='allow_pass')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='allow_fail')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='allow_na')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='require_notes')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='require_photo')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='require_measurement')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='measurement_label')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='measurement_unit')
  AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='measurement_value')
  AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_snapshot_published_checklist_after_run')
  AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_block_legacy_items_for_versioned_checklist')
  AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_validate_versioned_checklist_answer')
  AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_keep_required_checklist_photo_after_answer')
  AND EXISTS(SELECT 1 FROM d1_migrations WHERE name LIKE '0138_maintenance_checklist_templates%')
  AND EXISTS(SELECT 1 FROM d1_migrations WHERE name LIKE '0139_checklist_required_photo_guard%')
  AND EXISTS(SELECT 1 FROM d1_migrations WHERE name LIKE '0140_checklist_editor_trigger_cleanup%')
THEN 1 ELSE 0 END AS checklist_editor_schema_ok;"

npx wrangler d1 execute "$DB_NAME" \
  --remote \
  --config "$CONFIG_FILE" \
  "${ACCOUNT_ARG[@]}" \
  --command "$checklist_schema_sql" \
  --json > /tmp/checklist-editor-schema.json

node - /tmp/checklist-editor-schema.json <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function findFlag(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFlag(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'checklist_editor_schema_ok')) return Number(value.checklist_editor_schema_ok);
  for (const child of Object.values(value)) {
    const found = findFlag(child);
    if (found !== undefined) return found;
  }
  return undefined;
}
const flag = findFlag(payload);
if (flag !== 1) {
  console.error('Remote D1 checklist editor schema verification failed; refusing to publish the Worker.');
  console.error(JSON.stringify(payload));
  process.exit(1);
}
console.log('Verified remote trigger-free checklist editor schema and migration records.');
NODE

# Migration 0098 is a hard prerequisite for the breakdown Worker. Refuse to publish
# unless every driver/GPS snapshot column exists on REMOTE D1. This check reads only
# schema metadata and never creates a fake breakdown.
breakdown_snapshot_schema_sql="SELECT CASE WHEN
  EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='snapshot_source')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='geotab_driver_id')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='driver_observed_at')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='geotab_device_id')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='latitude')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='longitude')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='gps_observed_at')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='gps_source')
  AND EXISTS(SELECT 1 FROM pragma_table_info('roadside_breakdowns') WHERE name='snapshot_captured_at')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_roadside_breakdowns_snapshot_source' AND type='index')
THEN 1 ELSE 0 END AS breakdown_snapshot_0098_ok;"

npx wrangler d1 execute "$DB_NAME" \
  --remote \
  --config "$CONFIG_FILE" \
  "${ACCOUNT_ARG[@]}" \
  --command "$breakdown_snapshot_schema_sql" \
  --json > /tmp/breakdown-snapshot-schema.json

node - /tmp/breakdown-snapshot-schema.json <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function findFlag(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFlag(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'breakdown_snapshot_0098_ok')) {
    return Number(value.breakdown_snapshot_0098_ok);
  }
  for (const child of Object.values(value)) {
    const found = findFlag(child);
    if (found !== undefined) return found;
  }
  return undefined;
}
const flag = findFlag(payload);
if (flag !== 1) {
  console.error('Remote D1 is missing required roadside breakdown Geotab snapshot migration 0098 fields.');
  console.error(JSON.stringify(payload));
  process.exit(1);
}
console.log('Verified remote roadside breakdown Geotab snapshot schema 0098.');
NODE

# Deploy the exact build snapshot produced by the Cloudflare Vite plugin.
npx wrangler deploy --config "$OUTPUT_CONFIG" "${ACCOUNT_ARG[@]}"

echo "Cloudflare bootstrap completed."
