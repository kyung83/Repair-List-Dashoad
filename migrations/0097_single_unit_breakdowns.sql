PRAGMA foreign_keys = ON;

-- Drivers report a breakdown against ONE unit -- the truck or the trailer,
-- never both at once. roadside_breakdowns.equipment_id points at whichever
-- unit broke down, and the current application does not read or write the
-- legacy trailer_equipment_id column created by 0096.
--
-- Keep that unused compatibility column in D1 rather than rebuilding the
-- production table only to remove it. D1/SQLite rejects DROP COLUMN while
-- the column is still named in the table's foreign-key definition.
SELECT 1;
