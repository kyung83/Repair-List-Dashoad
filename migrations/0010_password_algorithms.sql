ALTER TABLE app_users
ADD COLUMN password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256';
