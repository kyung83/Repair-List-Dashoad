PRAGMA foreign_keys = ON;

-- Priority already exists on the original repairs table as TEXT.
-- Normalize old labels into the sheet-style 1/2/3 values without changing the schema.
UPDATE repairs
SET priority = CASE
  WHEN lower(trim(COALESCE(priority, ''))) IN ('1', 'high', 'urgent', 'critical') THEN '1'
  WHEN lower(trim(COALESCE(priority, ''))) IN ('3', 'low') THEN '3'
  ELSE '2'
END;

CREATE INDEX IF NOT EXISTS idx_repairs_priority_updated
ON repairs(priority, updated_at DESC);
