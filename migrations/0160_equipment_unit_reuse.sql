PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS equipment_unit_reuse_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prior_equipment_id INTEGER NOT NULL,
  replacement_equipment_id INTEGER NOT NULL,
  unit TEXT NOT NULL,
  prior_internal_unit TEXT NOT NULL,
  geotab_device_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prior_equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (replacement_equipment_id) REFERENCES equipment(id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_unit_reuse_unit
ON equipment_unit_reuse_events(unit, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_equipment_unit_reuse_prior
ON equipment_unit_reuse_events(prior_equipment_id);

CREATE INDEX IF NOT EXISTS idx_equipment_unit_reuse_replacement
ON equipment_unit_reuse_events(replacement_equipment_id);

-- 126(BT) was physically replaced and the fleet number was reused. The existing
-- equipment row contains the old truck's repair/PM/annual/cost history, but the
-- current Geotab device now belongs to the replacement truck. Split those two
-- physical assets while keeping the visible current unit number 126(BT).
DROP TABLE IF EXISTS _reuse_126_bt_0160;
CREATE TABLE _reuse_126_bt_0160 AS
SELECT
  e.id AS prior_equipment_id,
  e.unit,
  e.category,
  e.equipment_type,
  e.trailer_type,
  e.trailer_subtype,
  e.current_mileage,
  e.mileage_updated_at,
  e.geotab_device_id,
  e.geotab_trailer_id
FROM equipment e
WHERE lower(trim(e.unit)) = lower('126(BT)')
  AND e.merged_into_equipment_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM equipment_unit_reuse_events r
    WHERE lower(trim(r.unit)) = lower('126(BT)')
  )
ORDER BY CASE WHEN e.active = 1 AND e.archived_at IS NULL THEN 0 ELSE 1 END, e.id DESC
LIMIT 1;

UPDATE equipment
SET unit = 'HIST-126(BT)-' || id,
    active = 0,
    archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
    archive_reason = 'Prior physical asset retained because fleet number 126(BT) was reused',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT prior_equipment_id FROM _reuse_126_bt_0160);

INSERT INTO equipment (
  unit,
  category,
  equipment_type,
  trailer_type,
  trailer_subtype,
  active,
  current_mileage,
  mileage_updated_at,
  geotab_device_id,
  geotab_trailer_id,
  notes,
  updated_at
)
SELECT
  '126(BT)',
  category,
  equipment_type,
  trailer_type,
  trailer_subtype,
  1,
  current_mileage,
  mileage_updated_at,
  geotab_device_id,
  geotab_trailer_id,
  'Replacement physical asset using reused fleet number 126(BT). Prior asset history is retained separately.',
  CURRENT_TIMESTAMP
FROM _reuse_126_bt_0160;

UPDATE equipment_geotab_devices
SET equipment_id = (
      SELECT id FROM equipment
      WHERE unit = '126(BT)' AND active = 1 AND archived_at IS NULL
      ORDER BY id DESC LIMIT 1
    ),
    linked_by = '0160-unit-reuse-126',
    last_seen_at = CURRENT_TIMESTAMP
WHERE equipment_id IN (SELECT prior_equipment_id FROM _reuse_126_bt_0160)
  AND current = 1;

UPDATE geotab_unit_state
SET equipment_id = (
      SELECT id FROM equipment
      WHERE unit = '126(BT)' AND active = 1 AND archived_at IS NULL
      ORDER BY id DESC LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE equipment_id IN (SELECT prior_equipment_id FROM _reuse_126_bt_0160);

UPDATE equipment
SET geotab_device_id = NULL,
    geotab_trailer_id = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT prior_equipment_id FROM _reuse_126_bt_0160);

INSERT INTO equipment_unit_reuse_events (
  prior_equipment_id,
  replacement_equipment_id,
  unit,
  prior_internal_unit,
  geotab_device_id,
  note
)
SELECT
  s.prior_equipment_id,
  n.id,
  '126(BT)',
  'HIST-126(BT)-' || s.prior_equipment_id,
  s.geotab_device_id,
  'Automatic split of reused fleet number 126(BT); old history retained on prior equipment ID and current Geotab assignment moved to replacement asset.'
FROM _reuse_126_bt_0160 s
JOIN equipment n
  ON n.unit = '126(BT)'
 AND n.active = 1
 AND n.archived_at IS NULL;

DROP TABLE IF EXISTS _reuse_126_bt_0160;
