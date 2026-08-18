PRAGMA foreign_keys = ON;

-- Emergency guard for the 2026-08-18 Geotab fleet-sync incident.
-- Equipment archive state is owned by archived_at/archive_reason. A partial or
-- permission-limited Geotab response must never archive a truck simply because
-- it was absent from the response.
--
-- Restore Geotab device-backed trucks that were not deliberately archived.
-- Rows with archived_at set remain archived and are not touched.
UPDATE equipment
SET active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE geotab_device_id IS NOT NULL
  AND (geotab_trailer_id IS NULL OR TRIM(geotab_trailer_id) = '')
  AND archived_at IS NULL;

-- Defense in depth at the database boundary. Manual archiveEquipmentMasterItem
-- sets archived_at in the same UPDATE as active=0, so intentional archives are
-- allowed. Source-system/sync-only active=0 writes are immediately rejected for
-- Geotab truck/device rows whose lifecycle is still unarchived.
CREATE TRIGGER IF NOT EXISTS trg_geotab_truck_require_archive_state
AFTER UPDATE OF active ON equipment
WHEN NEW.active = 0
  AND NEW.archived_at IS NULL
  AND NEW.geotab_device_id IS NOT NULL
  AND (NEW.geotab_trailer_id IS NULL OR TRIM(NEW.geotab_trailer_id) = '')
BEGIN
  UPDATE equipment
  SET active = 1
  WHERE id = NEW.id;
END;
