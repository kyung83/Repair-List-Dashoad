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
