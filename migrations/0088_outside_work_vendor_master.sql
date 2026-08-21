PRAGMA foreign_keys = ON;

-- Outside Work must resolve to the vendor master instead of persisting an
-- unverified free-text vendor as the authoritative relationship.
ALTER TABLE outside_work_documents ADD COLUMN vendor_id INTEGER REFERENCES vendors(id);

CREATE INDEX IF NOT EXISTS idx_outside_work_vendor_id
ON outside_work_documents(vendor_id);

-- Safe backfill only: link records whose saved vendor text already matches a
-- single active vendor name exactly (case-insensitive, surrounding whitespace ignored).
UPDATE outside_work_documents
SET vendor_id = (
  SELECT v.id
  FROM vendors v
  WHERE COALESCE(v.active, 1) = 1
    AND UPPER(TRIM(v.name)) = UPPER(TRIM(outside_work_documents.vendor_name))
  ORDER BY v.id
  LIMIT 1
)
WHERE vendor_id IS NULL
  AND TRIM(COALESCE(vendor_name, '')) <> ''
  AND 1 = (
    SELECT COUNT(*)
    FROM vendors v
    WHERE COALESCE(v.active, 1) = 1
      AND UPPER(TRIM(v.name)) = UPPER(TRIM(outside_work_documents.vendor_name))
  );
