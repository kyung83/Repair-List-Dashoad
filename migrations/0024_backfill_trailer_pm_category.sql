PRAGMA foreign_keys = ON;

-- Trailer assignments used to apply the Trailer Service schedule without
-- persisting equipment.category = 'Trailers'. Backfill only trailers that
-- already have the Trailer Service PM profile so the category count and row
-- assignment state agree without assigning previously unscheduled trailers.
UPDATE equipment
SET category = 'Trailers',
    updated_at = CURRENT_TIMESTAMP
WHERE active = 1
  AND equipment_type = 'trailer'
  AND EXISTS (
    SELECT 1
    FROM equipment_pm_settings s
    JOIN pm_profiles p ON p.id = s.profile_id
    WHERE s.equipment_id = equipment.id
      AND p.name = 'Trailer Service'
  );
