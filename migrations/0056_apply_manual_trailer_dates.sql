PRAGMA foreign_keys = ON;

-- Apply the staged 2026-08-13 trailer service and annual dates only after all source rows exist
-- and every supplied trailer identifier matches at least one trailer record.
-- Confirmed incomplete source dates: 249 annual=2025-09-05; 53101 annual=2026-05-31;
-- 53260 service=2026-05-18.
CREATE TABLE IF NOT EXISTS _manual_trailer_dates_guard_20260813 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM _manual_trailer_dates_guard_20260813;
INSERT INTO _manual_trailer_dates_guard_20260813 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM _manual_trailer_dates_20260813) = 600
  AND (
    SELECT COUNT(*)
    FROM _manual_trailer_dates_20260813 s
    WHERE EXISTS (
      SELECT 1 FROM equipment e
      WHERE (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
        AND (
      upper(trim(e.unit)) = upper(s.unit)
      OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
      OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
      OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
    )
    )
  ) = 600
THEN 1 ELSE 0 END;

INSERT INTO pm_status (equipment_id, service_date, annual_date, updated_at)
SELECT e.id, s.service_date, s.annual_date, CURRENT_TIMESTAMP
FROM equipment e
JOIN _manual_trailer_dates_20260813 s ON (
      upper(trim(e.unit)) = upper(s.unit)
      OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
      OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
      OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
    )
WHERE (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
ON CONFLICT(equipment_id) DO UPDATE SET
  service_date = excluded.service_date,
  annual_date = excluded.annual_date,
  updated_at = CURRENT_TIMESTAMP;

UPDATE equipment AS e
SET service_date = (
      SELECT s.service_date FROM _manual_trailer_dates_20260813 s
      WHERE (
      upper(trim(e.unit)) = upper(s.unit)
      OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
      OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
      OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
    )
      LIMIT 1
    ),
    annual_date = (
      SELECT s.annual_date FROM _manual_trailer_dates_20260813 s
      WHERE (
      upper(trim(e.unit)) = upper(s.unit)
      OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
      OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
      OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
    )
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM _manual_trailer_dates_20260813 s
    WHERE (
      upper(trim(e.unit)) = upper(s.unit)
      OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
      OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
      OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' (%'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
    )
  );

DROP TABLE _manual_trailer_dates_guard_20260813;
DROP TABLE _manual_trailer_dates_20260813;
