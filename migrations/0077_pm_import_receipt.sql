PRAGMA foreign_keys = ON;

-- Stable receipt for the completed PM spreadsheet replacement. This lets the
-- deployment health endpoint verify what 0076 applied without depending on the
-- Future Repair queue remaining pending forever.
CREATE TABLE IF NOT EXISTS pm_import_receipts (
  import_batch TEXT PRIMARY KEY,
  pm_events INTEGER NOT NULL,
  resolved_units INTEGER NOT NULL,
  pm_40 INTEGER NOT NULL,
  pm_20a INTEGER NOT NULL,
  pm_20b INTEGER NOT NULL,
  future_repairs INTEGER NOT NULL,
  unresolved_events INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE _pm_import_validation_0077 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(*) = 508 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18';
INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(DISTINCT equipment_id) = 263 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18';
INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(*) = 262 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18' AND pm_type = '40';
INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(*) = 163 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18' AND pm_type = '20A';
INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(*) = 83 THEN 1 ELSE 0 END
FROM maintenance_events WHERE source = 'pm-sheet-2026-08-18' AND pm_type = '20B';
INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END
FROM repairs WHERE source = 'pm-sheet-2026-08-18-future';
INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END
FROM pm_next_repairs queue
JOIN repairs repair ON repair.id = queue.repair_id
WHERE repair.source = 'pm-sheet-2026-08-18-future';
INSERT INTO _pm_import_validation_0077
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM pm_import_unresolved_20260818
WHERE import_batch = 'pm-sheet-2026-08-18'
  AND source_unit = '247(DC)'
  AND pm_type = '40'
  AND event_date = '2026-08-02'
  AND mileage = 648590;

INSERT OR REPLACE INTO pm_import_receipts (
  import_batch, pm_events, resolved_units, pm_40, pm_20a, pm_20b,
  future_repairs, unresolved_events, applied_at
)
VALUES (
  'pm-sheet-2026-08-18', 508, 263, 262, 163, 83, 54, 1, CURRENT_TIMESTAMP
);

DROP TABLE _pm_import_validation_0077;
