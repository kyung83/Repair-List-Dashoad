#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"

[[ -s "${worker}" ]] || {
  echo "Missing or empty Sites Worker entry: dist/server/index.js" >&2
  exit 66
}
[[ -s "${hosting}" ]] || {
  echo "Missing or empty packaged Sites manifest: dist/.openai/hosting.json" >&2
  exit 66
}

node --input-type=module - "${worker}" "${hosting}" <<'NODE'
import { readFile } from "node:fs/promises";

const [workerPath, hostingPath] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(hostingPath, "utf8"));
const source = await readFile(workerPath, "utf8");

if (!source.includes("export") || !source.includes("fetch")) {
  throw new Error("dist/server/index.js must contain an exported Worker fetch handler");
}
if (!manifest || typeof manifest !== "object") {
  throw new Error("Packaged hosting manifest must be a JSON object");
}
NODE

echo "Validated Sites artifact: Worker bundle and hosting manifest are present."
