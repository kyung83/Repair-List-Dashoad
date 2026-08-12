ALTER TABLE equipment
ADD COLUMN trailer_type TEXT
CHECK (
  trailer_type IS NULL
  OR trailer_type IN ('Flat Bed', 'Step Deck', 'Conestoga', 'Dry Van')
);

CREATE INDEX IF NOT EXISTS idx_equipment_trailer_type
ON equipment(equipment_type, trailer_type)
WHERE equipment_type = 'trailer';
