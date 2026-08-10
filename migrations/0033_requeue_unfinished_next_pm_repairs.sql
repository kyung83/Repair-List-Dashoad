PRAGMA foreign_keys = ON;

-- If a scheduled PM is completed before every attached next-PM finding is resolved,
-- put those findings back in the queue automatically. This prevents a deferred
-- safety/maintenance note from disappearing just because the PM work order closed.
CREATE TRIGGER IF NOT EXISTS trg_requeue_unfinished_next_pm_repairs
AFTER UPDATE OF status ON repairs
WHEN NEW.source = 'scheduled-pm'
  AND lower(COALESCE(NEW.status, '')) LIKE '%complete%'
  AND lower(COALESCE(OLD.status, '')) NOT LIKE '%complete%'
BEGIN
  UPDATE pm_next_repairs
  SET status = 'pending',
      target_repair_id = NULL,
      attached_at = NULL,
      queued_from_repair_id = NEW.id,
      defer_count = defer_count + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE target_repair_id = NEW.id
    AND status = 'attached';
END;
