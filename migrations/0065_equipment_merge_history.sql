PRAGMA foreign_keys = ON;

-- Historical Geotab forks are retired as tombstones rather than deleted. The
-- canonical equipment row keeps the live identity while the merged row remains
-- available for audit/provenance and cannot be restored into service.
ALTER TABLE equipment ADD COLUMN merged_into_equipment_id INTEGER REFERENCES equipment(id);
ALTER TABLE equipment ADD COLUMN merged_at TEXT;
ALTER TABLE equipment ADD COLUMN merged_by_user_id INTEGER REFERENCES app_users(id);
ALTER TABLE equipment ADD COLUMN merge_note TEXT;

CREATE INDEX IF NOT EXISTS idx_equipment_merged_into
ON equipment(merged_into_equipment_id, merged_at);

CREATE TABLE IF NOT EXISTS equipment_merge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_equipment_id INTEGER NOT NULL UNIQUE,
  target_equipment_id INTEGER NOT NULL,
  source_unit TEXT NOT NULL,
  target_unit TEXT NOT NULL,
  source_geotab_device_id TEXT,
  target_geotab_device_id TEXT,
  source_vin TEXT,
  target_vin TEXT,
  source_snapshot_json TEXT NOT NULL,
  target_snapshot_json TEXT NOT NULL,
  reference_counts_json TEXT NOT NULL,
  merged_by_user_id INTEGER,
  merge_note TEXT,
  merged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (target_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (merged_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (source_equipment_id <> target_equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_merge_events_target
ON equipment_merge_events(target_equipment_id, merged_at);

-- Once a row becomes a merged tombstone, remove its legacy matching keys so the
-- live Geotab sync cannot rediscover it by device ID, VIN, trailer ID, or unit
-- name. The immutable merge event above retains the original identity and full
-- row snapshot for audit. Device-assignment history is moved to the canonical row.
CREATE TRIGGER IF NOT EXISTS trg_equipment_sanitize_merged_identity
AFTER UPDATE OF merged_into_equipment_id ON equipment
WHEN OLD.merged_into_equipment_id IS NULL
  AND NEW.merged_into_equipment_id IS NOT NULL
BEGIN
  UPDATE equipment
  SET unit = 'MERGED-' || NEW.id || '-' || NEW.unit,
      geotab_device_id = NULL,
      geotab_trailer_id = NULL,
      vin = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

-- An overlapping cron sync may have read a unit immediately before the admin
-- merge and finish a stale metadata write immediately after it. Keep the legacy
-- identity keys retired on every later update so that stale work cannot make the
-- tombstone eligible for future Geotab identity matching again.
CREATE TRIGGER IF NOT EXISTS trg_equipment_keep_merged_identity_retired
AFTER UPDATE OF geotab_device_id, geotab_trailer_id, vin ON equipment
WHEN NEW.merged_into_equipment_id IS NOT NULL
  AND (NEW.geotab_device_id IS NOT NULL OR NEW.geotab_trailer_id IS NOT NULL OR NEW.vin IS NOT NULL)
BEGIN
  UPDATE equipment
  SET geotab_device_id = NULL,
      geotab_trailer_id = NULL,
      vin = NULL,
      active = 0,
      archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

-- Keep the unit-name namespace isolated too. The first sanitize operation adds
-- the prefix; any later edit that removes it is normalized back under the merged
-- namespace instead of becoming a candidate for name-based matching.
CREATE TRIGGER IF NOT EXISTS trg_equipment_keep_merged_unit_retired
AFTER UPDATE OF unit ON equipment
WHEN NEW.merged_into_equipment_id IS NOT NULL
  AND substr(NEW.unit, 1, length('MERGED-' || NEW.id || '-')) <> 'MERGED-' || NEW.id || '-'
BEGIN
  UPDATE equipment
  SET unit = 'MERGED-' || NEW.id || '-' || NEW.unit,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

-- Device-assignment history is moved off the duplicate before it is marked
-- merged. No later sync or admin action may attach hardware back to a tombstone.
CREATE TRIGGER IF NOT EXISTS trg_geotab_assignment_reject_merged_insert
BEFORE INSERT ON equipment_geotab_devices
WHEN EXISTS (
  SELECT 1 FROM equipment e
  WHERE e.id = NEW.equipment_id AND e.merged_into_equipment_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Geotab devices cannot be assigned to merged equipment.');
END;

CREATE TRIGGER IF NOT EXISTS trg_geotab_assignment_reject_merged_update
BEFORE UPDATE OF equipment_id, current ON equipment_geotab_devices
WHEN EXISTS (
  SELECT 1 FROM equipment e
  WHERE e.id = NEW.equipment_id AND e.merged_into_equipment_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Geotab devices cannot be assigned to merged equipment.');
END;

-- Defense in depth: a merged row is a historical tombstone. Even if another
-- code path tries to restore it, the database refuses to make it active again.
CREATE TRIGGER IF NOT EXISTS trg_equipment_prevent_restore_merged
BEFORE UPDATE OF active, archived_at ON equipment
WHEN OLD.merged_into_equipment_id IS NOT NULL
  AND (NEW.active <> 0 OR NEW.archived_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Merged equipment records cannot be restored.');
END;
