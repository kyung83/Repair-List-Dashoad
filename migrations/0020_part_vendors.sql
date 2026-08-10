PRAGMA foreign_keys = ON;

-- A part can be sourced from multiple suppliers. Keep parts.preferred_vendor_id
-- as the single default supplier for existing ordering/display behavior.
CREATE TABLE IF NOT EXISTS part_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  UNIQUE (part_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_part_vendors_part ON part_vendors(part_id);
CREATE INDEX IF NOT EXISTS idx_part_vendors_vendor ON part_vendors(vendor_id);

-- Preserve every existing single-vendor assignment as the first supplier link.
INSERT OR IGNORE INTO part_vendors (part_id, vendor_id)
SELECT id, preferred_vendor_id
FROM parts
WHERE preferred_vendor_id IS NOT NULL;
