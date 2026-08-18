PRAGMA foreign_keys = ON;

-- Repair Board managers can mark a DVIR defect repaired even when Geotab
-- writeback is temporarily unavailable. Keep that explicit local decision
-- durable across later Geotab syncs without making all Geotab repairs sticky.
ALTER TABLE dvir_defects ADD COLUMN local_repaired INTEGER NOT NULL DEFAULT 0 CHECK (local_repaired IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_dvir_defects_local_repaired
ON dvir_defects(local_repaired, repaired, updated_at);

CREATE TRIGGER IF NOT EXISTS trg_dvir_keep_local_repair
AFTER UPDATE OF repaired ON dvir_defects
WHEN NEW.local_repaired = 1 AND NEW.repaired = 0
BEGIN
  UPDATE dvir_defects
  SET repaired = 1,
      repair_date = COALESCE(OLD.repair_date, NEW.repair_date, CURRENT_TIMESTAMP)
  WHERE geotab_defect_id = NEW.geotab_defect_id;
END;
