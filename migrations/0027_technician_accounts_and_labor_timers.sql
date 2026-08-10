PRAGMA foreign_keys = ON;

-- Keep the legacy email column for backwards-compatible administrator sign-in,
-- while making username the primary identifier for new shop accounts.
ALTER TABLE app_users ADD COLUMN username TEXT;
ALTER TABLE app_users ADD COLUMN technician_id INTEGER REFERENCES technicians(id);

UPDATE app_users
SET username = CASE
  WHEN instr(email, '@') > 1
    THEN lower(substr(email, 1, instr(email, '@') - 1)) || '-' || id
  ELSE 'user-' || id
END
WHERE username IS NULL OR trim(username) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_nocase
ON app_users(username COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_app_users_technician
ON app_users(technician_id);

-- Link existing mechanic accounts to an existing technician with the same display name
-- when possible. New mechanic accounts are linked automatically by the admin API.
UPDATE app_users
SET technician_id = (
  SELECT t.id
  FROM technicians t
  WHERE lower(trim(t.name)) = lower(trim(app_users.display_name))
    AND t.active = 1
  ORDER BY t.id
  LIMIT 1
)
WHERE role = 'mechanic'
  AND technician_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM technicians t
    WHERE lower(trim(t.name)) = lower(trim(app_users.display_name))
      AND t.active = 1
  );

-- One row per user enforces one active labor timer per technician account.
CREATE TABLE IF NOT EXISTS repair_labor_timers (
  user_id INTEGER PRIMARY KEY,
  repair_id INTEGER NOT NULL,
  technician_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id)
);

CREATE INDEX IF NOT EXISTS idx_repair_labor_timers_repair
ON repair_labor_timers(repair_id);

CREATE TABLE IF NOT EXISTS repair_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  user_id INTEGER,
  technician_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_job_events_repair_created
ON repair_job_events(repair_id, created_at DESC);
