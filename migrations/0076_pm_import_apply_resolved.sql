PRAGMA foreign_keys = ON;

-- Apply the corrected 2026-08-18 PM spreadsheet after production resolution.
-- Rules approved by operations:
--   * replace this spreadsheet batch rather than layering duplicates;
--   * units marked as never having had a PM are absent from staging entirely;
--   * every included nonblank note becomes a real Future Repair for the next PM;
--   * never guess an equipment identity.
-- Production diagnostics resolved 263 of 264 staged units. 247(DC) has never
-- matched a truck in Equipment (including the earlier PM audit), so its single
-- PM event remains in a durable unresolved audit instead of being attached to an
-- unrelated trailer.

CREATE TABLE IF NOT EXISTS pm_import_unresolved_20260818 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_batch TEXT NOT NULL,
  source_unit TEXT NOT NULL,
  pm_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  mileage INTEGER,
  reason TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(import_batch, source_unit, pm_type, event_date)
);

CREATE TABLE _pm_import_validation_0076 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

-- Source/staging integrity.
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 509 THEN 1 ELSE 0 END FROM pm_import_stage_20260818;
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 263 THEN 1 ELSE 0 END FROM pm_import_stage_20260818 WHERE pm_type = '40';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 163 THEN 1 ELSE 0 END FROM pm_import_stage_20260818 WHERE pm_type = '20A';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 83 THEN 1 ELSE 0 END FROM pm_import_stage_20260818 WHERE pm_type = '20B';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END FROM pm_import_note_stage_20260818;

-- Production identity-resolution integrity. Exactly one source unit is allowed
-- to remain unresolved, and it must be the known truck label 247(DC).
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 264 THEN 1 ELSE 0 END FROM pm_import_unit_resolution_20260818;
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 263 THEN 1 ELSE 0 END
FROM pm_import_unit_resolution_20260818 WHERE equipment_id IS NOT NULL;
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM pm_import_unit_resolution_20260818 WHERE match_kind = 'ambiguous';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM pm_import_unit_resolution_20260818
WHERE equipment_id IS NULL AND staged_unit = '247(DC)' AND match_kind = 'unmatched';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM pm_import_unit_resolution_20260818
WHERE equipment_id IS NULL AND staged_unit <> '247(DC)';

-- All 54 note rows must resolve. 247(DC) has no note in the source sheet.
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END
FROM pm_import_note_stage_20260818 n
JOIN pm_import_unit_resolution_20260818 r ON r.staged_unit = n.unit
WHERE r.equipment_id IS NOT NULL;

-- The single unresolved PM row is preserved explicitly for later identity work.
DELETE FROM pm_import_unresolved_20260818 WHERE import_batch = 'pm-sheet-2026-08-18';
INSERT INTO pm_import_unresolved_20260818 (
  import_batch, source_unit, pm_type, event_date, mileage, reason
)
SELECT
  'pm-sheet-2026-08-18', s.unit, s.pm_type, s.event_date, s.mileage,
  'No current or prior canonical truck equipment record could be identified safely.'
FROM pm_import_stage_20260818 s
JOIN pm_import_unit_resolution_20260818 r ON r.staged_unit = s.unit
WHERE r.equipment_id IS NULL;

INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM pm_import_unresolved_20260818
WHERE import_batch = 'pm-sheet-2026-08-18'
  AND source_unit = '247(DC)'
  AND pm_type = '40'
  AND event_date = '2026-08-02'
  AND mileage = 648590;

-- Replace prior versions of this spreadsheet import.
DELETE FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18';

-- If Claude's earlier draft of the sheet was manually run, those rows were
-- ordinary open repairs. Retire them as replaced records rather than deleting
-- repair history. The new note records below are the authoritative Future Repairs.
UPDATE repairs
SET status = 'Completed - Replaced Import',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE source = 'pm-sheet-2026-08-18'
  AND lower(COALESCE(status, '')) NOT LIKE '%complete%';

-- Remove only the flat baseline import. Checklist/work-order maintenance history
-- uses different source values and is intentionally preserved.
DELETE FROM maintenance_events WHERE source = 'baseline';

-- Apply only rows whose physical equipment identity was resolved in production.
INSERT INTO maintenance_events (
  equipment_id, event_type, pm_type, event_date, mileage, source
)
SELECT
  r.equipment_id, 'pm', s.pm_type, s.event_date, s.mileage, 'pm-sheet-2026-08-18'
FROM pm_import_stage_20260818 s
JOIN pm_import_unit_resolution_20260818 r ON r.staged_unit = s.unit
WHERE r.equipment_id IS NOT NULL;

-- Every included note becomes a true Future Repair: one repair record plus its
-- pending pm_next_repairs queue link. Note text is preserved verbatim.
INSERT INTO repairs (
  equipment_id, title, description, status, priority, source, technician_id,
  opened_at, updated_at
)
SELECT
  r.equipment_id,
  n.note,
  n.note,
  'Deferred to Next PM',
  '2',
  'pm-sheet-2026-08-18-future',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM pm_import_note_stage_20260818 n
JOIN pm_import_unit_resolution_20260818 r ON r.staged_unit = n.unit
WHERE r.equipment_id IS NOT NULL;

