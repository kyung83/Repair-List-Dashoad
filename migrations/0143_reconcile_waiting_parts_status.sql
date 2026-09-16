PRAGMA foreign_keys = ON;

-- Repair any stopped shop job that still has an outstanding parts request but
-- was left in a normal Open/Assigned status. Keep technician assignment intact.
UPDATE repairs
SET status = 'Waiting on Part',
    updated_at = CURRENT_TIMESTAMP
WHERE lower(COALESCE(status,'')) NOT LIKE '%complete%'
  AND NOT EXISTS (
    SELECT 1
    FROM repair_labor_timers timer
    WHERE timer.repair_id = repairs.id
  )
  AND (
    EXISTS (
      SELECT 1
      FROM repair_part_requests request
      WHERE request.repair_id = repairs.id
        AND request.status = 'open'
        AND request.requested_quantity > request.used_quantity + 0.000001
    )
    OR EXISTS (
      SELECT 1
      FROM unmatched_part_requests request
      WHERE request.repair_id = repairs.id
        AND request.status = 'open'
    )
  );
