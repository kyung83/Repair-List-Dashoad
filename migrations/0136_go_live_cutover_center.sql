PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS go_live_cutover_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  executed_by_user_id INTEGER NOT NULL,
  dvir_cutoff_at TEXT NOT NULL,
  non_breakdown_repairs_deleted INTEGER NOT NULL DEFAULT 0,
  dvir_defects_deleted INTEGER NOT NULL DEFAULT 0,
  oos_units_cleared INTEGER NOT NULL DEFAULT 0,
  breakdown_repairs_protected INTEGER NOT NULL DEFAULT 0,
  historical_ros_protected INTEGER NOT NULL DEFAULT 0,
  inventory_parts_protected INTEGER NOT NULL DEFAULT 0,
  inventory_stock_rows_protected INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (executed_by_user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_go_live_cutover_runs_created
ON go_live_cutover_runs(created_at DESC);

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('dvir_go_live_cutoff_at', '');

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('shop_go_live_completed_at', '');
