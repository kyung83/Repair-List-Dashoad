PRAGMA foreign_keys = ON;

-- Corrected runtime body for the unapplied 0056 trailer-date migration.
-- Apply the staged 2026-08-13 trailer service and annual dates to unique active trailer records.
-- All 599 numbered trailers must match. PUP3 is allowed to remain unmatched because the live
-- equipment table currently has no PUP3 record; if a unique active PUP3 trailer exists at apply
-- time, it will be updated too.
-- Confirmed incomplete source dates: 249 annual=2025-09-05; 53101 annual=2026-05-31;
-- 53260 service=2026-05-18.
CREATE TABLE IF NOT EXISTS _manual_trailer_date_matches_20260813 (
  source_unit TEXT PRIMARY KEY,
  equipment_id INTEGER NOT NULL UNIQUE,
  service_date TEXT NOT NULL,
  annual_date TEXT NOT NULL
);
DELETE FROM _manual_trailer_date_matches_20260813;

INSERT INTO _manual_trailer_date_matches_20260813 (source_unit, equipment_id, service_date, annual_date)
SELECT s.unit, e.id, s.service_date, s.annual_date
FROM _manual_trailer_dates_20260813 s
JOIN equipment e
  ON e.active = 1
 AND (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
 AND (
      upper(trim(e.unit)) = upper(s.unit)
      OR upper(trim(e.unit)) LIKE upper(s.unit) || ' %'
      OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
      OR upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' %'
      OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
      OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' %'
      OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
    );

CREATE TABLE IF NOT EXISTS _manual_trailer_dates_guard_20260813 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM _manual_trailer_dates_guard_20260813;
INSERT INTO _manual_trailer_dates_guard_20260813 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM _manual_trailer_dates_20260813) = 600
  AND EXISTS (
    SELECT 1 FROM _manual_trailer_dates_20260813
    WHERE unit = 'PUP3' AND service_date = '2026-06-05' AND annual_date = '2026-06-05'
  )
  AND (SELECT COUNT(*) FROM _manual_trailer_date_matches_20260813) BETWEEN 599 AND 600
  AND NOT EXISTS (
    SELECT 1
    FROM _manual_trailer_dates_20260813 s
    WHERE s.unit <> 'PUP3'
      AND NOT EXISTS (
        SELECT 1 FROM _manual_trailer_date_matches_20260813 m
        WHERE m.source_unit = s.unit
      )
  )
THEN 1 ELSE 0 END;

INSERT INTO pm_status (equipment_id, service_date, annual_date, updated_at)
SELECT equipment_id, service_date, annual_date, CURRENT_TIMESTAMP
FROM _manual_trailer_date_matches_20260813
WHERE 1 = 1
ON CONFLICT(equipment_id) DO UPDATE SET
  service_date = excluded.service_date,
  annual_date = excluded.annual_date,
  updated_at = CURRENT_TIMESTAMP;

UPDATE equipment AS e
SET service_date = (
      SELECT m.service_date
      FROM _manual_trailer_date_matches_20260813 m
      WHERE m.equipment_id = e.id
    ),
    annual_date = (
      SELECT m.annual_date
      FROM _manual_trailer_date_matches_20260813 m
      WHERE m.equipment_id = e.id
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE e.id IN (SELECT equipment_id FROM _manual_trailer_date_matches_20260813);

CREATE TABLE IF NOT EXISTS _manual_trailer_dates_verify_20260813 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM _manual_trailer_dates_verify_20260813;
INSERT INTO _manual_trailer_dates_verify_20260813 (ok)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM _manual_trailer_date_matches_20260813 m
  JOIN equipment e ON e.id = m.equipment_id
  LEFT JOIN pm_status ps ON ps.equipment_id = m.equipment_id
  WHERE e.service_date IS NOT m.service_date
     OR e.annual_date IS NOT m.annual_date
     OR ps.service_date IS NOT m.service_date
     OR ps.annual_date IS NOT m.annual_date
) THEN 1 ELSE 0 END;

DROP TABLE _manual_trailer_dates_verify_20260813;
DROP TABLE _manual_trailer_dates_guard_20260813;
DROP TABLE _manual_trailer_date_matches_20260813;
DROP TABLE _manual_trailer_dates_20260813;
