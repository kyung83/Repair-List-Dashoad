PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repair_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  unit_rule TEXT NOT NULL DEFAULT 'required' CHECK (unit_rule IN ('required','optional')),
  checklist_mode TEXT NOT NULL DEFAULT 'none' CHECK (checklist_mode IN ('none','optional','required')),
  system_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_repair_types_active_sort
ON repair_types(active, sort_order, name);

INSERT OR IGNORE INTO repair_types (code,name,active,sort_order,unit_rule,checklist_mode,system_key) VALUES
  ('emissions-scr-dpf-def','EMISSIONS-SCR-DPF-DEF',1,10,'required','none',NULL),
  ('air-intake-exhaust-egr','AIR INTAKE-EXHAUST-EGR',1,20,'required','none',NULL),
  ('engine','ENGINE',1,30,'required','none',NULL),
  ('cooling-system','COOLING SYSTEM',1,40,'required','none',NULL),
  ('air-brake-system-valves','AIR (BRAKE) SYSTEM-VALVES',1,50,'required','none',NULL),
  ('charging-starting-systems','CHARGING-STARTING SYSTEMS',1,60,'required','none',NULL),
  ('tires-rims','TIRES-RIMS',1,70,'required','none',NULL),
  ('transmission-clutch','TRANSMISSION-CLUTCH',1,80,'required','none',NULL),
  ('brakes-abs','BRAKES-ABS',1,90,'required','none',NULL),
  ('fuel','FUEL',1,100,'required','none',NULL),
  ('driveline-differential','DRIVELINE-DIFFERENTIAL',1,110,'required','none',NULL),
  ('hvac','HVAC',1,120,'required','none',NULL),
  ('suspension-steering-alignment','SUSPENSION-STEERING-ALIGNMENT',1,130,'required','none',NULL),
  ('gps-camera-accessory-safety','GPS-CAMERA-ACCESSORY-SAFETY',1,140,'required','none',NULL),
  ('5th-wheel','5TH WHEEL',1,150,'required','none',NULL),
  ('truck-trailer-body','TRUCK AND TRAILER BODY',1,160,'required','none',NULL),
  ('wheel-end','WHEEL END',1,170,'required','none',NULL),
  ('lights-electrical','LIGHTS & ELECTRICAL',1,180,'required','none',NULL),
  ('new-equipment-check','NEW EQUIPMENT CHECK',1,190,'required','required','new-equipment-check'),
  ('look-over','LOOK OVER',1,200,'required','optional','look-over'),
  ('indirect-labor-other','INDIRECT LABOR-OTHER',1,210,'optional','none','indirect-labor');

ALTER TABLE repairs ADD COLUMN repair_type_id INTEGER REFERENCES repair_types(id);
CREATE INDEX IF NOT EXISTS idx_repairs_repair_type ON repairs(repair_type_id, opened_at);

CREATE TABLE IF NOT EXISTS repair_type_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_type_id) REFERENCES repair_types(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE(repair_type_id, version)
);

CREATE INDEX IF NOT EXISTS idx_repair_type_checklist_templates_active
ON repair_type_checklist_templates(repair_type_id, active, version DESC);

CREATE TABLE IF NOT EXISTS repair_type_checklist_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  allow_pass INTEGER NOT NULL DEFAULT 1,
  allow_fail INTEGER NOT NULL DEFAULT 1,
  allow_na INTEGER NOT NULL DEFAULT 1,
  require_notes INTEGER NOT NULL DEFAULT 0,
  require_photo INTEGER NOT NULL DEFAULT 0,
  require_measurement INTEGER NOT NULL DEFAULT 0,
  measurement_label TEXT,
  measurement_unit TEXT,
  FOREIGN KEY (template_id) REFERENCES repair_type_checklist_templates(id) ON DELETE CASCADE,
  UNIQUE(template_id, position)
);

CREATE INDEX IF NOT EXISTS idx_repair_type_template_items
ON repair_type_checklist_template_items(template_id, position);

CREATE TABLE IF NOT EXISTS repair_type_checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE,
  equipment_id INTEGER NOT NULL,
  repair_type_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_by_user_id INTEGER,
  completed_by_user_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (repair_type_id) REFERENCES repair_types(id),
  FOREIGN KEY (template_id) REFERENCES repair_type_checklist_templates(id),
  FOREIGN KEY (started_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_type_checklist_runs_type
ON repair_type_checklist_runs(repair_type_id, status, started_at);

CREATE TABLE IF NOT EXISTS repair_type_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','na')),
  notes TEXT,
  allow_pass INTEGER NOT NULL DEFAULT 1,
  allow_fail INTEGER NOT NULL DEFAULT 1,
  allow_na INTEGER NOT NULL DEFAULT 1,
  require_notes INTEGER NOT NULL DEFAULT 0,
  require_photo INTEGER NOT NULL DEFAULT 0,
  require_measurement INTEGER NOT NULL DEFAULT 0,
  measurement_label TEXT,
  measurement_unit TEXT,
  measurement_value TEXT,
  corrective_repair_id INTEGER,
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES repair_type_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (corrective_repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE(checklist_run_id, item_number)
);

CREATE INDEX IF NOT EXISTS idx_repair_type_checklist_items_run
ON repair_type_checklist_items(checklist_run_id, item_number);

CREATE TABLE IF NOT EXISTS repair_type_checklist_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  checklist_item_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT,
  content_type TEXT,
  uploaded_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES repair_type_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (checklist_item_id) REFERENCES repair_type_checklist_items(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_type_checklist_photos_item
ON repair_type_checklist_photos(checklist_item_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_repair_type_required_checklist_guard
BEFORE UPDATE OF status ON repairs
WHEN lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND NEW.repair_type_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM repair_types rt
    WHERE rt.id = NEW.repair_type_id AND rt.checklist_mode = 'required'
  )
  AND NOT EXISTS (
    SELECT 1 FROM repair_type_checklist_runs cr
    WHERE cr.repair_id = NEW.id AND cr.status = 'completed'
  )
BEGIN
  SELECT RAISE(ABORT, 'Complete the required repair-type checklist before closing this work order.');
END;

CREATE TRIGGER IF NOT EXISTS trg_repair_type_started_checklist_guard
BEFORE UPDATE OF status ON repairs
WHEN lower(COALESCE(NEW.status,'')) LIKE '%complete%'
  AND EXISTS (
    SELECT 1 FROM repair_type_checklist_runs cr
    WHERE cr.repair_id = NEW.id AND cr.status <> 'completed'
  )
BEGIN
  SELECT RAISE(ABORT, 'Complete the started repair-type checklist before closing this work order.');
END;
