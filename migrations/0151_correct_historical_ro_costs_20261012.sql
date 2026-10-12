PRAGMA foreign_keys = ON;

-- Approved corrections to two imported historical repair orders.
-- These are COMPLETE RO totals, including the existing labor amounts.
-- Fail rather than changing any other RO if the production records differ
-- from the original imported closed ROs and their single detail lines.

CREATE TABLE IF NOT EXISTS historical_ro_cost_corrections (
  import_key TEXT NOT NULL,
  ro_number TEXT NOT NULL,
  equipment_id INTEGER NOT NULL,
  original_parts_cost REAL NOT NULL,
  original_labor_cost REAL NOT NULL,
  original_sublet_cost REAL NOT NULL,
  original_total_cost REAL NOT NULL,
  corrected_parts_cost REAL NOT NULL,
  corrected_total_cost REAL NOT NULL,
  reason TEXT NOT NULL,
  corrected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (import_key, ro_number)
);

-- Every change is recorded; unlike the current-value corrections table,
-- the change log is append-only and can show repeated edits to the same RO.
CREATE TABLE IF NOT EXISTS historical_ro_cost_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_key TEXT NOT NULL,
  ro_number TEXT NOT NULL,
  equipment_id INTEGER NOT NULL,
  changed_by_user_id INTEGER,
  changed_by TEXT NOT NULL,
  previous_parts_cost REAL NOT NULL,
  previous_labor_cost REAL NOT NULL,
  previous_sublet_cost REAL NOT NULL,
  previous_total_cost REAL NOT NULL,
  new_parts_cost REAL NOT NULL,
  new_total_cost REAL NOT NULL,
  reason TEXT NOT NULL,
  guard_verified INTEGER NOT NULL DEFAULT 1 CHECK (guard_verified = 1),
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_historical_ro_cost_change_log_ro
ON historical_ro_cost_change_log(import_key, ro_number, id DESC);

CREATE TABLE _historical_ro_cost_expected_20261012 (
  import_key TEXT NOT NULL,
  ro_number TEXT NOT NULL,
  unit TEXT NOT NULL,
  ro_date TEXT NOT NULL,
  system_code TEXT NOT NULL,
  assembly_code TEXT NOT NULL,
  original_parts_cost REAL NOT NULL,
  original_labor_cost REAL NOT NULL,
  original_total_cost REAL NOT NULL,
  corrected_parts_cost REAL NOT NULL,
  corrected_total_cost REAL NOT NULL,
  PRIMARY KEY (import_key, ro_number)
);

INSERT INTO _historical_ro_cost_expected_20261012
  (import_key, ro_number, unit, ro_date, system_code, assembly_code,
   original_parts_cost, original_labor_cost, original_total_cost,
   corrected_parts_cost, corrected_total_cost)
VALUES
  ('ro-history-9309499-v1', 'WO085385', '324(DC)', '2026-01-12', '043', '007',
   63479.66, 60.00, 63539.66, 573.00, 633.00),
  ('ro-history-9309499-v1', 'WO086883', '373(DC)', '2026-02-23', '033', '000',
   95989.46, 460.00, 96449.46, 5544.53, 6004.53);

CREATE TABLE _historical_ro_cost_guard_20261012 (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

-- Preflight: exactly the two expected closed ROs, each with exactly one
-- unchanged detail line and the expected unit/date/labor/parts/total.
-- Abort before updating any financial data if even one check fails.
INSERT INTO _historical_ro_cost_guard_20261012 (valid)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM _historical_ro_cost_expected_20261012) = 2
  AND (
    SELECT COUNT(*)
    FROM _historical_ro_cost_expected_20261012 x
    JOIN historical_repairs h
      ON h.import_key = x.import_key AND h.ro_number = x.ro_number
    JOIN equipment e ON e.id = h.equipment_id
    JOIN historical_repair_lines l
      ON l.historical_repair_id = h.id
    WHERE e.unit = x.unit
      AND h.ro_date = x.ro_date
      AND h.source_status = 'CLOSED'
      AND h.line_count = 1
      AND l.import_key = x.import_key
      AND l.ro_number = x.ro_number
      AND l.system_code = x.system_code
      AND l.assembly_code = x.assembly_code
      AND (SELECT COUNT(*) FROM historical_repair_lines ll WHERE ll.historical_repair_id = h.id) = 1
      AND ABS(h.parts_cost - x.original_parts_cost) < 0.005
      AND ABS(h.labor_cost - x.original_labor_cost) < 0.005
      AND ABS(h.total_cost - x.original_total_cost) < 0.005
      AND ABS(h.sublet_cost) < 0.005
      AND ABS(l.parts_cost - x.original_parts_cost) < 0.005
      AND ABS(l.labor_cost - x.original_labor_cost) < 0.005
      AND ABS(l.total_cost - x.original_total_cost) < 0.005
      AND ABS(l.sublet_cost) < 0.005
      AND ABS(x.corrected_total_cost - x.corrected_parts_cost - x.original_labor_cost) < 0.005
  ) = 2
  AND NOT EXISTS (
    SELECT 1 FROM historical_ro_cost_corrections c
    JOIN _historical_ro_cost_expected_20261012 x
      ON x.import_key = c.import_key AND x.ro_number = c.ro_number
  )
