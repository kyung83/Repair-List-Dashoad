INSERT INTO app_settings (key, value, updated_at)
VALUES ('shop_labor_rate', '50', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;
