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

# Temporary read-only diagnostic for source numbers that resolve to multiple active trailer rows.
if npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" --command "SELECT COUNT(*) AS staged_rows FROM _manual_trailer_dates_20260813" >/tmp/trailer-stage-count.log 2>&1; then
  cat /tmp/trailer-stage-count.log
  echo "Ambiguous active trailer matches:"
  npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" --command "
    SELECT s.unit AS source_unit, COUNT(*) AS active_matches
    FROM _manual_trailer_dates_20260813 s
    JOIN equipment e
      ON e.active = 1
     AND (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
     AND (
          upper(trim(e.unit)) = upper(s.unit)
          OR upper(trim(e.unit)) LIKE upper(s.unit) || ' %'
          OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
          OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' %'
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
          OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' %'
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
        )
    GROUP BY s.unit
    HAVING COUNT(*) > 1
    ORDER BY s.unit;
  "
  echo "Ambiguous active trailer records:"
  npx wrangler d1 execute "$DB_NAME" --remote --config "$CONFIG_FILE" "${ACCOUNT_ARG[@]}" --command "
    WITH ambiguous AS (
      SELECT s.unit
      FROM _manual_trailer_dates_20260813 s
      JOIN equipment e
        ON e.active = 1
       AND (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
       AND (
            upper(trim(e.unit)) = upper(s.unit)
            OR upper(trim(e.unit)) LIKE upper(s.unit) || ' %'
            OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
            OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
            OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' %'
            OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
            OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
            OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' %'
            OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
          )
      GROUP BY s.unit
      HAVING COUNT(*) > 1
    )
    SELECT a.unit AS source_unit, e.id, e.unit AS equipment_unit, e.active, e.geotab_trailer_id,
           e.service_date, e.annual_date, e.updated_at
    FROM ambiguous a
    JOIN equipment e
      ON e.active = 1
     AND (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
     AND (
          upper(trim(e.unit)) = upper(a.unit)
          OR upper(trim(e.unit)) LIKE upper(a.unit) || ' %'
          OR upper(trim(e.unit)) LIKE upper(a.unit) || '(%'
          OR upper(trim(e.unit)) = 'TRL ' || upper(a.unit)
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(a.unit) || ' %'
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(a.unit) || '(%'
          OR upper(trim(e.unit)) = 'TRAILER ' || upper(a.unit)
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(a.unit) || ' %'
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(a.unit) || '(%'
        )
    ORDER BY a.unit, e.id;
  "
fi

# Migration 0056 failed before being applied because its original name matcher did not allow
# Geotab operational notes after a trailer number. Use the reviewed corrected body whenever
# bootstrapping so D1 records the same 0056 migration name with the safe active-trailer matcher.
cp scripts/manual-trailer-date-fix-20260813.sql migrations/0056_apply_manual_trailer_dates.sql

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
