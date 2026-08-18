# Equipment merge safety contract

Historical Geotab equipment forks are consolidated only through the administrator equipment-merge workflow.

## Invariants

- The duplicate equipment row is never deleted.
- The canonical equipment row must be unarchived and must not itself be a merged tombstone.
- Historical Geotab fork merges require both rows to carry the same non-empty legacy Geotab device ID before the merge begins.
- Conflicting non-empty VINs block the merge.
- Two current Geotab hardware assignments block the merge.
- The merge code inspects SQLite's live foreign-key catalog and refuses to run if the set of relationships to `equipment(id)` differs from the explicitly supported map.
- All history/reference mutations run in one D1 `batch()` transaction. The audit reservation is first and `source_equipment_id` is unique, so competing/repeated merges fail before references move.
- One-to-one PM/annual/status rows and equipment-specific unique rows are consolidated before the source references are moved.
- The duplicate becomes an archived merged tombstone. A database trigger prevents restoring it.
- On first transition to a merged tombstone, a database trigger prefixes the duplicate unit and clears its legacy `geotab_device_id` and `vin` so the live sync cannot match the tombstone. The original identity and full pre-merge equipment snapshots are retained in `equipment_merge_events`.

## Direct equipment relationships covered

- `equipment_pm_settings.equipment_id`
- `repairs.equipment_id`
- `pm_status.equipment_id`
- `equipment_annual_settings.equipment_id`
- `unit_expenses.equipment_id`
- `maintenance_events.equipment_id`
- `invoices.equipment_id`
- `historical_repairs.equipment_id`
- `historical_repair_lines.equipment_id`
- `part_equipment.equipment_id`
- `equipment_status_events.equipment_id`
- `pm_next_repairs.equipment_id`
- `maintenance_checklist_runs.equipment_id`
- `equipment_geotab_devices.equipment_id`
- `geotab_reconciliation_queue.resolved_equipment_id`
- `geotab_mileage_anomalies.equipment_id`
- `equipment.merged_into_equipment_id`
- `equipment_merge_events.source_equipment_id`
- `equipment_merge_events.target_equipment_id`

Import audit fields such as `pm_history_import_audit.matched_equipment_id` are deliberately not rewritten because they are source-import provenance, not live foreign-key relationships.
