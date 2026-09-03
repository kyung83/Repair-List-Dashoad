ALTER TABLE app_users ADD COLUMN dispatch_access INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_access IN (0,1));
