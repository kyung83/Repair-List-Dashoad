PRAGMA foreign_keys = ON;

-- Exact, business-approved TOTAL costs (labor included):
-- WO085385 / 324(DC)  $63,539.66 -> $633.00     parts $573.00, labor $60.00
-- WO086883 / 373(DC)  $96,449.46 -> $6,004.53   parts $5,544.53, labor $460.00
--
-- All financial writes target indexed (import_key, ro_number) keys. The prior
-- approach scanned historical detail tables and exhausted D1 CPU time.
-- Re-entry is safe if a failed D1 migration left scratch/ledger tables behind.

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

DROP TABLE IF EXISTS _historical_ro_cost_guard_20261012;
DROP TABLE IF EXISTS _historical_ro_cost_expected_20261012;

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
  ('ro-history-9309499-v1','WO085385','324(DC)','2026-01-12','043','007',
   63479.66,60.00,63539.66,573.00,633.00),
  ('ro-history-9309499-v1','WO086883','373(DC)','2026-02-23','033','000',
   95989.46,460.00,96449.46,5544.53,6004.53);

CREATE TABLE _historical_ro_cost_guard_20261012 (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

-- Validate two exact original (or already-corrected) CLOSED ROs. Lookups use
-- historical_repairs UNIQUE(import_key,ro_number) and the detail-lines
-- UNIQUE(import_key,ro_number,system_code,assembly_code,vmrs_description).
-- A partially completed previous attempt may have corrected the parent OR
-- the detail; each one is accepted only at its known approved dollar values.
INSERT INTO _historical_ro_cost_guard_20261012 (valid)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM _historical_ro_cost_expected_20261012)=2
  AND (
    SELECT COUNT(*)
    FROM _historical_ro_cost_expected_20261012 x
    JOIN historical_repairs h ON h.import_key=x.import_key AND h.ro_number=x.ro_number
    JOIN equipment e ON e.id=h.equipment_id
    JOIN historical_repair_lines l ON l.import_key=x.import_key AND l.ro_number=x.ro_number
    WHERE e.unit=x.unit AND h.ro_date=x.ro_date AND h.source_status='CLOSED'
      AND h.line_count=1
      AND l.historical_repair_id=h.id
      AND l.system_code=x.system_code AND l.assembly_code=x.assembly_code
      AND (SELECT COUNT(*) FROM historical_repair_lines v
           WHERE v.import_key=x.import_key AND v.ro_number=x.ro_number)=1
      AND ABS(h.labor_cost-x.original_labor_cost)<0.005 AND ABS(h.sublet_cost)<0.005
      AND ABS(l.labor_cost-x.original_labor_cost)<0.005 AND ABS(l.sublet_cost)<0.005
      AND (
        (ABS(h.parts_cost-x.original_parts_cost)<0.005 AND ABS(h.total_cost-x.original_total_cost)<0.005)
        OR (ABS(h.parts_cost-x.corrected_parts_cost)<0.005 AND ABS(h.total_cost-x.corrected_total_cost)<0.005)
      )
      AND (
        (ABS(l.parts_cost-x.original_parts_cost)<0.005 AND ABS(l.total_cost-x.original_total_cost)<0.005)
        OR (ABS(l.parts_cost-x.corrected_parts_cost)<0.005 AND ABS(l.total_cost-x.corrected_total_cost)<0.005)
      )
      AND ABS(x.corrected_total_cost-x.corrected_parts_cost-x.original_labor_cost)<0.005
  )=2
  AND NOT EXISTS (
    SELECT 1
    FROM _historical_ro_cost_expected_20261012 x
    JOIN historical_ro_cost_corrections c
      ON c.import_key=x.import_key AND c.ro_number=x.ro_number
    WHERE ABS(c.original_parts_cost-x.original_parts_cost)>=0.005
       OR ABS(c.original_labor_cost-x.original_labor_cost)>=0.005
       OR ABS(c.original_total_cost-x.original_total_cost)>=0.005
       OR ABS(c.corrected_parts_cost-x.corrected_parts_cost)>=0.005
       OR ABS(c.corrected_total_cost-x.corrected_total_cost)>=0.005
  )
THEN 1 ELSE 0 END;

-- Persist original amounts and approved target. If the previous attempt wrote
-- part of the ledger, an upsert reconciles it to the same authorized figures.
INSERT INTO historical_ro_cost_corrections
  (import_key,ro_number,equipment_id,original_parts_cost,original_labor_cost,
   original_sublet_cost,original_total_cost,corrected_parts_cost,corrected_total_cost,reason)
