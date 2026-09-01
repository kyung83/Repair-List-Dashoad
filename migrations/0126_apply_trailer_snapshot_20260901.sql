PRAGMA foreign_keys = ON;

-- Apply the 2026-09-01 trailer snapshot only to active trailer equipment.
-- Three-digit source units intentionally require TRL/TRAILER prefixes to avoid
-- ever touching a truck with the same bare numeric unit. Five-digit units use
-- the exact/suffixed matching rules already established by the prior trailer import.
DROP TABLE IF EXISTS _trailer_snapshot_matches_20260901;
CREATE TABLE _trailer_snapshot_matches_20260901 (
  source_unit TEXT PRIMARY KEY,
  equipment_id INTEGER NOT NULL,
  service_date TEXT,
  annual_date TEXT,
  notes TEXT NOT NULL,
  UNIQUE (equipment_id)
);

INSERT INTO _trailer_snapshot_matches_20260901
  (source_unit, equipment_id, service_date, annual_date, notes)
SELECT s.unit, e.id, s.service_date, s.annual_date, s.notes
FROM _trailer_snapshot_20260901 s
JOIN equipment e
  ON e.active = 1
 AND e.archived_at IS NULL
 AND (lower(COALESCE(e.equipment_type, '')) = 'trailer' OR e.geotab_trailer_id IS NOT NULL)
 AND (
      (
        length(s.unit) = 3
        AND (
          upper(trim(e.unit)) = 'TRL ' || upper(s.unit)
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || ' %'
          OR upper(trim(e.unit)) LIKE 'TRL ' || upper(s.unit) || '(%'
          OR upper(trim(e.unit)) = 'TRAILER ' || upper(s.unit)
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || ' %'
          OR upper(trim(e.unit)) LIKE 'TRAILER ' || upper(s.unit) || '(%'
        )
      )
      OR (
        length(s.unit) = 5
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
        )
      )
      OR (
        upper(s.unit) = 'PUP3'
        AND (
          upper(trim(e.unit)) = 'PUP3'
          OR upper(trim(e.unit)) LIKE 'PUP3 %'
          OR upper(trim(e.unit)) LIKE 'PUP3(%'
        )
      )
    );

DROP TABLE IF EXISTS _trailer_snapshot_guard_20260901;
CREATE TABLE _trailer_snapshot_guard_20260901 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

-- 606 source rows, 599 dated rows, and 7 notes-only new rows (53377-53383).
-- PUP3 remains optional because the prior production import documented that it
-- may not have a live equipment record. Every other dated row must resolve.
INSERT INTO _trailer_snapshot_guard_20260901 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM _trailer_snapshot_20260901) = 606
  AND (SELECT COUNT(*) FROM _trailer_snapshot_20260901 WHERE service_date IS NOT NULL) = 599
  AND (SELECT COUNT(*) FROM _trailer_snapshot_20260901 WHERE annual_date IS NOT NULL) = 599
  AND (SELECT COUNT(*) FROM _trailer_snapshot_20260901 WHERE trim(notes) <> '') = 156
  AND (
    SELECT COUNT(*) FROM _trailer_snapshot_20260901
    WHERE service_date IS NULL AND annual_date IS NULL
      AND unit IN ('53377','53378','53379','53380','53381','53382','53383')
  ) = 7
  AND NOT EXISTS (
    SELECT 1
    FROM _trailer_snapshot_20260901 s
    WHERE (s.service_date IS NOT NULL OR s.annual_date IS NOT NULL)
      AND upper(s.unit) <> 'PUP3'
      AND NOT EXISTS (
        SELECT 1 FROM _trailer_snapshot_matches_20260901 m
        WHERE m.source_unit = s.unit
      )
  )
THEN 1 ELSE 0 END;

INSERT INTO pm_status (equipment_id, service_date, annual_date, updated_at)
SELECT equipment_id, service_date, annual_date, CURRENT_TIMESTAMP
FROM _trailer_snapshot_matches_20260901
WHERE service_date IS NOT NULL OR annual_date IS NOT NULL
ON CONFLICT(equipment_id) DO UPDATE SET
  service_date = COALESCE(excluded.service_date, pm_status.service_date),
  annual_date = COALESCE(excluded.annual_date, pm_status.annual_date),
  updated_at = CURRENT_TIMESTAMP;

UPDATE equipment AS e
SET service_date = COALESCE((
      SELECT m.service_date FROM _trailer_snapshot_matches_20260901 m WHERE m.equipment_id=e.id
    ), e.service_date),
    annual_date = COALESCE((
      SELECT m.annual_date FROM _trailer_snapshot_matches_20260901 m WHERE m.equipment_id=e.id
    ), e.annual_date),
    notes = (
      SELECT m.notes FROM _trailer_snapshot_matches_20260901 m WHERE m.equipment_id=e.id
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE e.id IN (SELECT equipment_id FROM _trailer_snapshot_matches_20260901);

CREATE TABLE IF NOT EXISTS trailer_snapshot_import_receipts (
  import_batch TEXT PRIMARY KEY,
  source_rows INTEGER NOT NULL,
  matched_rows INTEGER NOT NULL,
  dated_rows INTEGER NOT NULL,
  notes_rows INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO trailer_snapshot_import_receipts
  (import_batch,source_rows,matched_rows,dated_rows,notes_rows,applied_at)
SELECT
 'trailer-snapshot-2026-09-01',
 (SELECT COUNT(*) FROM _trailer_snapshot_20260901),
 (SELECT COUNT(*) FROM _trailer_snapshot_matches_20260901),
 (SELECT COUNT(*) FROM _trailer_snapshot_20260901 WHERE service_date IS NOT NULL OR annual_date IS NOT NULL),
 (SELECT COUNT(*) FROM _trailer_snapshot_20260901 WHERE trim(notes) <> ''),
 CURRENT_TIMESTAMP;

DROP TABLE IF EXISTS _trailer_snapshot_verify_20260901;
CREATE TABLE _trailer_snapshot_verify_20260901 (ok INTEGER NOT NULL CHECK(ok=1));

INSERT INTO _trailer_snapshot_verify_20260901 (ok)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM _trailer_snapshot_matches_20260901 m
  JOIN equipment e ON e.id=m.equipment_id
  LEFT JOIN pm_status ps ON ps.equipment_id=m.equipment_id
  WHERE (m.service_date IS NOT NULL AND (e.service_date IS NOT m.service_date OR ps.service_date IS NOT m.service_date))
     OR (m.annual_date IS NOT NULL AND (e.annual_date IS NOT m.annual_date OR ps.annual_date IS NOT m.annual_date))
     OR e.notes IS NOT m.notes
) THEN 1 ELSE 0 END;

DROP TABLE _trailer_snapshot_verify_20260901;
DROP TABLE _trailer_snapshot_guard_20260901;
DROP TABLE _trailer_snapshot_matches_20260901;
DROP TABLE _trailer_snapshot_20260901;
