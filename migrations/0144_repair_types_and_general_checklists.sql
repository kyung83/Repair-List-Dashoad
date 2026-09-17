PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repair_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  unit_rule TEXT NOT NULL DEFAULT 'required' CHECK (unit_rule IN ('required','optional')),
  checklist_mode TEXT NOT NULL DEFAULT 'none' CHECK (checklist_mode IN ('none','optional','required')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO repair_types (name,unit_rule,checklist_mode,active,sort_order) VALUES
 ('EMISSIONS-SCR-DPF-DEF','required','none',1,1),
 ('AIR INTAKE-EXHAUST-EGR','required','none',1,2),
 ('ENGINE','required','none',1,3),
 ('COOLING SYSTEM','required','none',1,4),
 ('AIR (BRAKE) SYSTEM-VALVES','required','none',1,5),
 ('CHARGING-STARTING SYSTEMS','required','none',1,6),
 ('TIRES-RIMS','required','none',1,7),
 ('TRANSMISSION-CLUTCH','required','none',1,8),
 ('BRAKES-ABS','required','none',1,9),
 ('FUEL','required','none',1,10),
 ('DRIVELINE-DIFFERENTIAL','required','none',1,11),
 ('HVAC','required','none',1,12),
 ('SUSPENSION-STEERING-ALIGNMENT','required','none',1,13),
 ('GPS-CAMERA-ACCESSORY-SAFETY','required','none',1,14),
 ('5TH WHEEL','required','none',1,15),
 ('TRUCK AND TRAILER BODY','required','none',1,16),
 ('WHEEL END','required','none',1,17),
 ('LIGHTS & ELECTRICAL','required','none',1,18),
 ('NEW EQUIPMENT CHECK','required','required',1,19),
 ('LOOK OVER','required','optional',1,20),
 ('INDIRECT LABOR-OTHER','optional','none',1,21);

ALTER TABLE repairs ADD COLUMN repair_type_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_repairs_repair_type ON repairs(repair_type_id);
CREATE INDEX IF NOT EXISTS idx_repair_types_active_order ON repair_types(active,sort_order,name);

CREATE TABLE IF NOT EXISTS repair_type_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_type_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_type_id) REFERENCES repair_types(id),
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (repair_type_id,version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_type_checklist_template_active
ON repair_type_checklist_templates(repair_type_id)
WHERE active = 1;

CREATE TABLE IF NOT EXISTS repair_type_checklist_template_items (
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
  FOREIGN KEY (template_id) REFERENCES repair_type_checklist_templates(id) ON DELETE CASCADE,
  UNIQUE (template_id,position)
);

CREATE TABLE IF NOT EXISTS repair_type_checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL UNIQUE,
  repair_type_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_by_user_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (repair_type_id) REFERENCES repair_types(id),
  FOREIGN KEY (template_id) REFERENCES repair_type_checklist_templates(id),
  FOREIGN KEY (started_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS repair_type_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_run_id INTEGER NOT NULL,
  item_number INTEGER NOT NULL CHECK (item_number > 0),
  section TEXT NOT NULL,
  item_text TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','na')),
  notes TEXT,
  allow_pass INTEGER NOT NULL DEFAULT 1 CHECK (allow_pass IN (0,1)),
  allow_fail INTEGER NOT NULL DEFAULT 1 CHECK (allow_fail IN (0,1)),
  allow_na INTEGER NOT NULL DEFAULT 1 CHECK (allow_na IN (0,1)),
  require_notes INTEGER NOT NULL DEFAULT 0 CHECK (require_notes IN (0,1)),
  require_photo INTEGER NOT NULL DEFAULT 0 CHECK (require_photo IN (0,1)),
  require_measurement INTEGER NOT NULL DEFAULT 0 CHECK (require_measurement IN (0,1)),
  measurement_label TEXT,
  measurement_unit TEXT,
  measurement_value TEXT,
  corrective_repair_id INTEGER,
  updated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_run_id) REFERENCES repair_type_checklist_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (corrective_repair_id) REFERENCES repairs(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (checklist_run_id,item_number)
);

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

CREATE INDEX IF NOT EXISTS idx_repair_type_checklist_items_run ON repair_type_checklist_items(checklist_run_id,item_number);
CREATE INDEX IF NOT EXISTS idx_repair_type_checklist_photos_item ON repair_type_checklist_photos(checklist_item_id);

-- Give New Equipment Check a safe starter checklist. Managers can replace this
-- immediately in Repair Type Setup without affecting inspections already started.
INSERT OR IGNORE INTO repair_type_checklist_templates (repair_type_id,name,version,active)
SELECT id,'New Equipment Check',1,1 FROM repair_types WHERE name='NEW EQUIPMENT CHECK';

INSERT OR IGNORE INTO repair_type_checklist_template_items (
  template_id,position,section,item_text,enabled,allow_pass,allow_fail,allow_na
)
SELECT t.id,1,'General','Complete the configured new-equipment inspection and record the result.',1,1,1,1
FROM repair_type_checklist_templates t
JOIN repair_types rt ON rt.id=t.repair_type_id
WHERE rt.name='NEW EQUIPMENT CHECK' AND t.version=1;
