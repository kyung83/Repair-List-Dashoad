PRAGMA foreign_keys = ON;

ALTER TABLE repairs ADD COLUMN reviewed_at TEXT;
ALTER TABLE repairs ADD COLUMN reviewed_by_user_id INTEGER;
ALTER TABLE repairs ADD COLUMN review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_repairs_work_order_review
ON repairs(status, reviewed_at, completed_at, equipment_id, technician_id);

-- Cut over the manager review queue at the start of August 18, 2026 in Detroit
-- (04:00 UTC). Older completed repairs remain available as reviewed history,
-- while today's technician completions -- including work already completed
-- before this migration deploys -- enter Needs Review.
UPDATE repairs
SET reviewed_at = COALESCE(completed_at, updated_at),
    review_note = CASE
      WHEN COALESCE(review_note, '') = '' THEN 'Historical completion before manager work-order review workflow.'
      ELSE review_note
    END
WHERE lower(COALESCE(status,'')) LIKE '%complete%'
  AND reviewed_at IS NULL
  AND COALESCE(completed_at, updated_at) < '2026-08-18 04:00:00';
