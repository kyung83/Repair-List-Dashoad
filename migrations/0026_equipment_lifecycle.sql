PRAGMA foreign_keys = ON;

-- Archiving is a lifecycle state, never a delete. Existing repairs, PM events,
-- expenses, inventory compatibility and imported RO history keep their equipment_id.
ALTER TABLE equipment ADD COLUMN archived_at TEXT;
ALTER TABLE equipment ADD COLUMN archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_equipment_archived_at ON equipment(archived_at);

-- Geotab syncs mark current assets active. A deliberately archived unit must
-- stay archived until a dashboard user explicitly restores it.
CREATE TRIGGER IF NOT EXISTS trg_equipment_keep_archived
AFTER UPDATE OF active ON equipment
WHEN NEW.archived_at IS NOT NULL AND NEW.active <> 0
BEGIN
  UPDATE equipment
  SET active = 0
  WHERE id = NEW.id;
END;
