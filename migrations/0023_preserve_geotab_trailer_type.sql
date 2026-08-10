PRAGMA foreign_keys = ON;

-- A unit with a Geotab Trailer identity must remain a trailer even if another
-- sync also sees the same physical asset through the Device collection.
CREATE TRIGGER IF NOT EXISTS preserve_geotab_trailer_equipment_type
AFTER UPDATE OF equipment_type ON equipment
WHEN NEW.geotab_trailer_id IS NOT NULL
  AND TRIM(NEW.geotab_trailer_id) <> ''
  AND NEW.equipment_type <> 'trailer'
BEGIN
  UPDATE equipment
  SET equipment_type = 'trailer',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
