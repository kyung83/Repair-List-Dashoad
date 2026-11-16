PRAGMA foreign_keys = ON;

-- Additive team membership. The existing repairs.technician_id remains the
-- primary owner and does not change when helpers join/leave.
CREATE TABLE IF NOT EXISTS repair_team_members (
  repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  technician_id INTEGER NOT NULL REFERENCES technicians(id),
  added_by_user_id INTEGER REFERENCES app_users(id),
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (repair_id, technician_id)
);
CREATE INDEX IF NOT EXISTS idx_repair_team_members_technician
ON repair_team_members(technician_id, repair_id);
