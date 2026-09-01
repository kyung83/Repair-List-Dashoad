PRAGMA foreign_keys = ON;

-- Authoritative truck/vehicle annual-date snapshot supplied 2026-09-01.
-- Dated rows update the annual baseline. Blank source dates are staged/audited
-- but intentionally do not erase an existing annual date.
DROP TABLE IF EXISTS _truck_annual_snapshot_20260901;
CREATE TABLE _truck_annual_snapshot_20260901 (
  unit TEXT PRIMARY KEY,
  annual_date TEXT
);

INSERT INTO _truck_annual_snapshot_20260901 (unit, annual_date) VALUES
  ('Ford Transit', '2026-05-13'),
  ('226', '2026-07-14'),
  ('426', '2025-12-22'),
  ('626', '2026-03-19'),
  ('726', '2026-01-09'),
  ('826', '2026-01-12'),
  ('926', '2025-10-27'),
  ('1026', '2026-05-21'),
  ('1126', '2025-12-23'),
  ('1226', '2026-04-13'),
  ('227', '2025-09-10'),
  ('247', NULL),
  ('258', '2026-03-11'),
  ('290', '2026-08-29'),
  ('301', '2026-07-07'),
  ('324', '2026-04-08'),
  ('338', '2026-07-12'),
  ('342', '2025-09-18'),
  ('348', '2026-02-15'),
  ('349', '2025-10-15'),
  ('350', '2025-11-20'),
  ('351', '2026-02-04'),
  ('353', '2025-11-02'),
  ('357', '2026-01-14'),
  ('358', '2025-11-20'),
  ('359', '2025-11-02'),
  ('360', '2026-02-09'),
  ('361', '2025-12-04'),
  ('362', '2026-05-03'),
  ('363', '2026-02-04'),
  ('364', '2026-07-23'),
  ('368', '2026-04-17'),
  ('369', '2026-01-23'),
  ('370', '2026-02-23'),
  ('373', '2026-01-12'),
  ('379', '2026-04-21'),
  ('380', '2026-08-18'),
  ('381', '2026-07-09'),
  ('382', '2026-05-11'),
  ('384', '2026-07-13'),
  ('387', '2026-08-21'),
  ('388', '2026-08-24'),
  ('400', '2026-08-22'),
  ('402', '2026-01-11'),
  ('403', '2025-11-15'),
  ('404', '2025-11-24'),
  ('407', '2026-01-08'),
  ('408', '2026-01-28'),
  ('411', '2026-07-23'),
  ('413', '2026-04-30'),
  ('414', '2026-07-23'),
  ('415', '2026-05-22'),
  ('418', '2026-06-29'),
  ('419', '2026-08-01'),
  ('420', '2026-05-05'),
  ('421', '2026-06-09'),
  ('422', '2025-10-06'),
  ('423', '2026-07-07'),
  ('424', '2026-06-12'),
  ('425', '2026-07-28'),
  ('427', '2026-07-21'),
  ('428', '2026-08-03'),
  ('429', '2025-10-13'),
  ('430', '2026-08-12'),
  ('431', '2026-08-12'),
  ('432', '2025-11-01'),
  ('433', '2025-11-25'),
  ('434', '2025-12-08'),
  ('437', '2026-02-05'),
  ('438', '2026-02-25'),
  ('439', '2026-01-09'),
  ('440', '2026-02-13'),
  ('442', '2026-04-15'),
  ('443', '2026-04-06'),
  ('445', '2026-04-02'),
  ('446', '2026-04-09'),
  ('447', '2026-04-16'),
  ('448', '2027-04-04'),
  ('449', '2026-02-13'),
  ('450', '2026-05-28'),
  ('452', '2026-02-24'),
  ('453', '2025-11-14'),
  ('454', '2026-04-01'),
  ('455', '2026-04-24'),
  ('456', '2026-05-28'),
  ('457', '2026-08-10'),
  ('459', '2026-08-31'),
  ('460', '2026-08-02'),
  ('461', '2025-10-12'),
  ('462', '2026-08-05'),
  ('463', '2025-11-25'),
  ('464', '2025-10-27'),
  ('467', '2025-12-14'),
  ('468', '2025-12-22'),
  ('469', '2025-12-15'),
  ('470', '2026-01-23'),
  ('471', '2026-01-19'),
  ('472', '2026-03-25'),
  ('473', '2025-11-14'),
  ('474', '2025-12-23'),
  ('475', '2026-06-08'),
  ('476', '2026-01-27'),
  ('480', '2026-03-30'),
  ('481', '2026-04-21'),
  ('482', '2026-02-18'),
  ('484', '2026-03-27'),
  ('485', '2026-02-09'),
  ('486', '2026-02-22'),
  ('490', '2026-02-12'),
  ('491', '2026-04-19'),
  ('492', '2026-02-12'),
  ('493', '2026-04-07'),
  ('496', '2026-04-25'),
  ('497', '2026-04-13'),
  ('498', '2026-05-02'),
  ('499', '2026-05-21'),
  ('500', '2026-05-14'),
  ('501', '2026-07-22'),
  ('502', '2026-07-24'),
  ('503', '2026-06-25'),
  ('504', '2026-07-28'),
  ('505', '2026-07-07'),
  ('507', '2025-10-02'),
  ('508', '2025-10-21'),
  ('509', '2025-10-27'),
  ('510', '2026-08-14'),
  ('511', '2025-10-28'),
  ('512', '2025-12-30'),
  ('513', '2026-02-03'),
  ('514', '2026-02-03'),
  ('516', '2025-11-02'),
  ('517', '2025-11-02'),
  ('518', '2026-01-08'),
  ('519', '2025-12-23'),
  ('521', '2026-01-02'),
  ('522', '2026-02-10'),
  ('523', '2026-07-25'),
  ('524', '2026-04-06'),
  ('525', '2026-05-14'),
  ('527', '2026-05-13'),
  ('528', '2026-04-14'),
  ('529', '2026-05-06'),
  ('530', '2026-05-07'),
  ('531', '2026-06-08'),
  ('532', '2026-06-15'),
  ('533', '2026-05-08'),
  ('534', '2026-07-18'),
  ('535', '2026-08-20'),
  ('536', '2026-08-15'),
  ('537', '2025-09-22'),
  ('538', '2026-08-18'),
  ('539', '2025-11-11'),
  ('540', '2025-12-30'),
  ('541', '2026-01-13'),
  ('542', '2026-02-23'),
  ('543', '2026-01-14'),
  ('544', '2025-12-16'),
  ('545', '2026-01-19'),
  ('546', '2025-12-26'),
  ('547', '2025-11-23'),
  ('548', '2026-01-22'),
  ('549', '2026-01-27'),
  ('550', '2026-02-12'),
  ('551', '2026-07-07'),
  ('552', '2026-02-12'),
  ('553', '2026-02-15'),
  ('554', '2026-03-07'),
  ('555', '2026-04-16'),
  ('556', '2026-02-13'),
  ('557', '2026-03-29'),
  ('558', '2026-02-17'),
  ('559', '2026-03-01'),
  ('560', '2026-03-30'),
  ('561', '2026-03-22'),
  ('562', '2026-04-29'),
  ('563', '2026-05-18'),
  ('564', '2026-06-05'),
  ('565', '2026-05-15'),
  ('566', '2026-05-27'),
  ('567', '2026-06-30'),
  ('568', '2026-05-21'),
  ('571', '2026-08-03'),
  ('572', '2026-06-19'),
  ('573', '2026-05-27'),
  ('574', '2026-07-11'),
  ('575', '2026-07-16'),
  ('576', '2026-07-01'),
  ('577', '2026-06-30'),
  ('578', '2026-08-18'),
  ('579', '2026-06-12'),
  ('580', '2026-07-07'),
  ('581', '2026-08-12'),
  ('582', '2026-08-18'),
  ('583', '2026-07-26'),
  ('584', '2025-09-24'),
  ('585', '2025-10-03'),
  ('586', '2025-10-16'),
  ('587', '2025-10-24'),
  ('588', '2025-10-29'),
  ('589', '2025-10-09'),
  ('590', '2025-10-20'),
  ('591', '2025-10-24'),
  ('592', '2025-10-03'),
  ('593', '2025-11-14'),
  ('594', '2025-10-03'),
  ('595', '2026-01-05'),
  ('596', '2025-11-25'),
  ('597', '2025-12-08'),
  ('598', '2025-12-23'),
  ('599', '2025-11-02'),
  ('600', '2026-05-01'),
  ('601', '2026-01-27'),
  ('602', '2026-03-10'),
  ('603', '2026-03-18'),
  ('604', '2026-04-21'),
  ('605', '2026-04-01'),
  ('606', '2026-05-07'),
  ('607', '2026-04-13'),
  ('608', '2026-04-15'),
  ('609', '2026-04-15'),
  ('610', '2026-04-20'),
  ('611', '2026-04-15'),
  ('612', '2026-04-16'),
  ('613', '2026-05-01'),
  ('614', '2025-11-04'),
  ('615', '2025-11-04'),
  ('616', '2025-11-04'),
  ('617', '2025-11-04'),
  ('618', '2025-11-08'),
  ('619', '2025-11-07'),
  ('620', '2025-11-12'),
  ('621', '2025-11-12'),
  ('622', '2025-11-12'),
  ('623', '2025-12-22'),
  ('624', '2025-12-22'),
  ('625', '2025-12-16'),
  ('627', '2025-12-22'),
  ('628', '2025-12-22'),
  ('629', '2025-12-30'),
  ('630', '2025-12-30'),
  ('631', '2026-01-06'),
  ('632', '2026-01-06'),
  ('633', '2026-01-06'),
  ('634', '2026-01-13'),
  ('635', '2026-01-27'),
  ('636', '2026-07-23'),
  ('637', '2026-03-03'),
  ('638', '2026-03-04'),
  ('639', '2026-03-11'),
  ('640', '2026-03-11'),
  ('641', '2026-03-16'),
  ('642', '2026-03-16'),
  ('643', '2026-03-13'),
  ('644', '2026-03-13'),
  ('645', '2026-03-30'),
  ('646', '2026-03-30'),
  ('647', '2026-03-30'),
  ('648', '2026-04-09'),
  ('649', '2026-04-09'),
  ('650', '2026-04-20'),
  ('651', '2026-05-01'),
  ('652', '2026-05-04'),
  ('653', '2026-04-20'),
  ('654', '2026-05-08'),
  ('655', '2026-05-13'),
  ('656', '2026-05-26'),
  ('657', '2026-05-26'),
  ('658', '2026-05-27'),
  ('659', '2026-05-27'),
  ('660', '2026-05-27'),
  ('661', '2026-07-06'),
  ('662', '2026-07-07'),
  ('663', '2026-07-06'),
  ('664', '2026-07-06'),
  ('665', '2026-07-07'),
  ('667', NULL),
  ('668', '2026-07-13'),
  ('669', NULL),
  ('670', '2026-07-14'),
  ('671', NULL),
  ('672', '2026-07-13'),
  ('673', NULL),
  ('674', NULL),
  ('675', NULL),
  ('676', NULL),
  ('677', NULL),
  ('678', NULL);

