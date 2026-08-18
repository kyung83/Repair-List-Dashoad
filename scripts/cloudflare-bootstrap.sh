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

# Read-only diagnostics for migration 0078. These intentionally run after the
# build but before migrations so a failed validation can be resolved from live
# facts without changing production data.
echo "Working manager user preflight:"
npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" \
  --command "SELECT u.id,u.username,u.display_name,u.role,u.active,u.technician_id,COALESCE(t.name,'') AS technician_name FROM app_users u LEFT JOIN technicians t ON t.id=u.technician_id WHERE lower(COALESCE(u.username,'')) IN ('jeffw','jesseg') OR lower(trim(u.display_name)) IN ('jeff wittig','jesse graham') ORDER BY u.id;"
echo "Working manager technician preflight:"
npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" \
  --command "SELECT t.id,t.name,t.active,u.id AS linked_user_id,COALESCE(u.username,'') AS linked_username,COALESCE(u.role,'') AS linked_role,COALESCE(u.active,0) AS linked_user_active FROM technicians t LEFT JOIN app_users u ON u.technician_id=t.id WHERE lower(trim(t.name)) IN ('jeff wittig','jesse graham') ORDER BY t.id,u.id;"
echo "Jesse technician candidates:"
npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" \
  --command "SELECT t.id,t.name,t.active,u.id AS linked_user_id,COALESCE(u.username,'') AS linked_username,COALESCE(u.display_name,'') AS linked_display_name,COALESCE(u.role,'') AS linked_role,COALESCE(u.active,0) AS linked_user_active FROM technicians t LEFT JOIN app_users u ON u.technician_id=t.id WHERE t.id=3 OR lower(t.name) LIKE '%jesse%' OR lower(replace(replace(replace(trim(t.name),'  ',' '),'  ',' '),'  ',' ')) LIKE '%jesse%graham%' ORDER BY t.id,u.id;"
echo "Low-ID technician roster:"
npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" \
  --command "SELECT id,name,active FROM technicians WHERE id BETWEEN 1 AND 10 ORDER BY id;"

# Apply schema/data migrations only after the application build is known-good.
npx wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}"

# Deploy the exact build snapshot produced by the Cloudflare Vite plugin.
npx wrangler deploy --config "$OUTPUT_CONFIG" "${ACCOUNT_ARG[@]}"

echo "Cloudflare bootstrap completed."
