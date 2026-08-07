PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE repairs ADD COLUMN technician_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_technicians_active ON technicians(active);
CREATE INDEX IF NOT EXISTS idx_repairs_technician ON repairs(technician_id);