DROP TABLE IF EXISTS _truck_annual_matches_20260901;
CREATE TABLE _truck_annual_matches_20260901 (
  source_unit TEXT PRIMARY KEY,
  equipment_id INTEGER NOT NULL,
  annual_date TEXT,
  UNIQUE (equipment_id)
);

INSERT INTO _truck_annual_matches_20260901 (source_unit, equipment_id, annual_date)
SELECT s.unit, e.id, s.annual_date
FROM _truck_annual_snapshot_20260901 s
JOIN equipment e
  ON (
      (e.active = 1 AND e.archived_at IS NULL)
      OR (
        s.unit IN ('370', '379')
        AND e.active = 0
        AND e.archived_at IS NOT NULL
      )
    )
 AND lower(COALESCE(e.equipment_type, '')) <> 'trailer'
 AND e.geotab_trailer_id IS NULL
 AND (
      (
        upper(s.unit) = 'FORD TRANSIT'
        AND upper(trim(e.unit)) IN ('FORD TRANSIT', 'FORD TRANSIT VAN')
      )
      OR (
        upper(s.unit) <> 'FORD TRANSIT'
        AND (
          upper(trim(e.unit)) = upper(s.unit)
          OR upper(trim(e.unit)) LIKE upper(s.unit) || '(%'
          OR upper(trim(e.unit)) LIKE upper(s.unit) || ' (%'
          OR upper(trim(e.unit)) LIKE upper(s.unit) || '/%'
          OR upper(trim(e.unit)) = 'TRUCK ' || upper(s.unit)
          OR upper(trim(e.unit)) LIKE 'TRUCK ' || upper(s.unit) || '(%'
          OR upper(trim(e.unit)) LIKE 'TRUCK ' || upper(s.unit) || ' (%'
        )
      )
    );

