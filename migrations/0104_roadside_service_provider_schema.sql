-- Roadside service-provider directory supplied by operations on 2026-08-28.
-- Distinct locations are preserved; exact duplicate rows are collapsed.
CREATE TABLE IF NOT EXISTS roadside_service_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  phone_digits TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  source TEXT NOT NULL DEFAULT 'manual',
  source_order INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadside_service_provider_location
  ON roadside_service_providers(name, phone, city, state, zip);
CREATE INDEX IF NOT EXISTS idx_roadside_service_providers_state_city
  ON roadside_service_providers(state, city, name);
CREATE INDEX IF NOT EXISTS idx_roadside_service_providers_phone_digits
  ON roadside_service_providers(phone_digits);
