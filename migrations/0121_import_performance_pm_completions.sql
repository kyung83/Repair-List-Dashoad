PRAGMA foreign_keys = ON;

-- D1 does not authorize TEMP schema objects in remote migrations. Keep the
-- scratch tables in the main schema for this migration only and drop them at
-- the end. DROP IF EXISTS also makes a retry safe if a prior failed attempt
-- reached any scratch-table creation before rollback.
DROP TABLE IF EXISTS _performance_pm_assigned_20260901;
DROP TABLE IF EXISTS _performance_pm_validation_20260901;
DROP TABLE IF EXISTS _performance_pm_resolution_20260901;
DROP TABLE IF EXISTS _performance_pm_stage_20260901;

-- Bring production PM history forward from the live Performance PM inspection
-- workbook. The prior legacy Truck PMS import ended on 2026-08-17. This batch
-- contains the 29 unique completed truck inspections from 2026-08-19 through
-- 2026-08-28; three duplicate form submissions were removed before staging.
--
-- Safety rules:
--   * resolve equipment by exact VIN first, then a unique active base-unit match;
--   * never attach an ambiguous/unmatched form to equipment;
--   * if the app already has a PM on the same unit/date, keep the app event;
--   * derive the PM type from the latest prior PM plus that unit's configured
--     profile sequence (fallback 40 -> 20A -> 20B -> 40);
--   * recompute current PM baselines from ALL PM history so a newer app-entered
--     completion can never be rolled backward by this spreadsheet batch.