DROP TABLE IF EXISTS _truck_annual_guard_20260901;
CREATE TABLE _truck_annual_guard_20260901 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

-- 287 named source units, 277 dated rows, 10 explicitly blank rows.
-- Every dated row must resolve to one non-trailer equipment record.
-- 370 (TERMED) and 379 (Selling) are intentionally allowed to match their archived
-- historical equipment rows, but are never re-enabled for annual scheduling.
INSERT INTO _truck_annual_guard_20260901 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM _truck_annual_snapshot_20260901) = 287
  AND (SELECT COUNT(*) FROM _truck_annual_snapshot_20260901 WHERE annual_date IS NOT NULL) = 277
  AND (
    SELECT COUNT(*) FROM _truck_annual_snapshot_20260901
    WHERE annual_date IS NULL
      AND unit IN ('247','667','669','671','673','674','675','676','677','678')
  ) = 10
  AND NOT EXISTS (
    SELECT 1
    FROM _truck_annual_snapshot_20260901 s
    WHERE s.annual_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM _truck_annual_matches_20260901 m
        WHERE m.source_unit = s.unit
      )
  )
THEN 1 ELSE 0 END;

-- Keep annual scheduling enabled for newly tracked dated units without
-- overriding any existing custom annual interval or intentionally paused row.
INSERT OR IGNORE INTO equipment_annual_settings
  (equipment_id, interval_days, active, updated_at)
