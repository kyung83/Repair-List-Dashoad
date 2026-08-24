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

# Apply schema/data migrations only after the application build is known-good.
npx wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}"

# Prove the operational Parts & Inventory v2 migration exists on REMOTE D1 before
# publishing application code that depends on it. This is intentionally a direct D1
# check rather than an HTTP health endpoint so the internal diagnostics route stays
# authenticated.
parts_v2_schema_sql="SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_master WHERE name='trg_inventory_part_issue_open_core' AND type='trigger')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='trg_inventory_operation_undo_core_guard' AND type='trigger')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE name='idx_core_obligation_source_operation' AND type='index')
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

# Deploy the exact build snapshot produced by the Cloudflare Vite plugin.
npx wrangler deploy --config "$OUTPUT_CONFIG" "${ACCOUNT_ARG[@]}"

echo "Cloudflare bootstrap completed."
