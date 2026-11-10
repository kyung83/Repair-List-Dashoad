PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shop_duty_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly','monthly','shift')),
  assignment_mode TEXT NOT NULL CHECK (assignment_mode IN ('all_mechanics_rotation','selected_rotation','fixed','shift_rotation')),
  due_day INTEGER,
  shift_id INTEGER,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  source_label TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shift_id) REFERENCES maintenance_shifts(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shop_duty_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  section_name TEXT NOT NULL DEFAULT '',
  item_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES shop_duty_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shop_duty_template_items
ON shop_duty_template_items(template_id,active,sort_order,id);

CREATE TABLE IF NOT EXISTS shop_duty_template_users (
  template_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  rotation_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (template_id,user_id),
  FOREIGN KEY (template_id) REFERENCES shop_duty_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shop_duty_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL,
  period_key TEXT NOT NULL,
  due_date TEXT NOT NULL,
  assigned_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  repair_id INTEGER,
  supplies_needed TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (template_id,period_key),
  FOREIGN KEY (template_id) REFERENCES shop_duty_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_user_id) REFERENCES app_users(id),
  FOREIGN KEY (repair_id) REFERENCES repairs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_duty_assignments_user
ON shop_duty_assignments(assigned_user_id,status,due_date);

CREATE TABLE IF NOT EXISTS shop_duty_item_results (
  assignment_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('done','attention','na')),
  comment TEXT NOT NULL DEFAULT '',
  updated_by_user_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assignment_id,item_id),
  FOREIGN KEY (assignment_id) REFERENCES shop_duty_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES shop_duty_template_items(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO shop_duty_templates
  (template_key,name,description,cadence,assignment_mode,due_day,active,source_label)
VALUES
  ('bathroom-weekly','Bathroom Cleaning & Check','Weekly restroom and wash-area cleaning/check. Rotates through all active mechanics.','weekly','all_mechanics_rotation',5,1,'Google Sheet: Bathroom check'),
  ('monthly-facility','Monthly Facility Check','Monthly building, dock, fuel-station, shop and office checks. Assign only to selected mechanics before activating.','monthly','selected_rotation',28,0,'Google Sheet: Once A Month To Do List'),
  ('shift-shop-inspection','Shift Change Shop Inspection','Bay-by-bay shop inspection. Configure the maintenance shift before activating.','shift','shift_rotation',NULL,0,'Google Sheet: Shop check sheet');

WITH duty_items(section_name,item_text,sort_order) AS (
  VALUES
    ('RESTROOM & WASH AREA','Toilet inside/outside cleaned with brush and cleaner',1),
    ('RESTROOM & WASH AREA','Toilet lid top and bottom cleaned with cleaner',2),
    ('RESTROOM & WASH AREA','Inside sink is cleaned and wiped off with cleaner',3),
    ('RESTROOM & WASH AREA','Mirrors and walls cleaned and wiped down with cleaner',4),
    ('RESTROOM & WASH AREA','Doors, handles, wall switches, and other high-contact areas cleaned and wiped dry',5),
    ('RESTROOM & WASH AREA','Toilet paper stocked; change if low or out',6),
    ('RESTROOM & WASH AREA','Check lights are in good working order; change bulbs as needed',7),
    ('RESTROOM & WASH AREA','Exhaust fan clean and working; wipe down if needed',8),
    ('RESTROOM & WASH AREA','Interior free of paper/trash/shop rags; floor swept and debris put in trash',9),
    ('RESTROOM & WASH AREA','Hand dryer wiped down and disinfected',10),
    ('RESTROOM & WASH AREA','Soap dispenser wiped down and restocked if needed',11),
    ('RESTROOM & WASH AREA','Sink interior and exterior cleaned with cleaner',12),
    ('RESTROOM & WASH AREA','Exterior bathroom walls cleaned with cleaner',13),
    ('RESTROOM & WASH AREA','Inventory cleaning supplies and list anything low or out',14),
    ('RESTROOM & WASH AREA','Final look-over confirms restroom area meets management standards',15)
)
INSERT INTO shop_duty_template_items(template_id,section_name,item_text,sort_order)
SELECT t.id,d.section_name,d.item_text,d.sort_order
FROM shop_duty_templates t
CROSS JOIN duty_items d
WHERE t.template_key='bathroom-weekly'
  AND NOT EXISTS (SELECT 1 FROM shop_duty_template_items i WHERE i.template_id=t.id);

WITH duty_items(section_name,item_text,sort_order) AS (
  VALUES
    ('LIGHTS','4900 perimeter lights',1),
    ('LIGHTS','4900 outside building lights',2),
    ('LIGHTS','4900 inside shop lights',3),
    ('LIGHTS','4900 inside dock lights',4),
    ('LIGHTS','4900 inside office area lights',5),
    ('LIGHTS','4915-4859 outside and perimeter lights',6),
    ('LIGHTS','4915 inside office lights',7),
    ('LIGHTS','4915 inside dock area lights',8),
    ('FILTERS','4900 office furnace filters',9),
    ('FILTERS','4915 office furnace filters',10),
    ('FILTERS','4900 shop air compressor air filter',11),
    ('FILTERS','4900 septic filter',12),
    ('DOCKS','4900 dock plate inspection and lube; adjust if needed',13),
    ('DOCKS','4900 dock door/cable inspection and track/roller lube',14),
    ('DOCKS','4900 dock ramp inspection',15),
    ('DOCKS','4915 dock plate inspection and lube; adjust if needed',16),
    ('DOCKS','4915 dock door/cable inspection and track/roller lube',17),
    ('BATHROOM','4900 drivers restroom toilet seats/bowls, sinks, doors and shower',18),
    ('BATHROOM','4900 office restroom toilet seats/bowls, sinks, doors and shower',19),
    ('BATHROOM','4915 Northern back-office toilet and sink area',20),
    ('FUEL STATION & SCALE','Check washer-fluid bucket; empty and refill with new fluid',21),
    ('FUEL STATION & SCALE','Inspect and replace squeegees as needed',22),
    ('FUEL STATION & SCALE','Inspect filling area for concerns',23),
    ('FUEL STATION & SCALE','Inspect scale house for paper, function, damage, etc.',24),
    ('SHOP / OFFICE','Jacks: inspect complete function and check oils',25),
    ('SHOP / OFFICE','Clean drains',26),
    ('SHOP / OFFICE','Wash out A/C units',27)
)
INSERT INTO shop_duty_template_items(template_id,section_name,item_text,sort_order)
SELECT t.id,d.section_name,d.item_text,d.sort_order
FROM shop_duty_templates t
CROSS JOIN duty_items d
WHERE t.template_key='monthly-facility'
  AND NOT EXISTS (SELECT 1 FROM shop_duty_template_items i WHERE i.template_id=t.id);

WITH duty_items(section_name,item_text,sort_order) AS (
  VALUES
    ('BAY 1/2','Battery chargers',1),
    ('BAY 1/2','Computer area clean; shelves organized',2),
    ('BAY 1/2','Tire balancer station clean of clutter',3),
    ('BAY 1/2','Tire tools in place; torque wrench in case',4),
    ('BAY 1/2','Tool cabinets full; checksheet verified',5),
    ('BAY 1/2','Gas cylinders chained and tagged',6),
    ('BAY 1/2','Floor clean; no spills, open/unmarked jugs, dirt, grease, trash or floor dry',7),
    ('BAY 1/2','Batteries stacked; both dollies in place',8),
    ('BAY 1/2','Parts/tools picked up; door chains hooked',9),
    ('BAY 1/2','Wheel chocks, fans/heaters, creepers and rags in place',10),
    ('BAY 3/4','Parts/tools picked up; door chains hooked',11),
    ('BAY 3/4','Trash cans in place and not overflowing',12),
    ('BAY 3/4','Supply shelf organized; safety supplies stocked',13),
    ('BAY 3/4','Tarps, hoses, cables and door seals organized',14),
    ('BAY 3/4','Shop and technician tools picked up',15),
    ('BAY 3/4','Ladders, brooms, scrapers and extension cords in place',16),
    ('BAY 3/4','Bench clean; nothing left on it',17),
    ('BAY 3/4','Floor clean; no spills, open/unmarked jugs, dirt, grease, trash or floor dry',18),
    ('BAY 3/4','Laptops plugged in; attachments organized; no clutter',19),
    ('BAY 3/4','Torches in place',20),
    ('BAY 3/4','Jacks and attachments in place',21),
    ('BAY 3/4','Wheel chocks, fans/heaters, creepers and rags in place',22),
    ('BAY 5/6','Parts/tools picked up; door chains hooked',23),
    ('BAY 5/6','Ladders, brooms, scrapers and extension cords in place',24),
    ('BAY 5/6','Welders/A-C machines in place and undamaged',25),
    ('BAY 5/6','Bench clean; nothing left on it',26),
    ('BAY 5/6','Trash cans in place and not overflowing',27),
    ('BAY 5/6','Floor cleaned; no dirt, grease, garbage, spills or open/unmarked jugs',28),
    ('BAY 5/6','Jacks and attachments in place',29),
    ('BAY 5/6','PIC table clear; break area clean',30),
    ('BAY 5/6','Wheel chocks, fans/heaters, creepers and rags in place',31),
    ('BAY 5/6','Steel rack stacked; no safety issues',32),
    ('BAY 7','Floor cleaned; no dirt, grease, trash, floor dry, spills or open/unmarked jugs',33),
    ('BAY 7','Oil pan empty; no filters/seals/etc. on top',34),
    ('BAY 7','Filters discarded; notify if bin full',35),
    ('BAY 7','Tools in place; wrenches hanging, etc.',36),
    ('BAY 7','Ladders, brooms, scrapers and extension cords in place',37),
    ('BAY 7','Wheel chocks, fans/heaters, creepers and rags in place',38),
    ('BAY 7','Parts washer free of debris',39),
    ('BAY 7','Bathroom area clear; hangers off floor, etc.',40),
    ('BAY 7','Switcher doors and windows closed',41)
)
INSERT INTO shop_duty_template_items(template_id,section_name,item_text,sort_order)
SELECT t.id,d.section_name,d.item_text,d.sort_order
FROM shop_duty_templates t
CROSS JOIN duty_items d
WHERE t.template_key='shift-shop-inspection'
  AND NOT EXISTS (SELECT 1 FROM shop_duty_template_items i WHERE i.template_id=t.id);