SELECT m.equipment_id, 365, 1, CURRENT_TIMESTAMP
FROM _truck_annual_matches_20260901 m
JOIN equipment e ON e.id = m.equipment_id
WHERE m.annual_date IS NOT NULL
  AND e.active = 1
  AND e.archived_at IS NULL;

INSERT INTO pm_status (equipment_id, annual_date, updated_at)
SELECT equipment_id, annual_date, CURRENT_TIMESTAMP
FROM _truck_annual_matches_20260901
WHERE annual_date IS NOT NULL
ON CONFLICT(equipment_id) DO UPDATE SET
  annual_date = excluded.annual_date,
  updated_at = CURRENT_TIMESTAMP;

UPDATE equipment AS e
SET annual_date = (
      SELECT m.annual_date
      FROM _truck_annual_matches_20260901 m
      WHERE m.equipment_id = e.id
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE e.id IN (
  SELECT equipment_id
  FROM _truck_annual_matches_20260901
  WHERE annual_date IS NOT NULL
);

CREATE TABLE IF NOT EXISTS truck_annual_import_receipts (
  import_batch TEXT PRIMARY KEY,
  source_rows INTEGER NOT NULL,
  dated_rows INTEGER NOT NULL,
  matched_rows INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO truck_annual_import_receipts
  (import_batch, source_rows, dated_rows, matched_rows, applied_at)
SELECT
  'truck-annuals-2026-09-01',
  (SELECT COUNT(*) FROM _truck_annual_snapshot_20260901),
  (SELECT COUNT(*) FROM _truck_annual_snapshot_20260901 WHERE annual_date IS NOT NULL),
  (SELECT COUNT(*) FROM _truck_annual_matches_20260901 WHERE annual_date IS NOT NULL),
  CURRENT_TIMESTAMP;

DROP TABLE IF EXISTS _truck_annual_verify_20260901;
CREATE TABLE _truck_annual_verify_20260901 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _truck_annual_verify_20260901 (ok)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM _truck_annual_matches_20260901 m
  JOIN equipment e ON e.id = m.equipment_id
  LEFT JOIN pm_status ps ON ps.equipment_id = m.equipment_id
  WHERE m.annual_date IS NOT NULL
    AND (e.annual_date IS NOT m.annual_date OR ps.annual_date IS NOT m.annual_date)
) THEN 1 ELSE 0 END;

DROP TABLE _truck_annual_verify_20260901;
DROP TABLE _truck_annual_guard_20260901;
DROP TABLE _truck_annual_matches_20260901;
DROP TABLE _truck_annual_snapshot_20260901;
