-- Driver-side roadside follow-up and optional receipt review.
ALTER TABLE roadside_breakdowns ADD COLUMN driver_access_token_hash TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN driver_status TEXT NOT NULL DEFAULT 'waiting';
ALTER TABLE roadside_breakdowns ADD COLUMN tech_arrived_at TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN repair_finished_at TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN rolling_at TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN ready_for_review_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadside_breakdowns_driver_access_token_hash
  ON roadside_breakdowns(driver_access_token_hash)
  WHERE driver_access_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS roadside_breakdown_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  breakdown_id INTEGER NOT NULL UNIQUE REFERENCES roadside_breakdowns(id) ON DELETE CASCADE,
  repair_id INTEGER NOT NULL REFERENCES repairs(id),
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_model TEXT NOT NULL DEFAULT '',
  ai_vendor TEXT NOT NULL DEFAULT '',
  ai_invoice_number TEXT NOT NULL DEFAULT '',
  ai_invoice_date TEXT NOT NULL DEFAULT '',
  ai_unit TEXT NOT NULL DEFAULT '',
  ai_mileage TEXT NOT NULL DEFAULT '',
  ai_total_amount TEXT NOT NULL DEFAULT '',
  ai_service_summary TEXT NOT NULL DEFAULT '',
  ai_costs_json TEXT NOT NULL DEFAULT '{}',
  ai_uncertain_json TEXT NOT NULL DEFAULT '[]',
  ai_error TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_vendor TEXT NOT NULL DEFAULT '',
  reviewed_invoice_number TEXT NOT NULL DEFAULT '',
  reviewed_invoice_date TEXT NOT NULL DEFAULT '',
  reviewed_total_amount TEXT NOT NULL DEFAULT '',
  reviewed_service_summary TEXT NOT NULL DEFAULT '',
  reviewed_by_user_id INTEGER REFERENCES app_users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roadside_breakdown_receipts_review
  ON roadside_breakdown_receipts(review_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS roadside_breakdown_receipt_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES roadside_breakdown_receipts(id) ON DELETE CASCADE,
  page_order INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(receipt_id, page_order)
);

CREATE INDEX IF NOT EXISTS idx_roadside_breakdown_receipt_pages_receipt
  ON roadside_breakdown_receipt_pages(receipt_id, page_order);
