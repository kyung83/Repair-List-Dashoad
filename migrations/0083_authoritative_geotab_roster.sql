PRAGMA foreign_keys = ON;

-- Northern's 2026-08-20 master roster is authoritative. Geotab is a telemetry
-- provider only; company vehicles are intentionally not changed by this cleanup.
CREATE TABLE _geotab_roster_0083 (
  kind TEXT NOT NULL CHECK (kind IN ('semi', 'trailer')),
  canonical_unit TEXT NOT NULL,
  numeric_unit INTEGER NOT NULL,
  PRIMARY KEY (kind, canonical_unit)
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
INSERT INTO _geotab_roster_0083 (kind, canonical_unit, numeric_unit)
SELECT 'semi', CAST(n AS TEXT) || '(' || suffix || ')', n FROM nums;

WITH RECURSIVE
  ranges(start_value, end_value) AS (
    VALUES
    (202, 202), (204, 206), (208, 209), (211, 234), (236, 243), (245, 266),
    (53000, 53058), (53060, 53089), (53091, 53101), (53103, 53149), (53151, 53193), (53200, 53376),
    (53759, 53759), (53761, 53761), (53765, 53765), (53772, 53772), (53775, 53775),
    (53783, 53783), (53789, 53789), (53794, 53794), (53798, 53800), (53802, 53802),
    (53805, 53806), (53808, 53810), (53813, 53813), (53817, 53817), (53819, 53821),
    (53824, 53826), (53828, 53830), (53832, 53834), (53837, 53837), (53842, 53857),
    (53859, 53859), (53861, 53861), (53863, 53876), (53879, 53880), (53882, 53882),
    (53886, 53887), (53889, 53912), (53916, 53916), (53919, 53927), (53929, 53940),
    (53942, 53963), (53965, 53999)
  ),
  nums(n, end_value) AS (
    SELECT start_value, end_value FROM ranges
    UNION ALL
    SELECT n + 1, end_value FROM nums WHERE n < end_value
  )
INSERT INTO _geotab_roster_0083 (kind, canonical_unit, numeric_unit)
SELECT 'trailer', CASE WHEN n < 1000 THEN 'TRL ' || n ELSE CAST(n AS TEXT) END, n FROM nums;

-- Archive semi-style equipment outside the approved semi list. Company cars,
-- vans and switchers do not use these parenthesized fleet suffixes and are left unchanged.
UPDATE equipment
SET active = 0,
    archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
    archive_reason = COALESCE(NULLIF(archive_reason, ''), 'Not on Northern tracked semi roster (2026-08-20)'),
    updated_at = CURRENT_TIMESTAMP
WHERE active = 1
  AND equipment_type = 'truck'
  AND (
    UPPER(REPLACE(unit, ' ', '')) LIKE '%(DC%'
    OR UPPER(REPLACE(unit, ' ', '')) LIKE '%(SC%'
    OR UPPER(REPLACE(unit, ' ', '')) LIKE '%(BT%'
    OR UPPER(REPLACE(unit, ' ', '')) LIKE '%(EGR%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM _geotab_roster_0083 r
    WHERE r.kind = 'semi'
      AND (
        UPPER(REPLACE(TRIM(equipment.unit), ' ', '')) = UPPER(REPLACE(r.canonical_unit, ' ', ''))
        OR (r.canonical_unit = '370(DC)' AND UPPER(REPLACE(TRIM(equipment.unit), ' ', '')) = 'SCHOOLTRUCK370(DC)')
        OR (r.canonical_unit = '425(DC)' AND UPPER(REPLACE(TRIM(equipment.unit), ' ', '')) = '425(DC1TANK)')
      )
  );

-- Archive only Geotab-linked trailers outside the approved GPS trailer roster.
-- Manual trailers with no Geotab identity remain available for manual entry/history.
UPDATE equipment
SET active = 0,
    archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
    archive_reason = COALESCE(NULLIF(archive_reason, ''), 'Not on Northern GPS trailer roster (2026-08-20)'),
    updated_at = CURRENT_TIMESTAMP
WHERE active = 1
  AND (
    equipment_type = 'trailer'
    OR UPPER(TRIM(unit)) LIKE 'TRL%'
    OR COALESCE(geotab_asset_class, '') = 'trailer'
  )
  AND (
    geotab_device_id IS NOT NULL
    OR geotab_trailer_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM equipment_geotab_devices a WHERE a.equipment_id = equipment.id AND a.current = 1)
  )
  AND NOT EXISTS (
    SELECT 1 FROM _geotab_roster_0083 r
    WHERE r.kind = 'trailer'
      AND (
        (r.numeric_unit < 1000 AND REPLACE(UPPER(TRIM(equipment.unit)), ' ', '') = 'TRL' || r.numeric_unit)
        OR (r.numeric_unit >= 1000 AND TRIM(equipment.unit) = CAST(r.numeric_unit AS TEXT))
      )
  );

