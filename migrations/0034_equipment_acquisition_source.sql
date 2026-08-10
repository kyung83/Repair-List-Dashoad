PRAGMA foreign_keys = ON;

-- Purchase price and purchase date already live on equipment and feed reporting.
-- Keep the seller/source with the same equipment acquisition record.
ALTER TABLE equipment ADD COLUMN purchased_from TEXT;
