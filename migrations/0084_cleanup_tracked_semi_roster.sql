PRAGMA foreign_keys = ON;

-- Follow-up to the authoritative 2026-08-20 roster cleanup.
-- Keep exactly one active Master Equipment row for each approved semi even when
-- historical Geotab names differ only by spaces/case, and archive obsolete
-- numeric truck records that still carry a Geotab identity. Company vehicles
-- and obvious van/plow/rental names are intentionally left alone.
CREATE TABLE _semi_roster_0084 (
  canonical_unit TEXT PRIMARY KEY,
  numeric_unit INTEGER NOT NULL
);

WITH RECURSIVE
  ranges(suffix, start_value, end_value) AS (
    VALUES
    ('BT', 226, 226), ('BT', 426, 426), ('BT', 626, 626), ('BT', 726, 726),
    ('BT', 826, 826), ('BT', 926, 926), ('BT', 1026, 1026), ('BT', 1126, 1126), ('BT', 1226, 1226),
    ('DC', 227, 227), ('DC', 247, 247), ('DC', 258, 258), ('DC', 290, 290), ('DC', 301, 301),
    ('DC', 324, 324), ('DC', 338, 338), ('DC', 342, 342), ('DC', 349, 351), ('DC', 353, 353),
    ('DC', 357, 364), ('DC', 368, 370), ('DC', 373, 373), ('DC', 380, 382), ('DC', 384, 384),
    ('DC', 387, 388), ('DC', 404, 404), ('DC', 407, 408), ('DC', 411, 411), ('DC', 413, 415),
    ('DC', 418, 418), ('DC', 420, 421), ('DC', 424, 425), ('DC', 427, 431), ('DC', 433, 434),
    ('DC', 438, 439), ('DC', 442, 442), ('DC', 445, 445), ('DC', 449, 450), ('DC', 452, 453),
    ('DC', 456, 456), ('DC', 481, 481), ('DC', 493, 493), ('DC', 499, 502), ('DC', 507, 513),
    ('DC', 525, 525), ('DC', 527, 527), ('DC', 529, 531), ('DC', 539, 548), ('DC', 551, 551),
    ('DC', 555, 555), ('DC', 557, 558), ('DC', 571, 571), ('DC', 573, 573), ('DC', 577, 578),
    ('DC', 580, 584), ('DC', 586, 586), ('DC', 589, 590), ('DC', 595, 596), ('DC', 602, 613),
    ('DC', 623, 625), ('DC', 627, 631), ('DC', 633, 634), ('DC', 636, 636), ('DC', 639, 647),
    ('DC', 650, 650), ('DC', 656, 665),
    ('SC', 348, 348), ('SC', 400, 400), ('SC', 402, 403), ('SC', 419, 419), ('SC', 422, 423),
    ('SC', 432, 432), ('SC', 437, 437), ('SC', 440, 440), ('SC', 443, 443), ('SC', 446, 448),
    ('SC', 454, 455), ('SC', 457, 457), ('SC', 459, 464), ('SC', 467, 471), ('SC', 473, 476),
    ('SC', 480, 480), ('SC', 482, 482), ('SC', 484, 486), ('SC', 490, 492), ('SC', 496, 498),
    ('SC', 503, 505), ('SC', 514, 514), ('SC', 516, 519), ('SC', 521, 524), ('SC', 528, 528),
    ('SC', 532, 538), ('SC', 549, 550), ('SC', 552, 554), ('SC', 556, 556), ('SC', 559, 568),
    ('SC', 572, 572), ('SC', 574, 576), ('SC', 579, 579), ('SC', 585, 585), ('SC', 587, 588),
    ('SC', 591, 594), ('SC', 597, 601), ('SC', 614, 622), ('SC', 632, 632), ('SC', 635, 635),
    ('SC', 637, 638), ('SC', 648, 649), ('SC', 651, 655), ('SC', 667, 675), ('SC', 677, 677),
    ('EGR', 472, 472)
  ),
  nums(suffix, n, end_value) AS (
    SELECT suffix, start_value, end_value FROM ranges
    UNION ALL
    SELECT suffix, n + 1, end_value FROM nums WHERE n < end_value
  )
INSERT INTO _semi_roster_0084 (canonical_unit, numeric_unit)
SELECT CAST(n AS TEXT) || '(' || suffix || ')', n FROM nums;

-- If the same approved semi exists more than once, keep the best active row:
-- current explicit Geotab assignment first, then freshest mileage, then lowest id.
WITH ranked AS (
  SELECT
    e.id,
    r.canonical_unit,
    ROW_NUMBER() OVER (
      PARTITION BY r.canonical_unit
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1 FROM equipment_geotab_devices a
          WHERE a.equipment_id = e.id AND a.current = 1
        ) THEN 0 ELSE 1 END,
        CASE WHEN e.mileage_updated_at IS NULL THEN 1 ELSE 0 END,
        e.mileage_updated_at DESC,
        e.id ASC
    ) AS roster_rank
  FROM equipment e
  JOIN _semi_roster_0084 r
    ON UPPER(REPLACE(TRIM(e.unit), ' ', '')) = UPPER(REPLACE(r.canonical_unit, ' ', ''))
    OR (r.canonical_unit = '370(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = 'SCHOOLTRUCK370(DC)')
    OR (r.canonical_unit = '425(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = '425(DC1TANK)')
  WHERE e.active = 1
    AND e.equipment_type = 'truck'
)
UPDATE equipment
SET active = 0,
    archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
    archive_reason = COALESCE(NULLIF(archive_reason, ''), 'Duplicate normalized semi roster record (2026-08-20)'),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM ranked WHERE roster_rank > 1);

-- Archive obsolete numeric truck records that are still Geotab-linked but are
-- not on the approved semi roster. Preserve company vehicles / vans / plow / rental.
UPDATE equipment
SET active = 0,
    archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
    archive_reason = COALESCE(NULLIF(archive_reason, ''), 'Not on Northern tracked semi roster (2026-08-20 follow-up)'),
    updated_at = CURRENT_TIMESTAMP
WHERE active = 1
  AND equipment_type = 'truck'
  AND LOWER(COALESCE(category, '')) <> 'company vehicles'
  AND UPPER(TRIM(unit)) NOT LIKE '%VAN%'
  AND UPPER(TRIM(unit)) NOT LIKE '%PLOW%'
  AND UPPER(TRIM(unit)) NOT LIKE 'RENTAL%'
  AND TRIM(unit) GLOB '[0-9]*'
  AND (
    COALESCE(TRIM(geotab_device_id), '') <> ''
    OR EXISTS (
      SELECT 1 FROM equipment_geotab_devices a
      WHERE a.equipment_id = equipment.id AND a.current = 1
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM _semi_roster_0084 r
    WHERE UPPER(REPLACE(TRIM(equipment.unit), ' ', '')) = UPPER(REPLACE(r.canonical_unit, ' ', ''))
       OR (r.canonical_unit = '370(DC)' AND UPPER(REPLACE(TRIM(equipment.unit), ' ', '')) = 'SCHOOLTRUCK370(DC)')
       OR (r.canonical_unit = '425(DC)' AND UPPER(REPLACE(TRIM(equipment.unit), ' ', '')) = '425(DC1TANK)')
  );

-- Any archived row must stop being a trusted telemetry target immediately.
UPDATE equipment_geotab_devices
SET current = 0,
    ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
    last_seen_at = CURRENT_TIMESTAMP
WHERE current = 1
  AND equipment_id IN (
    SELECT id FROM equipment WHERE active = 0 OR archived_at IS NOT NULL
  );

DROP TABLE _semi_roster_0084;
