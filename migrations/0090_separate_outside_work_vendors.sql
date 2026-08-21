-- Outside Work has its own vendor master. Inventory/parts suppliers remain in
-- the existing vendors table and are no longer read or written by Outside Work.
CREATE TABLE IF NOT EXISTS outside_work_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outside_work_vendors_name
ON outside_work_vendors(name);

CREATE INDEX IF NOT EXISTS idx_outside_work_vendors_phone
ON outside_work_vendors(phone);

-- Preserve vendors that Outside Work previously used from the shared vendor
-- table, plus vendors that had explicitly been created as road-repair vendors.
-- If the old shared table contains duplicate spellings that are identical after
-- case/whitespace normalization, keep one deterministic source row.
WITH legacy_candidates AS (
  SELECT v.id,v.name,v.phone,v.email,v.address,v.notes,v.active
  FROM vendors v
  WHERE (
      v.id IN (SELECT DISTINCT vendor_id FROM outside_work_documents WHERE vendor_id IS NOT NULL)
      OR COALESCE(v.supplier_type,'')='Outside Work / Road Repair'
    )
    AND TRIM(COALESCE(v.name,''))<>''
), legacy_unique AS (
  SELECT lc.*
  FROM legacy_candidates lc
  WHERE lc.id=(
    SELECT MIN(lc2.id)
    FROM legacy_candidates lc2
    WHERE UPPER(TRIM(lc2.name))=UPPER(TRIM(lc.name))
  )
)
INSERT INTO outside_work_vendors (name,phone,email,address,notes,active)
SELECT lu.name,lu.phone,lu.email,lu.address,
       COALESCE(NULLIF(lu.notes,''),'Migrated from the legacy shared vendor master.'),
       COALESCE(lu.active,1)
FROM legacy_unique lu
WHERE NOT EXISTS (
  SELECT 1 FROM outside_work_vendors ov
  WHERE UPPER(TRIM(ov.name))=UPPER(TRIM(lu.name))
);

-- Preserve any historical Outside Work vendor text that did not have a shared
-- vendor-master link. Group case variants so the new master starts clean.
WITH history_names AS (
  SELECT UPPER(TRIM(vendor_name)) AS name_key,MIN(TRIM(vendor_name)) AS name
  FROM outside_work_documents
  WHERE TRIM(COALESCE(vendor_name,''))<>''
  GROUP BY UPPER(TRIM(vendor_name))
)
INSERT INTO outside_work_vendors (name,notes,active)
SELECT hn.name,'Migrated from existing Outside Work history.',1
FROM history_names hn
WHERE NOT EXISTS (
  SELECT 1 FROM outside_work_vendors ov
  WHERE UPPER(TRIM(ov.name))=hn.name_key
);

ALTER TABLE outside_work_documents
ADD COLUMN outside_vendor_id INTEGER REFERENCES outside_work_vendors(id);

UPDATE outside_work_documents
SET outside_vendor_id=(
  SELECT ov.id
  FROM outside_work_vendors ov
  WHERE UPPER(TRIM(ov.name))=UPPER(TRIM(outside_work_documents.vendor_name))
  ORDER BY ov.id
  LIMIT 1
)
WHERE outside_vendor_id IS NULL
  AND TRIM(COALESCE(vendor_name,''))<>''
  AND 1=(
    SELECT COUNT(*)
    FROM outside_work_vendors ov
    WHERE UPPER(TRIM(ov.name))=UPPER(TRIM(outside_work_documents.vendor_name))
  );

CREATE INDEX IF NOT EXISTS idx_outside_work_outside_vendor_id
ON outside_work_documents(outside_vendor_id);

-- Once the separate relationship is established, remove the live relationship
-- to the inventory supplier master. The legacy vendor_id column remains only so
-- older migrations stay valid; new code never writes it.
UPDATE outside_work_documents
SET vendor_id=NULL
WHERE outside_vendor_id IS NOT NULL;

-- Rebuild correction memory so its vendor IDs belong to the Outside Work
-- vendor master rather than the inventory supplier master. If duplicate legacy
-- vendor rows collapse onto one Outside Work vendor, merge identical correction
-- rules and add their confirmation counts instead of creating an index conflict.
DROP TABLE IF EXISTS outside_work_correction_memory_new;
CREATE TABLE outside_work_correction_memory_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  detected_value TEXT NOT NULL,
  detected_key TEXT NOT NULL,
  corrected_value TEXT NOT NULL,
  corrected_key TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  FOREIGN KEY (vendor_id) REFERENCES outside_work_vendors(id)
);

INSERT INTO outside_work_correction_memory_new (
  vendor_id,field_name,detected_value,detected_key,corrected_value,corrected_key,
  confirmations,first_seen_at,last_seen_at,last_used_at
)
SELECT ov.id,cm.field_name,MIN(cm.detected_value),cm.detected_key,
       MIN(cm.corrected_value),cm.corrected_key,SUM(cm.confirmations),
       MIN(cm.first_seen_at),MAX(cm.last_seen_at),MAX(cm.last_used_at)
FROM outside_work_correction_memory cm
JOIN vendors v ON v.id=cm.vendor_id
JOIN outside_work_vendors ov
  ON UPPER(TRIM(ov.name))=UPPER(TRIM(v.name))
GROUP BY ov.id,cm.field_name,cm.detected_key,cm.corrected_key;

DROP TABLE outside_work_correction_memory;
ALTER TABLE outside_work_correction_memory_new RENAME TO outside_work_correction_memory;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outside_work_correction_unique
ON outside_work_correction_memory(vendor_id,field_name,detected_key,corrected_key);

CREATE INDEX IF NOT EXISTS idx_outside_work_correction_lookup
ON outside_work_correction_memory(field_name,detected_key,vendor_id,confirmations);

-- Road-repair vendors that were created by Outside Work should no longer appear
-- in Inventory unless they were actually linked to an inventory part.
UPDATE vendors
SET active=0
WHERE COALESCE(supplier_type,'')='Outside Work / Road Repair'
  AND NOT EXISTS (SELECT 1 FROM parts p WHERE p.preferred_vendor_id=vendors.id)
  AND NOT EXISTS (SELECT 1 FROM part_vendors pv WHERE pv.vendor_id=vendors.id);
