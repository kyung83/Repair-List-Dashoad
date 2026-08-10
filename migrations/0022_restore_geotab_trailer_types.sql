PRAGMA foreign_keys = ON;

-- Geotab trailers can also have device records. A fleet sync used to force every
-- device-backed unit to truck after the DVIR sync had correctly marked trailers.
-- Restore the current master data from the durable Geotab trailer identity.
UPDATE equipment
SET equipment_type = 'trailer',
    updated_at = CURRENT_TIMESTAMP
WHERE geotab_trailer_id IS NOT NULL
  AND TRIM(geotab_trailer_id) <> ''
  AND equipment_type <> 'trailer';
