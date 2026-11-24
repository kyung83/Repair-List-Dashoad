-- Optional reporting detail under an existing required Repair Type.
CREATE TABLE IF NOT EXISTS repair_type_subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_type_id INTEGER NOT NULL REFERENCES repair_types(id) ON DELETE RESTRICT,
  name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(repair_type_id,name)
);
ALTER TABLE repairs ADD COLUMN repair_subcategory_id INTEGER REFERENCES repair_type_subcategories(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_repair_subcategories_type ON repair_type_subcategories(repair_type_id,active,sort_order);
CREATE INDEX IF NOT EXISTS idx_repairs_subcategory ON repairs(repair_subcategory_id);

-- Enforce the parent relationship even if a repair is edited through another workflow.
CREATE TRIGGER repair_subcategory_insert_guard
BEFORE INSERT ON repairs
WHEN NEW.repair_subcategory_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM repair_type_subcategories s
  WHERE s.id=NEW.repair_subcategory_id AND s.repair_type_id=NEW.repair_type_id
)
BEGIN
  SELECT RAISE(ABORT,'Repair subcategory must belong to the selected Repair Type.');
END;
CREATE TRIGGER repair_subcategory_update_guard
BEFORE UPDATE OF repair_subcategory_id ON repairs
WHEN NEW.repair_subcategory_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM repair_type_subcategories s
  WHERE s.id=NEW.repair_subcategory_id AND s.repair_type_id=NEW.repair_type_id
)
BEGIN
  SELECT RAISE(ABORT,'Repair subcategory must belong to the selected Repair Type.');
END;
CREATE TRIGGER repair_subcategory_clear_on_type_change
AFTER UPDATE OF repair_type_id ON repairs
WHEN NEW.repair_type_id IS NOT OLD.repair_type_id AND NEW.repair_subcategory_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM repair_type_subcategories s
    WHERE s.id=NEW.repair_subcategory_id AND s.repair_type_id=NEW.repair_type_id
  )
BEGIN
  UPDATE repairs SET repair_subcategory_id=NULL WHERE id=NEW.id;
END;
-- A subcategory cannot move between parents; existing repair history would become invalid.
CREATE TRIGGER repair_subcategory_parent_immutable
BEFORE UPDATE OF repair_type_id ON repair_type_subcategories
WHEN NEW.repair_type_id IS NOT OLD.repair_type_id
BEGIN
  SELECT RAISE(ABORT,'Create a new subcategory under the other Repair Type instead.');
END;
