#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wrangler="${project_root}/node_modules/.bin/wrangler"

[[ -x "$wrangler" ]] || {
  echo "Wrangler is unavailable. Run npm ci before the D1 integration test." >&2
  exit 69
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

config="$tmp/wrangler.jsonc"
combined="$tmp/parts-inventory-v2-d1.sql"
persist="$tmp/d1-state"

sed 's/REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID/00000000-0000-0000-0000-000000000000/g' \
  "$project_root/wrangler.template.jsonc" > "$config"

cat \
  "$project_root/tests/parts-inventory-v2-d1-prelude.sql" \
  "$project_root/migrations/0092_parts_inventory_v2_operations.sql" \
  "$project_root/migrations/0093_inventory_v2_compat.sql" \
  "$project_root/migrations/0094_inventory_v2_operational_controls.sql" \
  "$project_root/tests/parts-inventory-v2-d1-scenarios.sql" \
  > "$combined"

echo "Running Parts & Inventory v2 against local Cloudflare D1..."
"$wrangler" d1 execute norlow-repair-production \
  --local \
  --persist-to "$persist" \
  --config "$config" \
  --file "$combined"

# Every scenario INSERT uses CHECK(passed=1). This final assertion also proves that
# none of the expected assertions silently produced zero rows.
"$wrangler" d1 execute norlow-repair-production \
  --local \
  --persist-to "$persist" \
  --config "$config" \
  --command "INSERT INTO test_assertions(label,passed) SELECT 'all D1 scenario assertions ran', CASE WHEN COUNT(*)=11 THEN 1 ELSE 0 END FROM test_assertions;"

echo "Parts & Inventory v2 local D1 integration scenarios passed."
