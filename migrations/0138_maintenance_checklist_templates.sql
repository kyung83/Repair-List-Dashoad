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

-- New PM/Annual runs snapshot the active published template at the instant the
-- inspection starts. Older/in-progress runs never read a newer template.
CREATE TRIGGER IF NOT EXISTS trg_snapshot_published_checklist_after_run
AFTER INSERT ON maintenance_checklist_runs
WHEN EXISTS (
  SELECT 1
  FROM maintenance_checklist_templates t
  WHERE t.event_type = NEW.event_type
    AND t.template_key = 'default'
    AND t.active = 1
)
BEGIN
  UPDATE maintenance_checklist_runs
  SET template_id = (
        SELECT t.id
        FROM maintenance_checklist_templates t
        WHERE t.event_type = NEW.event_type
          AND t.template_key = 'default'
          AND t.active = 1
        ORDER BY t.version DESC
        LIMIT 1
      ),
      template_version = (
        SELECT t.version
        FROM maintenance_checklist_templates t
        WHERE t.event_type = NEW.event_type
          AND t.template_key = 'default'
          AND t.active = 1
        ORDER BY t.version DESC
        LIMIT 1
      ),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;

  INSERT OR IGNORE INTO maintenance_checklist_items (
    checklist_run_id, item_number, section, item_text, result,
    allow_pass, allow_fail, allow_na,
    require_notes, require_photo, require_measurement,
    measurement_label, measurement_unit, updated_at
  )
  SELECT
    NEW.id,
    i.position,
    i.section,
    i.item_text,
    'pending',
    i.allow_pass,
    i.allow_fail,
    i.allow_na,
    i.require_notes,
    i.require_photo,
    i.require_measurement,
    i.measurement_label,
    i.measurement_unit,
    CURRENT_TIMESTAMP
  FROM maintenance_checklist_template_items i
  JOIN maintenance_checklist_templates t ON t.id = i.template_id
  WHERE t.event_type = NEW.event_type
    AND t.template_key = 'default'
    AND t.active = 1
    AND i.enabled = 1
  ORDER BY i.position;
END;

-- The legacy checklist initializer still attempts to insert its built-in
-- questions after creating a run. Once a run has a versioned template, ignore
-- legacy positions that are disabled or absent from that template. Positions
-- already snapshotted above are protected by the existing run/item unique key.
CREATE TRIGGER IF NOT EXISTS trg_block_legacy_items_for_versioned_checklist
BEFORE INSERT ON maintenance_checklist_items
WHEN EXISTS (
  SELECT 1 FROM maintenance_checklist_runs r
  WHERE r.id = NEW.checklist_run_id AND r.template_id IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM maintenance_checklist_runs r
  JOIN maintenance_checklist_template_items i ON i.template_id = r.template_id
  WHERE r.id = NEW.checklist_run_id
    AND i.position = NEW.item_number
    AND i.enabled = 1
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS trg_validate_versioned_checklist_answer
BEFORE UPDATE OF result, notes, measurement_value ON maintenance_checklist_items
WHEN NEW.result <> 'pending'
BEGIN
  SELECT CASE
    WHEN NEW.result = 'pass' AND NEW.allow_pass = 0
      THEN RAISE(ABORT, 'Pass is not allowed for this checklist item.')
    WHEN NEW.result = 'fail' AND NEW.allow_fail = 0
      THEN RAISE(ABORT, 'Fail is not allowed for this checklist item.')
    WHEN NEW.result = 'na' AND NEW.allow_na = 0
      THEN RAISE(ABORT, 'N/A is not allowed for this checklist item.')
    WHEN NEW.require_notes = 1 AND COALESCE(TRIM(NEW.notes), '') = ''
      THEN RAISE(ABORT, 'A note is required for this checklist item.')
    WHEN NEW.require_measurement = 1 AND COALESCE(TRIM(NEW.measurement_value), '') = ''
      THEN RAISE(ABORT, 'A measurement is required for this checklist item.')
    WHEN NEW.require_photo = 1 AND NOT EXISTS (
      SELECT 1 FROM maintenance_checklist_photos p WHERE p.checklist_item_id = NEW.id
    )
      THEN RAISE(ABORT, 'A photo is required for this checklist item.')
  END;
END;
