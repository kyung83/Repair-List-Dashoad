PRAGMA foreign_keys = ON;

-- Add explicit protection snapshots to the one-time cutover audit.
ALTER TABLE go_live_cutover_runs ADD COLUMN inventory_quantity_before REAL NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN inventory_quantity_after REAL NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN inventory_operations_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN inventory_operations_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN breakdown_rows_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN breakdown_rows_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN active_equipment_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN active_equipment_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE go_live_cutover_runs ADD COLUMN inventory_link_blockers INTEGER NOT NULL DEFAULT 0;
