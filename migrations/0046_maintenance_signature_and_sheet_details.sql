PRAGMA foreign_keys = ON;
ALTER TABLE maintenance_checklist_runs ADD COLUMN signature_strokes TEXT;
ALTER TABLE maintenance_checklist_runs ADD COLUMN signed_by_user_id INTEGER;
ALTER TABLE maintenance_checklist_runs ADD COLUMN signed_at TEXT;
ALTER TABLE maintenance_checklist_runs ADD COLUMN pm_brake_notes TEXT;
ALTER TABLE maintenance_checklist_runs ADD COLUMN pm_comments TEXT;
ALTER TABLE maintenance_checklist_runs ADD COLUMN pm_tire_data_json TEXT;
