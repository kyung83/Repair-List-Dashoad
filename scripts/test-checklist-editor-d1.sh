#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wrangler="${project_root}/node_modules/.bin/wrangler"

[[ -x "$wrangler" ]] || {
  echo "Wrangler is unavailable. Run npm ci before the checklist D1 integration test." >&2
  exit 69
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

config="$tmp/wrangler.toml"
persist="$tmp/d1-state"
migrations="$tmp/migrations"
prelude="$tmp/prelude.sql"
mkdir -p "$migrations"

cp "$project_root/migrations/0138_maintenance_checklist_templates.sql" "$migrations/"
cp "$project_root/migrations/0139_checklist_required_photo_guard.sql" "$migrations/"
cp "$project_root/migrations/0140_checklist_editor_trigger_cleanup.sql" "$migrations/"

cat > "$config" <<EOF
name = "checklist-editor-d1-test"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"
database_name = "norlow-repair-production"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "$migrations"
EOF

cat > "$prelude" <<'SQL'
PRAGMA foreign_keys = ON;

CREATE TABLE app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE maintenance_checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE,
  equipment_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('pm','annual')),
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_by_user_id INTEGER,
  completed_by_user_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
);

CREATE TABLE maintenance_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES maintenance_checklist_runs(id) ON DELETE CASCADE,
  UNIQUE(checklist_run_id, item_number)
);

CREATE TABLE maintenance_checklist_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  checklist_item_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT,
  content_type TEXT,
  uploaded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES maintenance_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (checklist_item_id) REFERENCES maintenance_checklist_items(id) ON DELETE CASCADE
);
SQL

echo "Preparing production-shaped checklist tables in local Cloudflare D1..."
"$wrangler" d1 execute norlow-repair-production \
  --local \
  --persist-to "$persist" \
  --config "$config" \
  --file "$prelude"

echo "Applying checklist editor migrations through Wrangler's local migration path..."
"$wrangler" d1 migrations apply norlow-repair-production \
  --local \
  --persist-to "$persist" \
  --config "$config"

"$wrangler" d1 execute norlow-repair-production \
  --local \
  --persist-to "$persist" \
  --config "$config" \
  --command "CREATE TABLE checklist_editor_verification(ok INTEGER NOT NULL CHECK(ok=1)); INSERT INTO checklist_editor_verification(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_checklist_templates') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_checklist_template_items') AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_runs') WHERE name='template_id') AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_runs') WHERE name='template_version') AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='allow_pass') AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='require_photo') AND EXISTS(SELECT 1 FROM pragma_table_info('maintenance_checklist_items') WHERE name='measurement_value') AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name IN ('trg_snapshot_published_checklist_after_run','trg_block_legacy_items_for_versioned_checklist','trg_validate_versioned_checklist_answer','trg_keep_required_checklist_photo_after_answer')) THEN 1 ELSE 0 END;"

echo "Checklist editor Wrangler local migration test passed."
