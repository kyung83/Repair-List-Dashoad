PRAGMA foreign_keys = ON;

-- Required-photo enforcement is handled atomically in the Worker. Keeping this
-- migration trigger-free avoids leaving the currently deployed Worker with a D1
-- trigger that can reject a row delete after the R2 object has already been removed.
