PRAGMA foreign_keys = ON;

-- Reusable truck PM kit templates. Matching criteria are optional so a kit can be
-- broad (all trucks for one PM type) or specific to year/make/model/engine.
CREATE TABLE IF NOT EXISTS pm_kits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pm_type TEXT NOT NULL,
  year_from INTEGER,
  year_to INTEGER,
  make TEXT,
  model TEXT,
  engine TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (year_from IS NULL OR (year_from >= 1900 AND year_from <= 2100)),
  CHECK (year_to IS NULL OR (year_to >= 1900 AND year_to <= 2100)),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);

CREATE INDEX IF NOT EXISTS idx_pm_kits_type_active
ON pm_kits(pm_type, active);

CREATE TABLE IF NOT EXISTS pm_kit_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pm_kit_id TEXT NOT NULL,
  part_id INTEGER NOT NULL,
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pm_kit_id) REFERENCES pm_kits(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  UNIQUE (pm_kit_id, part_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_kit_parts_kit
ON pm_kit_parts(pm_kit_id, sort_order, id);

-- Planned parts are copied from the matching kit when a PM work order is created.
-- They are intentionally separate from repair_parts so preloading a kit never
-- removes inventory. Actual inventory is only reduced when a technician uses a part.
CREATE TABLE IF NOT EXISTS repair_planned_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  pm_kit_id TEXT,
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  used_quantity REAL NOT NULL DEFAULT 0 CHECK (used_quantity >= 0),
  removed_at TEXT,
  removed_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id),
  FOREIGN KEY (pm_kit_id) REFERENCES pm_kits(id) ON DELETE SET NULL,
  FOREIGN KEY (removed_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (repair_id, part_id)
);

CREATE INDEX IF NOT EXISTS idx_repair_planned_parts_repair
ON repair_planned_parts(repair_id, removed_at);

-- A scheduled PM work order receives the single best matching active kit at insert
-- time. Specific year/make/model/engine rules win over broad defaults. This is a
-- copy: later edits to the kit do not rewrite a work order that is already underway.
CREATE TRIGGER IF NOT EXISTS trg_apply_pm_kit_to_new_work_order
AFTER INSERT ON repairs
WHEN NEW.source = 'scheduled-pm' AND NEW.equipment_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO repair_planned_parts (repair_id, part_id, pm_kit_id, quantity, used_quantity)
  SELECT NEW.id, kp.part_id, pk.id, kp.quantity, 0
  FROM pm_kits pk
  JOIN pm_kit_parts kp ON kp.pm_kit_id = pk.id
  JOIN equipment e ON e.id = NEW.equipment_id
  WHERE pk.active = 1
    AND lower(COALESCE(e.equipment_type,'')) IN ('truck','vehicle','glider','switcher')
    AND lower(trim(pk.pm_type)) = lower(trim(COALESCE((SELECT ps.pm_type FROM pm_status ps WHERE ps.equipment_id = NEW.equipment_id), '')))
    AND (pk.year_from IS NULL OR (e.model_year IS NOT NULL AND e.model_year >= pk.year_from))
    AND (pk.year_to IS NULL OR (e.model_year IS NOT NULL AND e.model_year <= pk.year_to))
    AND (trim(COALESCE(pk.make,'')) = '' OR lower(trim(pk.make)) = lower(trim(COALESCE(e.make,''))))
    AND (trim(COALESCE(pk.model,'')) = '' OR lower(trim(pk.model)) = lower(trim(COALESCE(e.model,''))))
    AND (trim(COALESCE(pk.engine,'')) = '' OR lower(trim(pk.engine)) = lower(trim(COALESCE(e.engine,''))))
    AND pk.id = (
      SELECT candidate.id
      FROM pm_kits candidate
      WHERE candidate.active = 1
        AND lower(trim(candidate.pm_type)) = lower(trim(COALESCE((SELECT ps2.pm_type FROM pm_status ps2 WHERE ps2.equipment_id = NEW.equipment_id), '')))
        AND (candidate.year_from IS NULL OR (e.model_year IS NOT NULL AND e.model_year >= candidate.year_from))
        AND (candidate.year_to IS NULL OR (e.model_year IS NOT NULL AND e.model_year <= candidate.year_to))
        AND (trim(COALESCE(candidate.make,'')) = '' OR lower(trim(candidate.make)) = lower(trim(COALESCE(e.make,''))))
        AND (trim(COALESCE(candidate.model,'')) = '' OR lower(trim(candidate.model)) = lower(trim(COALESCE(e.model,''))))
        AND (trim(COALESCE(candidate.engine,'')) = '' OR lower(trim(candidate.engine)) = lower(trim(COALESCE(e.engine,''))))
      ORDER BY
        (CASE WHEN candidate.year_from IS NOT NULL OR candidate.year_to IS NOT NULL THEN 1 ELSE 0 END
         + CASE WHEN trim(COALESCE(candidate.make,'')) <> '' THEN 1 ELSE 0 END
         + CASE WHEN trim(COALESCE(candidate.model,'')) <> '' THEN 1 ELSE 0 END
         + CASE WHEN trim(COALESCE(candidate.engine,'')) <> '' THEN 1 ELSE 0 END) DESC,
        CASE WHEN candidate.year_from IS NOT NULL AND candidate.year_to IS NOT NULL THEN candidate.year_to - candidate.year_from ELSE 9999 END ASC,
        candidate.updated_at DESC,
        candidate.id DESC
      LIMIT 1
    );
END;
