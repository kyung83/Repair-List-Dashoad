PRAGMA foreign_keys = ON;
-- Monotonic per-question revisions prevent two technicians from silently
-- replacing one another's answers from different devices.
ALTER TABLE maintenance_checklist_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repair_type_checklist_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
