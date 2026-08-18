PRAGMA foreign_keys = ON;

-- Calibrate raw Geotab odometer readings to the trusted truck mileage when a
-- telematics device is replaced or has a different odometer baseline.
ALTER TABLE equipment_geotab_devices ADD COLUMN mileage_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE equipment_geotab_devices ADD COLUMN mileage_calibrated_at TEXT;
ALTER TABLE equipment_geotab_devices ADD COLUMN mileage_calibrated_by_user_id INTEGER;

-- Record who deliberately resolved an ambiguous identity mapping and why.
ALTER TABLE geotab_reconciliation_queue ADD COLUMN resolved_by_user_id INTEGER;
ALTER TABLE geotab_reconciliation_queue ADD COLUMN resolution_note TEXT;

-- Preserve both the raw device reading and the offset-adjusted candidate used
-- by the PM-mileage safety check, plus the administrator's review decision.
ALTER TABLE geotab_mileage_anomalies ADD COLUMN raw_mileage INTEGER;
ALTER TABLE geotab_mileage_anomalies ADD COLUMN adjusted_mileage INTEGER;
ALTER TABLE geotab_mileage_anomalies ADD COLUMN trusted_mileage INTEGER;
ALTER TABLE geotab_mileage_anomalies ADD COLUMN reviewed_by_user_id INTEGER;
ALTER TABLE geotab_mileage_anomalies ADD COLUMN review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_geotab_device_assignments_review
ON equipment_geotab_devices(current, equipment_id, geotab_device_id, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_geotab_reconciliation_resolved_by
ON geotab_reconciliation_queue(status, resolved_by_user_id, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_geotab_mileage_reviewed_by
ON geotab_mileage_anomalies(status, reviewed_by_user_id, created_at);
