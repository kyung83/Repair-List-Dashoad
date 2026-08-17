ALTER TABLE geotab_yard_sync_state ADD COLUMN gr INTEGER NOT NULL DEFAULT 0;
ALTER TABLE geotab_yard_sync_state ADD COLUMN taylor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE geotab_yard_sync_state ADD COLUMN boyne INTEGER NOT NULL DEFAULT 0;
ALTER TABLE geotab_yard_sync_state ADD COLUMN gr_zone_found INTEGER NOT NULL DEFAULT 0;
ALTER TABLE geotab_yard_sync_state ADD COLUMN taylor_zone_found INTEGER NOT NULL DEFAULT 0;
ALTER TABLE geotab_yard_sync_state ADD COLUMN boyne_zone_found INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO warehouses (code, name) VALUES
  ('GR', 'Grand Rapids shop'),
  ('TAYLOR', 'Taylor shop');
