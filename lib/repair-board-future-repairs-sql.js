// This query mirrors the *waiting* future-service queue used by the
// Planned Repairs and Unit Hub screens. Records already attached to a live
// PM/Annual/repair visit are work orders and should appear on the ordinary
// Repair Board instead of being counted as future work a second time.
//
// Keep this SELECT read-only. Future work is never auto-assigned or activated
// simply because a manager opens the Repair Board.
export const REPAIR_BOARD_FUTURE_REPAIRS_SQL = `
  SELECT n.id, n.equipment_id, n.repair_id, n.description,
         COALESCE(n.target_event_type, 'pm') AS target_event_type,
         n.tagged_at,
         COALESCE(r.status, '') AS repair_status,
         COALESCE(e.unit, '') AS unit,
         COALESCE((
           SELECT COUNT(*)
           FROM repair_planned_parts rpp
           WHERE rpp.repair_id=n.repair_id
             AND rpp.removed_at IS NULL
         ), 0) AS planned_part_count
  FROM pm_next_repairs n
  JOIN repairs r ON r.id=n.repair_id
  JOIN equipment e ON e.id=n.equipment_id
  WHERE n.status='pending'
    AND n.target_repair_id IS NULL
    AND n.repair_id IS NOT NULL
  ORDER BY e.unit COLLATE NOCASE, n.tagged_at, n.id
`;
