-- Existing equipment, schedules, templates, inspection runs and annual forms remain unchanged.
-- A truck body type is shop-maintained, never inferred from a dispatch or PM group.
ALTER TABLE equipment ADD COLUMN truck_body_type TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS pm_body_checklist_assignments (
  equipment_type TEXT NOT NULL CHECK(equipment_type IN ('truck','trailer')),
  body_type TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(body_type)) BETWEEN 1 AND 100),
  template_key TEXT NOT NULL,
  updated_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(equipment_type,body_type)
);
CREATE INDEX IF NOT EXISTS idx_pm_body_checklist_template ON pm_body_checklist_assignments(template_key);
-- Only populated when a body-specific PM override actually selected the template.
-- This identifies an eligible copy for the existing conservative PM -> Annual reuse.
ALTER TABLE maintenance_checklist_runs ADD COLUMN pm_body_type_snapshot TEXT;
