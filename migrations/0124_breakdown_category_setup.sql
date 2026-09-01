-- Configurable roadside breakdown categories/subcategories.
CREATE TABLE IF NOT EXISTS breakdown_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  requires_position INTEGER NOT NULL DEFAULT 0 CHECK (requires_position IN (0,1)),
  requires_tire_size INTEGER NOT NULL DEFAULT 0 CHECK (requires_tire_size IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS breakdown_subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES breakdown_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id, name)
);

ALTER TABLE roadside_breakdowns ADD COLUMN repair_subcategory TEXT;
ALTER TABLE roadside_breakdowns ADD COLUMN position_codes TEXT;

INSERT OR IGNORE INTO breakdown_categories(name,requires_position,requires_tire_size,active,sort_order) VALUES
  ('Brake Chambers',1,0,1,10),
  ('Air Issues',0,0,1,20),
  ('TIRES',1,1,1,30),
  ('ELECTRICAL/Lights',0,0,1,40),
  ('MECHANICAL',0,0,1,50),
  ('Tow',0,0,1,60),
  ('Other',0,0,1,70),
  ('AIR/CHAMBERS/GLADHANDS',0,0,0,999);

INSERT OR IGNORE INTO breakdown_subcategories(category_id,name,active,sort_order)
SELECT id,'Air Leak',1,10 FROM breakdown_categories WHERE name='Air Issues';
INSERT OR IGNORE INTO breakdown_subcategories(category_id,name,active,sort_order)
SELECT id,'Gladhand / Air Line',1,20 FROM breakdown_categories WHERE name='Air Issues';
