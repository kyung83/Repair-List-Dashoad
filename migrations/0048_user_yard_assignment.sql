ALTER TABLE app_users ADD COLUMN yard TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_app_users_yard_role_active
ON app_users(yard, role, active);
