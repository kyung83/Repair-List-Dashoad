#!/usr/bin/env bash
set -euo pipefail

DB_NAME="norlow-repair-production"
BUCKET_NAME="norlow-repair-files"
CONFIG_FILE="wrangler.jsonc"
TEMPLATE_FILE="wrangler.template.jsonc"

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

npx wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}"

# The repository stores some helper scripts without executable mode metadata.
# Restore it on Linux runners before the npm build invokes them directly.
chmod +x scripts/*.sh

# Build through the Cloudflare Vite plugin using the generated production config.
export CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="$CONFIG_FILE"
npm run build

# The Vite plugin writes .wrangler/deploy/config.json, which redirects Wrangler
# to the built Worker bundle and its generated output configuration.
npx wrangler deploy "${ACCOUNT_ARG[@]}"

echo "Cloudflare bootstrap completed."
