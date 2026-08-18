PRAGMA foreign_keys = ON;

-- Emergency guard for the 2026-08-18 Geotab fleet-sync incident.
-- Equipment archive state is owned by archived_at/archive_reason. A partial or
-- permission-limited Geotab response must never archive a truck simply because
-- it was absent from the response.
--
-- Production contains historical/alias rows that share a geotab_device_id. The
-- active-device partial unique index permits those duplicates while inactive,
-- so restoring every unarchived row at once can fail. Restore exactly one
-- canonical unarchived truck row per Geotab device and leave duplicate/alias
-- rows untouched for later reconciliation instead of deleting or relinking
-- history during an emergency recovery.
--
-- Canonical preference:
--   1. a row that is already active,
--   2. the row with the most repair history,
--   3. the row with a real/highest mileage reading,
--   4. the oldest equipment row as a deterministic tie-breaker.
UPDATE equipment AS e
SET active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE e.geotab_device_id IS NOT NULL
  AND TRIM(e.geotab_device_id) <> ''
  AND (e.geotab_trailer_id IS NULL OR TRIM(e.geotab_trailer_id) = '')
  AND e.archived_at IS NULL
  AND e.id = (
    SELECT candidate.id
    FROM equipment AS candidate
    WHERE candidate.geotab_device_id = e.geotab_device_id
      AND (candidate.geotab_trailer_id IS NULL OR TRIM(candidate.geotab_trailer_id) = '')
      AND candidate.archived_at IS NULL
    ORDER BY
      candidate.active DESC,
      (SELECT COUNT(*) FROM repairs AS r WHERE r.equipment_id = candidate.id) DESC,
      CASE WHEN COALESCE(candidate.current_mileage, 0) > 0 THEN 1 ELSE 0 END DESC,
      COALESCE(candidate.current_mileage, 0) DESC,
      candidate.id ASC
    LIMIT 1
  );

-- Defense in depth at the database boundary. Manual archiveEquipmentMasterItem
-- sets archived_at in the same UPDATE as active=0, so intentional archives are
-- allowed. Source-system/sync-only active=0 writes are rejected for an
-- unarchived Geotab truck only when doing so cannot violate the production
-- one-active-row-per-device constraint. If another row for the same device is
-- already active, leave this duplicate/alias row inactive.
CREATE TRIGGER IF NOT EXISTS trg_geotab_truck_require_archive_state
AFTER UPDATE OF active ON equipment
WHEN NEW.active = 0
  AND NEW.archived_at IS NULL
  AND NEW.geotab_device_id IS NOT NULL
  AND TRIM(NEW.geotab_device_id) <> ''
  AND (NEW.geotab_trailer_id IS NULL OR TRIM(NEW.geotab_trailer_id) = '')
  AND NOT EXISTS (
    SELECT 1
    FROM equipment AS other
    WHERE other.id <> NEW.id
      AND other.geotab_device_id = NEW.geotab_device_id
      AND other.active = 1
  )
BEGIN
  UPDATE equipment
  SET active = 1
  WHERE id = NEW.id;
END;
