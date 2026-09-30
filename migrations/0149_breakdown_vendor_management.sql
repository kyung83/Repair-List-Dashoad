-- Directory changes only. Existing breakdown/repair/invoice snapshots are not rewritten.
-- No provider FK: the audit must survive an explicitly confirmed unused-vendor deletion.
CREATE TABLE IF NOT EXISTS roadside_vendor_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,
  actor_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('edit','archive','restore','delete')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_roadside_vendor_changes_provider
  ON roadside_vendor_change_log(provider_id);
