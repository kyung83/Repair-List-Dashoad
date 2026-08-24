PRAGMA foreign_keys = ON;

-- One visible PM kit can represent many interchangeable truck fitments while
-- keeping the existing pm_kits rows that the scheduled-PM trigger already knows
-- how to match. Each current family member is a concrete year/make/model/engine
-- combination; retired members are preserved so historical repair_planned_parts
-- rows do not lose their kit reference when a manager edits fitment rules later.
CREATE TABLE IF NOT EXISTS pm_kit_families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pm_type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pm_kit_families_type_active
ON pm_kit_families(pm_type, active);

CREATE TABLE IF NOT EXISTS pm_kit_family_members (
  family_id TEXT NOT NULL,
  pm_kit_id TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  retired_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (family_id, pm_kit_id),
  FOREIGN KEY (family_id) REFERENCES pm_kit_families(id) ON DELETE CASCADE,
  FOREIGN KEY (pm_kit_id) REFERENCES pm_kits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_kit_family_members_current
ON pm_kit_family_members(family_id, retired_at, sort_order, pm_kit_id);
