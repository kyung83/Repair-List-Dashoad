#!/usr/bin/env bash
set -euo pipefail

DB_NAME="norlow-repair-production"
BUCKET_NAME="norlow-repair-files"
WORKER_NAME="norlow-repair-dashboard"
CONFIG_FILE="wrangler.jsonc"
TEMPLATE_FILE="wrangler.template.jsonc"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Missing CLOUDFLARE_API_TOKEN"
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

npx wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}"
npm run build
npx wrangler deploy --config "$CONFIG_FILE" --name "$WORKER_NAME" "${ACCOUNT_ARG[@]}"

echo "Cloudflare bootstrap completed."
