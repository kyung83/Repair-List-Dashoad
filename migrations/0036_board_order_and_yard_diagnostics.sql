CREATE TABLE IF NOT EXISTS repair_board_order (
  scope TEXT NOT NULL,
  group_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, group_key)
);

CREATE INDEX IF NOT EXISTS idx_repair_board_order_scope_sort
ON repair_board_order(scope, sort_order);

CREATE TABLE IF NOT EXISTS geotab_yard_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  positions INTEGER NOT NULL DEFAULT 0,
  clare INTEGER NOT NULL DEFAULT 0,
  cadillac INTEGER NOT NULL DEFAULT 0,
  outside INTEGER NOT NULL DEFAULT 0,
  clare_zone_found INTEGER NOT NULL DEFAULT 0,
  cadillac_zone_found INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

INSERT OR IGNORE INTO geotab_yard_sync_state (id) VALUES (1);
