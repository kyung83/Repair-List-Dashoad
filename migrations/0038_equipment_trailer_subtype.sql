ALTER TABLE equipment
ADD COLUMN trailer_subtype TEXT
CHECK (
  trailer_subtype IS NULL
  OR trailer_subtype IN ('Step Deck')
);
