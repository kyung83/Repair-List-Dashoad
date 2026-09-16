PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS maintenance_checklist_template_assignments (
  event_type TEXT NOT NULL CHECK (event_type IN ('pm','annual')),
  applies_to TEXT NOT NULL CHECK (applies_to IN ('truck','trailer')),
  template_key TEXT NOT NULL,
  updated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_type, applies_to),
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_checklist_template_assignments_key
ON maintenance_checklist_template_assignments(event_type, template_key);

-- Preserve today's behavior on deploy. Managers can switch truck and trailer
-- assignments independently from the checklist editor after this migration.
INSERT OR IGNORE INTO maintenance_checklist_template_assignments (event_type, applies_to, template_key)
VALUES
  ('pm', 'truck', 'default'),
  ('pm', 'trailer', 'default'),
  ('annual', 'truck', 'default'),
  ('annual', 'trailer', 'default');
