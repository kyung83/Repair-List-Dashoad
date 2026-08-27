PRAGMA foreign_keys = ON;

-- Drivers report a breakdown against ONE unit -- the truck or the trailer,
-- never both at once. The separate trailer_equipment_id column from 0096
-- is no longer needed: roadside_breakdowns.equipment_id now points at
-- whichever unit broke down, and its type (truck/trailer) is read straight
-- from equipment.equipment_type via JOIN, never duplicated here.
ALTER TABLE roadside_breakdowns DROP COLUMN trailer_equipment_id;