INSERT INTO pm_next_repairs (
  equipment_id, description, status,
  origin_repair_id, queued_from_repair_id, target_repair_id,
  tagged_by_user_id, tagged_by_technician_id,
  tagged_at, updated_at, repair_id, target_event_type
)
SELECT
  resolution.equipment_id,
  notes.note,
  'pending',
  NULL, NULL, NULL,
  NULL, NULL,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  (
    SELECT repairs.id
    FROM repairs
    WHERE repairs.equipment_id = resolution.equipment_id
      AND repairs.source = 'pm-sheet-2026-08-18-future'
      AND repairs.title = notes.note
    ORDER BY repairs.id DESC
    LIMIT 1
  ),
  'pm'
FROM pm_import_note_stage_20260818 notes
JOIN pm_import_unit_resolution_20260818 resolution
  ON resolution.staged_unit = notes.unit
WHERE resolution.equipment_id IS NOT NULL;

-- pm_status.pm_type represents the NEXT PM due. Derive it from the latest
-- imported PM completion and the unit's configured profile sequence. If a unit
-- has no usable profile, use the standard 40 -> 20A -> 20B -> 40 rotation.
WITH ranked AS (
  SELECT
    me.equipment_id,
    me.pm_type,
    me.event_date,
    me.mileage,
    ROW_NUMBER() OVER (
      PARTITION BY me.equipment_id
      ORDER BY me.event_date DESC, me.id DESC
    ) AS rn
  FROM maintenance_events me
  WHERE me.source = 'pm-sheet-2026-08-18'
    AND me.event_type = 'pm'
),
latest AS (
  SELECT equipment_id, pm_type, event_date, mileage
  FROM ranked
  WHERE rn = 1
),
resolved_next AS (
  SELECT
    latest.equipment_id,
    latest.event_date,
    latest.mileage,
    CASE
      WHEN profiles.sequence_json IS NULL
        OR json_valid(profiles.sequence_json) = 0
        OR json_array_length(profiles.sequence_json) = 0
      THEN CASE latest.pm_type
        WHEN '40' THEN '20A'
        WHEN '20A' THEN '20B'
        WHEN '20B' THEN '40'
        ELSE latest.pm_type
      END
      WHEN NOT EXISTS (
        SELECT 1
        FROM json_each(profiles.sequence_json) item
        WHERE CAST(item.value AS TEXT) = latest.pm_type
      )
      THEN CAST(json_extract(profiles.sequence_json, '$[0]') AS TEXT)
      ELSE CAST(json_extract(
        profiles.sequence_json,
        '$[' || (
          (
            (SELECT CAST(item.key AS INTEGER)
             FROM json_each(profiles.sequence_json) item
             WHERE CAST(item.value AS TEXT) = latest.pm_type
             LIMIT 1) + 1
          ) % json_array_length(profiles.sequence_json)
        ) || ']'
      ) AS TEXT)
    END AS next_pm_type
  FROM latest
  LEFT JOIN equipment_pm_settings settings ON settings.equipment_id = latest.equipment_id
  LEFT JOIN pm_profiles profiles ON profiles.id = settings.profile_id
)
INSERT INTO pm_status (
  equipment_id, pm_type, status, last_mileage, service_date, updated_at
)
SELECT
  equipment_id, next_pm_type, 'Current', mileage, event_date, CURRENT_TIMESTAMP
FROM resolved_next
WHERE 1 = 1
ON CONFLICT(equipment_id) DO UPDATE SET
  pm_type = excluded.pm_type,
  status = 'Current',
  last_mileage = excluded.last_mileage,
  service_date = excluded.service_date,
  updated_at = CURRENT_TIMESTAMP;

-- Keep Equipment's service-date summary aligned with the latest imported PM.
WITH ranked AS (
  SELECT
    me.equipment_id,
    me.event_date,
    ROW_NUMBER() OVER (
      PARTITION BY me.equipment_id
      ORDER BY me.event_date DESC, me.id DESC
    ) AS rn
  FROM maintenance_events me
  WHERE me.source = 'pm-sheet-2026-08-18'
    AND me.event_type = 'pm'
)
UPDATE equipment
SET service_date = (
      SELECT ranked.event_date
      FROM ranked
      WHERE ranked.equipment_id = equipment.id AND ranked.rn = 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT equipment_id FROM ranked WHERE rn = 1
);

-- Post-apply integrity. Any failure aborts this entire migration.
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 508 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 262 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18' AND pm_type = '40';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 163 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18' AND pm_type = '20A';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 83 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18' AND pm_type = '20B';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(DISTINCT equipment_id) = 263 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END
FROM repairs WHERE source = 'pm-sheet-2026-08-18-future';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END
FROM pm_next_repairs queue
JOIN repairs repair ON repair.id = queue.repair_id
WHERE repair.source = 'pm-sheet-2026-08-18-future'
  AND queue.status = 'pending'
  AND queue.target_event_type = 'pm';
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 263 THEN 1 ELSE 0 END
FROM pm_status status
JOIN (
  SELECT DISTINCT equipment_id
  FROM maintenance_events
  WHERE source = 'pm-sheet-2026-08-18'
) imported ON imported.equipment_id = status.equipment_id;
INSERT INTO _pm_import_validation_0076
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM repairs repair
JOIN equipment e ON e.id = repair.equipment_id
WHERE repair.source = 'pm-sheet-2026-08-18-future'
  AND e.unit IN ('661(DC)', '667(SC)');

DROP TABLE _pm_import_validation_0076;

-- The raw source is permanently represented by the migration files and the one
-- unresolved audit row. Remove temporary staging/diagnostic tables only after the
-- live replacement and all post-apply checks succeed.
DROP TABLE pm_import_diagnostics_20260818;
DROP TABLE pm_import_unit_resolution_20260818;
DROP TABLE pm_import_note_stage_20260818;
DROP TABLE pm_import_stage_20260818;
