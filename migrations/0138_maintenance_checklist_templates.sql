PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS maintenance_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('pm','annual')),
  template_key TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (event_type, template_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_checklist_templates_active
ON maintenance_checklist_templates(event_type, template_key)
WHERE active = 1;

CREATE TABLE IF NOT EXISTS maintenance_checklist_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  allow_pass INTEGER NOT NULL DEFAULT 1 CHECK (allow_pass IN (0,1)),
  allow_fail INTEGER NOT NULL DEFAULT 1 CHECK (allow_fail IN (0,1)),
  allow_na INTEGER NOT NULL DEFAULT 1 CHECK (allow_na IN (0,1)),
  require_notes INTEGER NOT NULL DEFAULT 0 CHECK (require_notes IN (0,1)),
  require_photo INTEGER NOT NULL DEFAULT 0 CHECK (require_photo IN (0,1)),
  require_measurement INTEGER NOT NULL DEFAULT 0 CHECK (require_measurement IN (0,1)),
  measurement_label TEXT,
  measurement_unit TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES maintenance_checklist_templates(id) ON DELETE CASCADE,
  UNIQUE (template_id, position)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_checklist_template_items_template
ON maintenance_checklist_template_items(template_id, position);

ALTER TABLE maintenance_checklist_runs ADD COLUMN template_id INTEGER;
ALTER TABLE maintenance_checklist_runs ADD COLUMN template_version INTEGER;

ALTER TABLE maintenance_checklist_items ADD COLUMN allow_pass INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance_checklist_items ADD COLUMN allow_fail INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance_checklist_items ADD COLUMN allow_na INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance_checklist_items ADD COLUMN require_notes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance_checklist_items ADD COLUMN require_photo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance_checklist_items ADD COLUMN require_measurement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance_checklist_items ADD COLUMN measurement_label TEXT;
ALTER TABLE maintenance_checklist_items ADD COLUMN measurement_unit TEXT;
ALTER TABLE maintenance_checklist_items ADD COLUMN measurement_value TEXT;
