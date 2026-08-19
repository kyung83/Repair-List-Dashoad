PRAGMA foreign_keys = ON;

-- Invoices historically pointed at one repair. A completed work order can contain
-- several repairs, so keep the original invoices.repair_id as the primary/backward-
-- compatible repair while recording every repair that contributed to the invoice.
-- Invoice lines remain the immutable billing snapshot.
CREATE TABLE IF NOT EXISTS invoice_repair_links (
  invoice_id INTEGER NOT NULL,
  repair_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (invoice_id, repair_id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_repair_links_repair
ON invoice_repair_links(repair_id, invoice_id);

-- Backfill all legacy invoices so old and new invoices use the same read path.
INSERT OR IGNORE INTO invoice_repair_links (invoice_id, repair_id, sort_order)
SELECT id, repair_id, 0
FROM invoices
WHERE repair_id IS NOT NULL;