-- Archived/inactive equipment must not retain a current telemetry assignment.
UPDATE equipment_geotab_devices
SET current = 0,
    ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
    last_seen_at = CURRENT_TIMESTAMP
WHERE current = 1
  AND equipment_id IN (SELECT id FROM equipment WHERE active = 0 OR archived_at IS NOT NULL);

-- Reactivation is deliberately OR IGNORE because production contains historical
-- duplicates sharing a Geotab identity. If a sibling already owns that device,
-- leave the duplicate inactive rather than aborting the whole roster migration.
UPDATE OR IGNORE equipment
SET active = 1,
    archived_at = NULL,
    archive_reason = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE active = 0
  AND id IN (
    SELECT e.id
    FROM equipment e
    JOIN _geotab_roster_0083 r ON r.kind = 'semi'
    WHERE (
      UPPER(REPLACE(TRIM(e.unit), ' ', '')) = UPPER(REPLACE(r.canonical_unit, ' ', ''))
      OR (r.canonical_unit = '370(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = 'SCHOOLTRUCK370(DC)')
      OR (r.canonical_unit = '425(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = '425(DC1TANK)')
    )
    AND NOT EXISTS (
      SELECT 1 FROM equipment other
      WHERE other.id <> e.id AND other.active = 1
        AND (
          UPPER(REPLACE(TRIM(other.unit), ' ', '')) = UPPER(REPLACE(r.canonical_unit, ' ', ''))
          OR (r.canonical_unit = '370(DC)' AND UPPER(REPLACE(TRIM(other.unit), ' ', '')) = 'SCHOOLTRUCK370(DC)')
          OR (r.canonical_unit = '425(DC)' AND UPPER(REPLACE(TRIM(other.unit), ' ', '')) = '425(DC1TANK)')
        )
    )
  );

UPDATE OR IGNORE equipment
SET active = 1,
    archived_at = NULL,
    archive_reason = NULL,
    equipment_type = 'trailer',
    category = 'Trailers',
    updated_at = CURRENT_TIMESTAMP
WHERE active = 0
  AND id IN (
    SELECT e.id
    FROM equipment e
    JOIN _geotab_roster_0083 r ON r.kind = 'trailer'
    WHERE (
      (r.numeric_unit < 1000 AND REPLACE(UPPER(TRIM(e.unit)), ' ', '') = 'TRL' || r.numeric_unit)
      OR (r.numeric_unit >= 1000 AND TRIM(e.unit) = CAST(r.numeric_unit AS TEXT))
    )
    AND NOT EXISTS (
      SELECT 1 FROM equipment other
      WHERE other.id <> e.id AND other.active = 1
        AND (
          (r.numeric_unit < 1000 AND REPLACE(UPPER(TRIM(other.unit)), ' ', '') = 'TRL' || r.numeric_unit)
          OR (r.numeric_unit >= 1000 AND TRIM(other.unit) = CAST(r.numeric_unit AS TEXT))
        )
    )
  );

-- Reclassify active approved trailer rows without touching their identity columns.
UPDATE OR IGNORE equipment
SET equipment_type = 'trailer', category = 'Trailers', updated_at = CURRENT_TIMESTAMP
WHERE active = 1
  AND EXISTS (
    SELECT 1 FROM _geotab_roster_0083 r
    WHERE r.kind = 'trailer'
      AND (
        (r.numeric_unit < 1000 AND REPLACE(UPPER(TRIM(equipment.unit)), ' ', '') = 'TRL' || r.numeric_unit)
        OR (r.numeric_unit >= 1000 AND TRIM(equipment.unit) = CAST(r.numeric_unit AS TEXT))
      )
  );

-- Create master records only for approved units that are genuinely absent.
INSERT OR IGNORE INTO equipment (unit, category, equipment_type, active, updated_at)
SELECT r.canonical_unit, 'fleet', 'truck', 1, CURRENT_TIMESTAMP
FROM _geotab_roster_0083 r
WHERE r.kind = 'semi'
  AND NOT EXISTS (
    SELECT 1 FROM equipment e
    WHERE UPPER(REPLACE(TRIM(e.unit), ' ', '')) = UPPER(REPLACE(r.canonical_unit, ' ', ''))
       OR (r.canonical_unit = '370(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = 'SCHOOLTRUCK370(DC)')
       OR (r.canonical_unit = '425(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = '425(DC1TANK)')
  );

INSERT OR IGNORE INTO equipment (unit, category, equipment_type, active, updated_at)
SELECT r.canonical_unit, 'Trailers', 'trailer', 1, CURRENT_TIMESTAMP
FROM _geotab_roster_0083 r
WHERE r.kind = 'trailer'
  AND NOT EXISTS (
    SELECT 1 FROM equipment e
    WHERE (r.numeric_unit < 1000 AND REPLACE(UPPER(TRIM(e.unit)), ' ', '') = 'TRL' || r.numeric_unit)
       OR (r.numeric_unit >= 1000 AND TRIM(e.unit) = CAST(r.numeric_unit AS TEXT))
  );

-- Seed explicit current assignments from already-trusted device IDs for active
-- master semis/trailers and company vehicles. Assignment is now the only
-- production mileage authority; name/VIN fallback cannot grant tracking rights.
INSERT OR IGNORE INTO equipment_geotab_devices (
  equipment_id, geotab_device_id, geotab_name, vin_seen,
  assigned_at, last_seen_at, current, linked_by
)
SELECT e.id, e.geotab_device_id, e.unit, e.vin,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, '0083-authoritative-roster'
FROM equipment e
WHERE e.active = 1
  AND e.archived_at IS NULL
  AND e.geotab_device_id IS NOT NULL
  AND TRIM(e.geotab_device_id) <> ''
  AND (
    e.equipment_type = 'vehicle'
    OR e.category = 'Company Vehicles'
    OR EXISTS (
      SELECT 1 FROM _geotab_roster_0083 r
      WHERE (r.kind = 'semi' AND (
          UPPER(REPLACE(TRIM(e.unit), ' ', '')) = UPPER(REPLACE(r.canonical_unit, ' ', ''))
          OR (r.canonical_unit = '370(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = 'SCHOOLTRUCK370(DC)')
          OR (r.canonical_unit = '425(DC)' AND UPPER(REPLACE(TRIM(e.unit), ' ', '')) = '425(DC1TANK)')
        ))
        OR (r.kind = 'trailer' AND (
          (r.numeric_unit < 1000 AND REPLACE(UPPER(TRIM(e.unit)), ' ', '') = 'TRL' || r.numeric_unit)
          OR (r.numeric_unit >= 1000 AND TRIM(e.unit) = CAST(r.numeric_unit AS TEXT))
        ))
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM equipment_geotab_devices a
    WHERE a.current = 1 AND (a.equipment_id = e.id OR a.geotab_device_id = e.geotab_device_id)
  );

DROP TABLE _geotab_roster_0083;