THEN 1 ELSE 0 END;

-- Preserve an immutable record of previous amounts and approved new totals.
INSERT INTO historical_ro_cost_corrections
  (import_key, ro_number, equipment_id,
   original_parts_cost, original_labor_cost, original_sublet_cost, original_total_cost,
   corrected_parts_cost, corrected_total_cost, reason)
SELECT h.import_key, h.ro_number, h.equipment_id,
       h.parts_cost, h.labor_cost, h.sublet_cost, h.total_cost,
       x.corrected_parts_cost, x.corrected_total_cost,
       'Business-approved complete RO total correction; retain original labor'
FROM _historical_ro_cost_expected_20261012 x
JOIN historical_repairs h
  ON h.import_key = x.import_key AND h.ro_number = x.ro_number;

-- Reporting uses the parent RO for costs and category drilldowns use detail lines.
-- Update BOTH while retaining original labor and labor hours.
UPDATE historical_repair_lines
SET parts_cost = (
      SELECT x.corrected_parts_cost FROM _historical_ro_cost_expected_20261012 x
      WHERE x.import_key = historical_repair_lines.import_key
        AND x.ro_number = historical_repair_lines.ro_number
    ),
    total_cost = (
      SELECT x.corrected_total_cost FROM _historical_ro_cost_expected_20261012 x
      WHERE x.import_key = historical_repair_lines.import_key
        AND x.ro_number = historical_repair_lines.ro_number
    )
WHERE EXISTS (
  SELECT 1 FROM _historical_ro_cost_expected_20261012 x
  WHERE x.import_key = historical_repair_lines.import_key
    AND x.ro_number = historical_repair_lines.ro_number
);

UPDATE historical_repairs
SET parts_cost = (
      SELECT x.corrected_parts_cost FROM _historical_ro_cost_expected_20261012 x
      WHERE x.import_key = historical_repairs.import_key
        AND x.ro_number = historical_repairs.ro_number
    ),
    total_cost = (
      SELECT x.corrected_total_cost FROM _historical_ro_cost_expected_20261012 x
      WHERE x.import_key = historical_repairs.import_key
        AND x.ro_number = historical_repairs.ro_number
    )
WHERE EXISTS (
  SELECT 1 FROM _historical_ro_cost_expected_20261012 x
  WHERE x.import_key = historical_repairs.import_key
    AND x.ro_number = historical_repairs.ro_number
);

-- Postflight: exactly two audit records and matching parent and detail totals.
INSERT INTO _historical_ro_cost_guard_20261012 (valid)
SELECT CASE WHEN
  (
    SELECT COUNT(*)
    FROM _historical_ro_cost_expected_20261012 x
    JOIN historical_ro_cost_corrections c
      ON c.import_key = x.import_key AND c.ro_number = x.ro_number
    JOIN historical_repairs h
      ON h.import_key = x.import_key AND h.ro_number = x.ro_number
    JOIN historical_repair_lines l ON l.historical_repair_id = h.id
    WHERE c.equipment_id = h.equipment_id
      AND ABS(c.original_parts_cost - x.original_parts_cost) < 0.005
      AND ABS(c.original_labor_cost - x.original_labor_cost) < 0.005
      AND ABS(c.original_total_cost - x.original_total_cost) < 0.005
      AND ABS(c.corrected_parts_cost - x.corrected_parts_cost) < 0.005
      AND ABS(c.corrected_total_cost - x.corrected_total_cost) < 0.005
      AND ABS(h.parts_cost - x.corrected_parts_cost) < 0.005
      AND ABS(h.labor_cost - x.original_labor_cost) < 0.005
      AND ABS(h.total_cost - x.corrected_total_cost) < 0.005
      AND ABS(h.total_cost - h.parts_cost - h.labor_cost - h.sublet_cost) < 0.005
      AND ABS(l.parts_cost - h.parts_cost) < 0.005
      AND ABS(l.labor_cost - h.labor_cost) < 0.005
      AND ABS(l.total_cost - h.total_cost) < 0.005
  ) = 2
THEN 1 ELSE 0 END;

-- Retain a trace of the two corrections authorized on 2026-10-12.
INSERT INTO historical_ro_cost_change_log
  (import_key, ro_number, equipment_id, changed_by_user_id, changed_by,
   previous_parts_cost, previous_labor_cost, previous_sublet_cost, previous_total_cost,
   new_parts_cost, new_total_cost, reason)
SELECT c.import_key, c.ro_number, c.equipment_id, NULL, 'Authorized correction request',
       c.original_parts_cost, c.original_labor_cost, c.original_sublet_cost, c.original_total_cost,
       c.corrected_parts_cost, c.corrected_total_cost, c.reason
FROM historical_ro_cost_corrections c
JOIN _historical_ro_cost_expected_20261012 x
  ON x.import_key = c.import_key AND x.ro_number = c.ro_number;

DROP TABLE _historical_ro_cost_guard_20261012;
DROP TABLE _historical_ro_cost_expected_20261012;