SELECT x.import_key,x.ro_number,h.equipment_id,x.original_parts_cost,x.original_labor_cost,
       0,x.original_total_cost,x.corrected_parts_cost,x.corrected_total_cost,
       'Business-approved corrected total including original labor'
FROM _historical_ro_cost_expected_20261012 x
JOIN historical_repairs h ON h.import_key=x.import_key AND h.ro_number=x.ro_number
WHERE 1=1
ON CONFLICT(import_key,ro_number) DO UPDATE SET
  corrected_parts_cost=excluded.corrected_parts_cost,
  corrected_total_cost=excluded.corrected_total_cost,
  reason=excluded.reason, corrected_at=CURRENT_TIMESTAMP;

-- Both UPDATEs use already indexed keys and touch only two ROs each.
UPDATE historical_repair_lines
SET parts_cost=CASE ro_number WHEN 'WO085385' THEN 573.00 WHEN 'WO086883' THEN 5544.53 ELSE parts_cost END,
    total_cost=CASE ro_number WHEN 'WO085385' THEN 633.00 WHEN 'WO086883' THEN 6004.53 ELSE total_cost END
WHERE import_key='ro-history-9309499-v1' AND ro_number IN ('WO085385','WO086883');

UPDATE historical_repairs
SET parts_cost=CASE ro_number WHEN 'WO085385' THEN 573.00 WHEN 'WO086883' THEN 5544.53 ELSE parts_cost END,
    total_cost=CASE ro_number WHEN 'WO085385' THEN 633.00 WHEN 'WO086883' THEN 6004.53 ELSE total_cost END
WHERE import_key='ro-history-9309499-v1' AND ro_number IN ('WO085385','WO086883');

-- Append an original -> corrected event once, including on partial retries.
INSERT INTO historical_ro_cost_change_log
  (import_key,ro_number,equipment_id,changed_by_user_id,changed_by,
   previous_parts_cost,previous_labor_cost,previous_sublet_cost,previous_total_cost,
   new_parts_cost,new_total_cost,reason)
SELECT c.import_key,c.ro_number,c.equipment_id,NULL,'Authorized correction request',
       c.original_parts_cost,c.original_labor_cost,c.original_sublet_cost,c.original_total_cost,
       c.corrected_parts_cost,c.corrected_total_cost,c.reason
FROM historical_ro_cost_corrections c
JOIN _historical_ro_cost_expected_20261012 x
  ON x.import_key=c.import_key AND x.ro_number=c.ro_number
WHERE NOT EXISTS (
  SELECT 1 FROM historical_ro_cost_change_log l
  WHERE l.import_key=c.import_key AND l.ro_number=c.ro_number
    AND l.changed_by='Authorized correction request'
    AND ABS(l.previous_total_cost=c.original_total_cost)<0.005
    AND ABS(l.new_total_cost=c.corrected_total_cost)<0.005
);

-- Postflight before Wrangler records this migration as successful.
INSERT INTO _historical_ro_cost_guard_20261012 (valid)
SELECT CASE WHEN (
  SELECT COUNT(*)
  FROM _historical_ro_cost_expected_20261012 x
  JOIN historical_repairs h ON h.import_key=x.import_key AND h.ro_number=x.ro_number
  JOIN historical_repair_lines l ON l.import_key=x.import_key AND l.ro_number=x.ro_number
  JOIN historical_ro_cost_corrections c ON c.import_key=x.import_key AND c.ro_number=x.ro_number
  WHERE ABS(h.parts_cost-x.corrected_parts_cost)<0.005
    AND ABS(h.total_cost-x.corrected_total_cost)<0.005
    AND ABS(h.labor_cost-x.original_labor_cost)<0.005
    AND ABS(l.parts_cost-x.corrected_parts_cost)<0.005
    AND ABS(l.total_cost-x.corrected_total_cost)<0.005
    AND ABS(l.labor_cost-x.original_labor_cost)<0.005
    AND ABS(c.original_total_cost-x.original_total_cost)<0.005
    AND ABS(c.corrected_total_cost-x.corrected_total_cost)<0.005
)=2
AND (
  SELECT COUNT(*) FROM historical_ro_cost_change_log l
  JOIN _historical_ro_cost_expected_20261012 x ON x.import_key=l.import_key AND x.ro_number=l.ro_number
  WHERE l.changed_by='Authorized correction request'
)=2
THEN 1 ELSE 0 END;

DROP TABLE _historical_ro_cost_guard_20261012;
DROP TABLE _historical_ro_cost_expected_20261012;