CREATE TABLE IF NOT EXISTS performance_pm_import_events (
  pm_id TEXT PRIMARY KEY,
  import_batch TEXT NOT NULL,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  source_unit TEXT NOT NULL,
  vin TEXT NOT NULL,
  event_date TEXT NOT NULL,
  mileage INTEGER NOT NULL,
  assigned_pm_type TEXT,
  disposition TEXT NOT NULL CHECK (disposition IN ('imported','already-recorded')),
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_pm_import_receipts (
  import_batch TEXT PRIMARY KEY,
  source_rows INTEGER NOT NULL,
  resolved_units INTEGER NOT NULL,
  imported_events INTEGER NOT NULL,
  already_recorded INTEGER NOT NULL,
  pm_40 INTEGER NOT NULL,
  pm_20a INTEGER NOT NULL,
  pm_20b INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE _performance_pm_stage_20260901 (
  pm_id TEXT PRIMARY KEY,
  source_unit TEXT NOT NULL,
  vin TEXT NOT NULL,
  event_date TEXT NOT NULL,
  mileage INTEGER NOT NULL,
  inspector TEXT NOT NULL
);

INSERT INTO _performance_pm_stage_20260901
  (pm_id,source_unit,vin,event_date,mileage,inspector)
VALUES
  ('NL-PM-461-1787159989524', '461', '3HSDZAPR0NN271485', '2026-08-19', 518474, 'Dakota'),
  ('NL-PM-545-1787167258711', '545', '3HSDWTZR4RN555273', '2026-08-19', 238977, 'Dennis ison'),
  ('NL-PM-364-1787271130370', '364', '3ALXA700XKDLF5109', '2026-08-20', 728072, 'Dennis ison'),
  ('NL-PM-429-1787262654686', '429', '3ALXA7003LDMT8161', '2026-08-20', 782726, 'Dennis ison'),
  ('NL-PM-597-1787237264358', '597', '3HSDZAPR9SN236830', '2026-08-20', 231963, 'Dakota'),
  ('NL-PM-616-1787253993284', '616', '1FUJHHDR5TLWU9079', '2026-08-20', 100807, 'Dennis ison'),
  ('NL-PM-647-1787247427672', '647', '3HSDZAPR3VN114484', '2026-08-20', 39905, 'Dakota'),
  ('NL-PM-421-1787319639003', '421', '3HSDWTZR9MN204349', '2026-08-21', 569271, 'Dakota'),
  ('NL-PM-498-1787357846406', '498', '3HSPAAPRXPN364585', '2026-08-21', 505521, 'Dennis ison'),
  ('NL-PM-554-1787348495950', '554', '3HSDZAPR3SN875558', '2026-08-21', 282257, 'Dennis ison'),
  ('NL-PM-669-1787363189931', '669', '1FUJHHDR2VLXJ0634', '2026-08-21', 20910, 'Dennis ison'),
  ('NL-PM-474-1787426842057', '474', '3HSDZAPR9PN588779', '2026-08-22', 477618, 'Keagan Terrian'),
  ('NL-PM-338-1787500633754', '338', '3HCDZAPRXKL408919', '2026-08-23', 692849, 'Keagan Terrian'),
  ('NL-PM-415-1787510531411', '415', '3ALXA7001LDMG8934', '2026-08-23', 402892, 'Keagan Terrian'),
  ('NL-PM-607-1787488993481', '607', '1FUJHLDR7TLWP8621', '2026-08-23', 116622, 'Keagan Terrian'),
  ('NL-PM-625-1787496959547', '625', '3AKJHLDR4TSWX3560', '2026-08-23', 59926, 'Keagan Terrian'),
  ('NL-PM-571-1787723252231', '571', '3HSDZAPR0SN517088', '2026-08-25', 183175, 'Keagan Terrian'),
  ('NL-PM-360-1787787930503', '360', '3ALX47008KDLF5111', '2026-08-26', 475188, 'Dennis ison'),
  ('NL-PM-413-1787734553857', '413', '3HSDWTZR1MN697380', '2026-08-26', 504988, 'Jake'),
  ('NL-PM-551-1787740503765', '551', '3HSDZAPRXSN517096', '2026-08-26', 191110, 'Jake'),
  ('NL-PM-576-1787779690279', '576', '3HSDZAPR9SN523374', '2026-08-26', 269280, 'Dennis ison'),
  ('NL-PM-578-1787723695748', '578', '3HSDZSZR5RN783803', '2026-08-26', 216612, 'Jake'),
  ('NL-PM-580-1787791897723', '580', '3HSDZAPR9SN517090', '2026-08-26', 194567, 'Dennis ison'),
  ('NL-PM-362-1787877045258', '362', '3ALXA7003KDLF5114', '2026-08-27', 711270, 'Dennis ison'),
  ('NL-PM-590-1787880344459', '590', '3AKJHLDR0SSWF0111', '2026-08-27', 155029, 'Dennis ison'),
  ('NL-PM-603-1787869022407', '603', '3HSDZAPR4SN475654', '2026-08-27', 241721, 'Dennis ison'),
  ('NL-PM-640-1787827705758', '640', '3HSDZAPR2VN118798', '2026-08-27', 42593, 'Jake'),
  ('NL-PM-411-1787950539821', '411', '3HSDWTZR5MN691727', '2026-08-28', 498043, 'Dennis ison'),
  ('NL-PM-419-1787966536369', '419', '3HSDZAPR7MN434728', '2026-08-28', 776080, 'Dennis ison');

CREATE TABLE _performance_pm_resolution_20260901 (
  pm_id TEXT PRIMARY KEY,
  equipment_id INTEGER,
  match_kind TEXT NOT NULL,
  candidate_count INTEGER NOT NULL
);

WITH candidates AS (
  SELECT
    s.pm_id,
    e.id AS equipment_id,
    CASE
      WHEN s.vin <> ''
       AND UPPER(REPLACE(TRIM(COALESCE(e.vin,'')),' ','')) = s.vin THEN 1
      WHEN lower(replace(replace(trim(CASE WHEN instr(e.unit,'(')>0 THEN substr(e.unit,1,instr(e.unit,'(')-1) ELSE e.unit END),' ',''),'-',''))
         = lower(s.source_unit) THEN 2
      ELSE 99
    END AS score
  FROM _performance_pm_stage_20260901 s
  JOIN equipment e
    ON e.active = 1
   AND e.archived_at IS NULL
   AND lower(COALESCE(e.equipment_type,'truck')) <> 'trailer'
   AND (
     (s.vin <> '' AND UPPER(REPLACE(TRIM(COALESCE(e.vin,'')),' ','')) = s.vin)
     OR lower(replace(replace(trim(CASE WHEN instr(e.unit,'(')>0 THEN substr(e.unit,1,instr(e.unit,'(')-1) ELSE e.unit END),' ',''),'-','')) = lower(s.source_unit)
   )
),
best AS (
  SELECT pm_id, MIN(score) AS best_score
  FROM candidates
  GROUP BY pm_id
),
resolved AS (
  SELECT
    s.pm_id,
    CASE WHEN COUNT(c.equipment_id)=1 THEN MAX(c.equipment_id) ELSE NULL END AS equipment_id,
    CASE
      WHEN b.best_score IS NULL THEN 'unmatched'
      WHEN COUNT(c.equipment_id)<>1 THEN 'ambiguous'
      WHEN b.best_score=1 THEN 'vin'
      WHEN b.best_score=2 THEN 'base-unit'
      ELSE 'unmatched'
    END AS match_kind,
    COUNT(c.equipment_id) AS candidate_count
  FROM _performance_pm_stage_20260901 s
  LEFT JOIN best b ON b.pm_id=s.pm_id
  LEFT JOIN candidates c ON c.pm_id=s.pm_id AND c.score=b.best_score
  GROUP BY s.pm_id,b.best_score
)
INSERT INTO _performance_pm_resolution_20260901
  (pm_id,equipment_id,match_kind,candidate_count)
SELECT pm_id,equipment_id,match_kind,candidate_count
FROM resolved;

CREATE TABLE _performance_pm_validation_20260901 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _performance_pm_validation_20260901
SELECT CASE WHEN COUNT(*)=29 THEN 1 ELSE 0 END FROM _performance_pm_stage_20260901;
INSERT INTO _performance_pm_validation_20260901
SELECT CASE WHEN COUNT(*)=29 THEN 1 ELSE 0 END FROM _performance_pm_resolution_20260901 WHERE equipment_id IS NOT NULL;
INSERT INTO _performance_pm_validation_20260901
SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM _performance_pm_resolution_20260901 WHERE match_kind IN ('unmatched','ambiguous');

-- Derive the PM performed by each generic Performance PM form from the most
-- recent prior PM and the unit's configured sequence.
CREATE TABLE _performance_pm_assigned_20260901 AS
WITH source AS (
  SELECT s.*,r.equipment_id,
    (SELECT me.pm_type
       FROM maintenance_events me
      WHERE me.equipment_id=r.equipment_id
        AND me.event_type='pm'
        AND me.event_date < s.event_date
        AND me.pm_type IS NOT NULL
      ORDER BY me.event_date DESC,me.id DESC
      LIMIT 1) AS prior_pm_type
  FROM _performance_pm_stage_20260901 s
  JOIN _performance_pm_resolution_20260901 r ON r.pm_id=s.pm_id
  WHERE r.equipment_id IS NOT NULL
), enriched AS (
  SELECT source.*,profiles.sequence_json
  FROM source
  LEFT JOIN equipment_pm_settings settings ON settings.equipment_id=source.equipment_id
  LEFT JOIN pm_profiles profiles ON profiles.id=settings.profile_id
)
SELECT
  enriched.*,
  CASE
    WHEN sequence_json IS NULL OR json_valid(sequence_json)=0 OR json_array_length(sequence_json)=0
      THEN CASE prior_pm_type WHEN '40' THEN '20A' WHEN '20A' THEN '20B' WHEN '20B' THEN '40' ELSE '40' END
    WHEN prior_pm_type IS NULL THEN CAST(json_extract(sequence_json,'$[0]') AS TEXT)
    WHEN NOT EXISTS (
      SELECT 1 FROM json_each(sequence_json) item
      WHERE CAST(item.value AS TEXT)=prior_pm_type
    ) THEN CAST(json_extract(sequence_json,'$[0]') AS TEXT)
    ELSE CAST(json_extract(
      sequence_json,
      '$[' || (((SELECT CAST(item.key AS INTEGER) FROM json_each(sequence_json) item WHERE CAST(item.value AS TEXT)=prior_pm_type LIMIT 1)+1) % json_array_length(sequence_json)) || ']'
    ) AS TEXT)
  END AS assigned_pm_type
FROM enriched;

-- Insert only genuinely missing PM completions. A PM already recorded by the
-- application on the same unit/date is authoritative and is not duplicated.
INSERT INTO maintenance_events
  (equipment_id,event_type,pm_type,event_date,mileage,notes,source)
SELECT
  a.equipment_id,'pm',a.assigned_pm_type,a.event_date,a.mileage,
  'Imported from Performance PM form ' || a.pm_id || CASE WHEN trim(a.inspector)<>'' THEN ' — ' || trim(a.inspector) ELSE '' END,
  'performance-pm-google'
FROM _performance_pm_assigned_20260901 a
WHERE NOT EXISTS (
  SELECT 1 FROM maintenance_events existing
  WHERE existing.equipment_id=a.equipment_id
    AND existing.event_type='pm'
    AND existing.event_date=a.event_date
);

-- Preserve a durable receipt for every source form, whether this migration
-- inserted it or found the same PM already recorded by the application.
INSERT OR REPLACE INTO performance_pm_import_events
  (pm_id,import_batch,equipment_id,source_unit,vin,event_date,mileage,assigned_pm_type,disposition,recorded_at)
SELECT
  a.pm_id,'performance-pm-2026-09-01',a.equipment_id,a.source_unit,a.vin,a.event_date,a.mileage,a.assigned_pm_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM maintenance_events me
    WHERE me.equipment_id=a.equipment_id
      AND me.event_type='pm'
      AND me.event_date=a.event_date
      AND me.source='performance-pm-google'
  ) THEN 'imported' ELSE 'already-recorded' END,
  CURRENT_TIMESTAMP
FROM _performance_pm_assigned_20260901 a;

-- Recompute the current PM baseline using ALL history, not merely this import.
WITH ranked AS (
  SELECT me.equipment_id,me.pm_type,me.event_date,me.mileage,
    ROW_NUMBER() OVER (PARTITION BY me.equipment_id ORDER BY me.event_date DESC,me.id DESC) AS rn
  FROM maintenance_events me
  WHERE me.event_type='pm' AND me.pm_type IS NOT NULL
), latest AS (
  SELECT equipment_id,pm_type,event_date,mileage FROM ranked WHERE rn=1
), resolved_next AS (
  SELECT latest.equipment_id,latest.event_date,latest.mileage,
    CASE
      WHEN profiles.sequence_json IS NULL OR json_valid(profiles.sequence_json)=0 OR json_array_length(profiles.sequence_json)=0
        THEN CASE latest.pm_type WHEN '40' THEN '20A' WHEN '20A' THEN '20B' WHEN '20B' THEN '40' ELSE latest.pm_type END
      WHEN NOT EXISTS (SELECT 1 FROM json_each(profiles.sequence_json) item WHERE CAST(item.value AS TEXT)=latest.pm_type)
        THEN CAST(json_extract(profiles.sequence_json,'$[0]') AS TEXT)
      ELSE CAST(json_extract(
        profiles.sequence_json,
        '$[' || (((SELECT CAST(item.key AS INTEGER) FROM json_each(profiles.sequence_json) item WHERE CAST(item.value AS TEXT)=latest.pm_type LIMIT 1)+1) % json_array_length(profiles.sequence_json)) || ']'
      ) AS TEXT)
    END AS next_pm_type
  FROM latest
  LEFT JOIN equipment_pm_settings settings ON settings.equipment_id=latest.equipment_id
  LEFT JOIN pm_profiles profiles ON profiles.id=settings.profile_id
)
INSERT INTO pm_status (equipment_id,pm_type,status,last_mileage,service_date,updated_at)
SELECT equipment_id,next_pm_type,'Current',mileage,event_date,CURRENT_TIMESTAMP
FROM resolved_next
WHERE 1=1
ON CONFLICT(equipment_id) DO UPDATE SET
  pm_type=excluded.pm_type,
  status='Current',
  last_mileage=excluded.last_mileage,
  service_date=excluded.service_date,
  updated_at=CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT me.equipment_id,me.event_date,
    ROW_NUMBER() OVER (PARTITION BY me.equipment_id ORDER BY me.event_date DESC,me.id DESC) AS rn
  FROM maintenance_events me
  WHERE me.event_type='pm'
)
UPDATE equipment
SET service_date=(SELECT ranked.event_date FROM ranked WHERE ranked.equipment_id=equipment.id AND ranked.rn=1),
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT equipment_id FROM ranked WHERE rn=1);

