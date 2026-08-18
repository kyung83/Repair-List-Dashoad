PRAGMA foreign_keys = ON;

-- Staging only. Live PM/repair data is not changed until 0075 applies after all counts validate.
CREATE TABLE IF NOT EXISTS pm_import_stage_20260818 (
  unit TEXT NOT NULL,
  pm_type TEXT NOT NULL CHECK (pm_type IN ('40','20A','20B')),
  event_date TEXT NOT NULL,
  mileage INTEGER NOT NULL,
  PRIMARY KEY (unit, pm_type, event_date)
);

CREATE TABLE IF NOT EXISTS pm_import_note_stage_20260818 (
  unit TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (unit, note)
);
