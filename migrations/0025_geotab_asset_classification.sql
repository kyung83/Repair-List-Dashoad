PRAGMA foreign_keys = ON;

-- A Geotab Device can be installed on a trailer. Store the asset classification
-- derived from Geotab's group hierarchy separately from the device/trailer IDs.
ALTER TABLE equipment ADD COLUMN geotab_asset_class TEXT;

-- Preserve known trailer classifications immediately while the next Geotab
-- fleet sync fills this field from the current Group membership data.
UPDATE equipment
SET geotab_asset_class = 'trailer',
    equipment_type = 'trailer',
    updated_at = CURRENT_TIMESTAMP
WHERE (geotab_trailer_id IS NOT NULL AND TRIM(geotab_trailer_id) <> '')
   OR category = 'Trailers';

-- The DVIR sync also sees tracked trailers as Device objects. Once the fleet
-- master has classified a Device through Geotab's Trailer group tree, do not
-- allow a later Device update to change it back to truck.
CREATE TRIGGER IF NOT EXISTS preserve_geotab_group_trailer_equipment_type
AFTER UPDATE OF equipment_type, geotab_asset_class ON equipment
WHEN NEW.geotab_asset_class = 'trailer'
  AND NEW.equipment_type <> 'trailer'
BEGIN
  UPDATE equipment
  SET equipment_type = 'trailer',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