-- Every staged form must now be represented by exactly one PM date in history.
INSERT INTO _performance_pm_validation_20260901
SELECT CASE WHEN COUNT(*)=29 THEN 1 ELSE 0 END
FROM _performance_pm_assigned_20260901 a
WHERE EXISTS (
  SELECT 1 FROM maintenance_events me
  WHERE me.equipment_id=a.equipment_id
    AND me.event_type='pm'
    AND me.event_date=a.event_date
);

INSERT OR REPLACE INTO performance_pm_import_receipts
  (import_batch,source_rows,resolved_units,imported_events,already_recorded,pm_40,pm_20a,pm_20b,applied_at)
SELECT
  'performance-pm-2026-09-01',
  29,
  (SELECT COUNT(DISTINCT equipment_id) FROM performance_pm_import_events WHERE import_batch='performance-pm-2026-09-01'),
  (SELECT COUNT(*) FROM performance_pm_import_events WHERE import_batch='performance-pm-2026-09-01' AND disposition='imported'),
  (SELECT COUNT(*) FROM performance_pm_import_events WHERE import_batch='performance-pm-2026-09-01' AND disposition='already-recorded'),
  (SELECT COUNT(*) FROM performance_pm_import_events WHERE import_batch='performance-pm-2026-09-01' AND assigned_pm_type='40'),
  (SELECT COUNT(*) FROM performance_pm_import_events WHERE import_batch='performance-pm-2026-09-01' AND assigned_pm_type='20A'),
  (SELECT COUNT(*) FROM performance_pm_import_events WHERE import_batch='performance-pm-2026-09-01' AND assigned_pm_type='20B'),
  CURRENT_TIMESTAMP;

DROP TABLE _performance_pm_assigned_20260901;
DROP TABLE _performance_pm_validation_20260901;
DROP TABLE _performance_pm_resolution_20260901;
DROP TABLE _performance_pm_stage_20260901;
