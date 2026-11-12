PRAGMA foreign_keys = ON;

-- Indirect labor menu configuration. Activity text on existing repairs is intentionally
-- immutable, so renaming/disabling a category cannot rewrite history or productivity.
CREATE TABLE IF NOT EXISTS indirect_labor_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO indirect_labor_categories(name,active,sort_order) VALUES
('Shop cleanup',1,10),
('Parts run',1,20),
('Training',1,30),
('Inventory',1,40),
('Meeting',1,50),
('Other',1,60);
CREATE INDEX IF NOT EXISTS idx_indirect_labor_categories_display
ON indirect_labor_categories(active,sort_order,name);
