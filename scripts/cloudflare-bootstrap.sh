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
# If TypeScript/Vite fails, the database remains on the currently deployed schema.
export CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="$CONFIG_FILE"
npm run build

if [ ! -s "$OUTPUT_CONFIG" ]; then
  echo "Cloudflare output configuration was not produced at $OUTPUT_CONFIG"
  exit 1
fi

# Only apply schema changes after the application build is known-good.
npx wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}"

# Temporary read-only PM import diagnostic. The staged unit labels are already part of
# the migration source; this prints only resolution state so the final import can be
# mapped to current in-use Equipment records without weakening the safety guard.
echo "PM import diagnostics:"
npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" \
  --command "SELECT metric, value FROM pm_import_diagnostics_20260818 ORDER BY metric;"
echo "PM import unresolved units:"
npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" \
  --command "SELECT staged_unit, match_kind, candidate_count FROM pm_import_unit_resolution_20260818 WHERE equipment_id IS NULL ORDER BY staged_unit;"

# Deploy the exact build snapshot produced by the Cloudflare Vite plugin.
npx wrangler deploy --config "$OUTPUT_CONFIG" "${ACCOUNT_ARG[@]}"

echo "Cloudflare bootstrap completed."
