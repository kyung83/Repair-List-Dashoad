#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v timeout >/dev/null || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${project_root}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm ci before building." >&2
  exit 69
fi

echo "Running deterministic regression tests..."
node --test \
  "${project_root}/tests/outside-work-invoice-parser.test.mjs" \
  "${project_root}/tests/outside-work-mixed-invoices.test.mjs" \
  "${project_root}/tests/outside-work-handwritten-ocr.test.mjs" \
  "${project_root}/tests/outside-work-validation.test.mjs" \
  "${project_root}/tests/outside-work-correction-memory.test.mjs" \
  "${project_root}/tests/outside-work-vendor-separation.test.mjs" \
  "${project_root}/tests/geotab-location-state.test.mjs" \
  "${project_root}/tests/tire-position-repair.test.mjs" \
  "${project_root}/tests/parts-inventory-v2-contract.test.mjs"

echo "Running local D1 integration scenarios..."
bash "${project_root}/scripts/test-parts-inventory-v2-d1.sh"

echo "Running bounded vinext/Cloudflare build..."
timeout \
  --signal=TERM \
  --kill-after="${VINEXT_BUILD_KILL_AFTER:-10s}" \
  "${VINEXT_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

worker="${project_root}/dist/server/index.js"
output_config="${project_root}/dist/server/wrangler.json"

[[ -s "$worker" ]] || {
  echo "Missing or empty Cloudflare Worker bundle: dist/server/index.js" >&2
  exit 66
}
[[ -s "$output_config" ]] || {
  echo "Missing Cloudflare output config: dist/server/wrangler.json" >&2
  exit 66
}

node --input-type=module - "$output_config" <<'NODE'
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
if (!config || typeof config !== "object" || typeof config.main !== "string") {
  throw new Error("Cloudflare output config must contain a Worker main entry");
}

const compatibilityDate = String(config.compatibility_date ?? "");
const compatibilityFlags = Array.isArray(config.compatibility_flags)
  ? config.compatibility_flags.map(String)
  : [];
const crons = Array.isArray(config.triggers?.crons) ? config.triggers.crons.map(String) : [];

console.log(`Generated Worker compatibility_date=${compatibilityDate || "<missing>"}`);
console.log(`Generated Worker compatibility_flags=${compatibilityFlags.join(",") || "<none>"}`);
console.log(`Generated Worker main=${config.main}`);
console.log(`Generated Worker AI binding=${config.ai?.binding || "<none>"}`);
console.log(`Generated Worker crons=${crons.join(",") || "<none>"}`);

if (!compatibilityDate) {
  throw new Error("Cloudflare output config is missing compatibility_date");
}
if (!compatibilityFlags.includes("nodejs_compat")) {
  throw new Error("Cloudflare output config is missing nodejs_compat");
}
if (config.ai?.binding) {
  throw new Error("Outside Work is intentionally no-AI; generated Worker config must not include an AI binding.");
}
if (!crons.includes("* * * * *")) {
  throw new Error("Geotab LogRecord feed must run every minute.");
}
NODE

echo "Validated Cloudflare Worker bundle, no-AI output, and minute Geotab feed schedule."
