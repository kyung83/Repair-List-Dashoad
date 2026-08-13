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

# Temporary read-only diagnostic for the guarded 2026-08-13 trailer-date import.
# Remove this after the unmatched live equipment names are resolved.
if npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" --command "SELECT COUNT(*) AS staged_rows FROM _manual_trailer_dates_20260813" >/tmp/trailer-stage-count.log 2>&1; then
  cat /tmp/trailer-stage-count.log
  echo "Unmatched staged trailer identifiers:"
  npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" --command "
    SELECT s.unit AS source_unit
    FROM _manual_trailer_dates_20260813 s
    WHERE NOT EXISTS (
      SELECT 1 FROM equipment e
      WHERE (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
        AND (
          upper(trim(e.unit)) = upper(s.unit)
          OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
          OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
          OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
          OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' (%'
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' (%'
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
        )
    )
    ORDER BY s.unit;
  "
  echo "Nearby equipment candidates for unmatched identifiers:"
  npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" --command "
    WITH unmatched AS (
      SELECT s.unit
      FROM _manual_trailer_dates_20260813 s
      WHERE NOT EXISTS (
        SELECT 1 FROM equipment e
        WHERE (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
          AND (
            upper(trim(e.unit)) = upper(s.unit)
            OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
            OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
            OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
            OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
            OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' (%'
            OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
            OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' (%'
            OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
          )
      )
    )
    SELECT u.unit AS source_unit, e.id, e.unit AS equipment_unit, e.equipment_type, e.active, e.geotab_trailer_id
    FROM unmatched u
    LEFT JOIN equipment e
      ON upper(trim(e.unit)) = upper(u.unit)
      OR upper(trim(e.unit)) LIKE '%' || upper(u.unit) || '%'
    ORDER BY u.unit, e.active DESC, e.id;
  "
fi

npx wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}"

chmod +x scripts/*.sh

# Build with the Cloudflare Vite plugin using the generated production config.
export CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH="$CONFIG_FILE"
npm run build

if [ ! -s "$OUTPUT_CONFIG" ]; then
  echo "Cloudflare output configuration was not produced at $OUTPUT_CONFIG"
  exit 1
fi

# Deploy the exact build snapshot produced by the Cloudflare Vite plugin.
npx wrangler deploy --config "$OUTPUT_CONFIG" "${ACCOUNT_ARG[@]}"

echo "Cloudflare bootstrap completed."
