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

INSERT INTO shop_duty_template_items(template_id,section_name,item_text,sort_order)
SELECT t.id,'RESTROOM & WASH AREA',v.item_text,v.sort_order
FROM shop_duty_templates t
JOIN (
  SELECT 'Toilet inside/outside cleaned with brush and cleaner' item_text,1 sort_order UNION ALL
  SELECT 'Toilet lid top and bottom cleaned with cleaner',2 UNION ALL
  SELECT 'Inside sink is cleaned and wiped off with cleaner',3 UNION ALL
  SELECT 'Mirrors and walls cleaned and wiped down with cleaner',4 UNION ALL
  SELECT 'Doors, handles, wall switches, and other high-contact areas cleaned and wiped dry',5 UNION ALL
  SELECT 'Toilet paper stocked; change if low or out',6 UNION ALL
  SELECT 'Check lights are in good working order; change bulbs as needed',7 UNION ALL
  SELECT 'Exhaust fan clean and working; wipe down if needed',8 UNION ALL
  SELECT 'Interior free of paper/trash/shop rags; floor swept and debris put in trash',9 UNION ALL
  SELECT 'Hand dryer wiped down and disinfected',10 UNION ALL
  SELECT 'Soap dispenser wiped down and restocked if needed',11 UNION ALL
  SELECT 'Sink interior and exterior cleaned with cleaner',12 UNION ALL
  SELECT 'Exterior bathroom walls cleaned with cleaner',13 UNION ALL
  SELECT 'Inventory cleaning supplies and list anything low or out',14 UNION ALL
  SELECT 'Final look-over confirms restroom area meets management standards',15
) v
WHERE t.template_key='bathroom-weekly'
  AND NOT EXISTS (SELECT 1 FROM shop_duty_template_items i WHERE i.template_id=t.id);

INSERT INTO shop_duty_template_items(template_id,section_name,item_text,sort_order)
SELECT t.id,v.section_name,v.item_text,v.sort_order
FROM shop_duty_templates t
JOIN (
  SELECT 'LIGHTS' section_name,'4900 perimeter lights' item_text,1 sort_order UNION ALL
  SELECT 'LIGHTS','4900 outside building lights',2 UNION ALL
  SELECT 'LIGHTS','4900 inside shop lights',3 UNION ALL
  SELECT 'LIGHTS','4900 inside dock lights',4 UNION ALL
  SELECT 'LIGHTS','4900 inside office area lights',5 UNION ALL
  SELECT 'LIGHTS','4915-4859 outside and perimeter lights',6 UNION ALL
  SELECT 'LIGHTS','4915 inside office lights',7 UNION ALL
  SELECT 'LIGHTS','4915 inside dock area lights',8 UNION ALL
  SELECT 'FILTERS','4900 office furnace filters',9 UNION ALL
  SELECT 'FILTERS','4915 office furnace filters',10 UNION ALL
  SELECT 'FILTERS','4900 shop air compressor air filter',11 UNION ALL
  SELECT 'FILTERS','4900 septic filter',12 UNION ALL
  SELECT 'DOCKS','4900 dock plate inspection and lube; adjust if needed',13 UNION ALL
  SELECT 'DOCKS','4900 dock door/cable inspection and track/roller lube',14 UNION ALL
  SELECT 'DOCKS','4900 dock ramp inspection',15 UNION ALL
  SELECT 'DOCKS','4915 dock plate inspection and lube; adjust if needed',16 UNION ALL
  SELECT 'DOCKS','4915 dock door/cable inspection and track/roller lube',17 UNION ALL
  SELECT 'BATHROOM','4900 drivers restroom toilet seats/bowls, sinks, doors and shower',18 UNION ALL
  SELECT 'BATHROOM','4900 office restroom toilet seats/bowls, sinks, doors and shower',19 UNION ALL
  SELECT 'BATHROOM','4915 Northern back-office toilet and sink area',20 UNION ALL
  SELECT 'FUEL STATION & SCALE','Check washer-fluid bucket; empty and refill with new fluid',21 UNION ALL
  SELECT 'FUEL STATION & SCALE','Inspect and replace squeegees as needed',22 UNION ALL
  SELECT 'FUEL STATION & SCALE','Inspect filling area for concerns',23 UNION ALL
  SELECT 'FUEL STATION & SCALE','Inspect scale house for paper, function, damage, etc.',24 UNION ALL
  SELECT 'SHOP / OFFICE','Jacks: inspect complete function and check oils',25 UNION ALL
  SELECT 'SHOP / OFFICE','Clean drains',26 UNION ALL
  SELECT 'SHOP / OFFICE','Wash out A/C units',27
) v
WHERE t.template_key='monthly-facility'
  AND NOT EXISTS (SELECT 1 FROM shop_duty_template_items i WHERE i.template_id=t.id);

INSERT INTO shop_duty_template_items(template_id,section_name,item_text,sort_order)
SELECT t.id,v.section_name,v.item_text,v.sort_order
FROM shop_duty_templates t
JOIN (
  SELECT 'BAY 1/2' section_name,'Battery chargers' item_text,1 sort_order UNION ALL
  SELECT 'BAY 1/2','Computer area clean; shelves organized',2 UNION ALL
  SELECT 'BAY 1/2','Tire balancer station clean of clutter',3 UNION ALL
  SELECT 'BAY 1/2','Tire tools in place; torque wrench in case',4 UNION ALL
  SELECT 'BAY 1/2','Tool cabinets full; checksheet verified',5 UNION ALL
  SELECT 'BAY 1/2','Gas cylinders chained and tagged',6 UNION ALL
  SELECT 'BAY 1/2','Floor clean; no spills, open/unmarked jugs, dirt, grease, trash or floor dry',7 UNION ALL
  SELECT 'BAY 1/2','Batteries stacked; both dollies in place',8 UNION ALL
  SELECT 'BAY 1/2','Parts/tools picked up; door chains hooked',9 UNION ALL
  SELECT 'BAY 1/2','Wheel chocks, fans/heaters, creepers and rags in place',10 UNION ALL
  SELECT 'BAY 3/4','Parts/tools picked up; door chains hooked',11 UNION ALL
  SELECT 'BAY 3/4','Trash cans in place and not overflowing',12 UNION ALL
  SELECT 'BAY 3/4','Supply shelf organized; safety supplies stocked',13 UNION ALL
  SELECT 'BAY 3/4','Tarps, hoses, cables and door seals organized',14 UNION ALL
  SELECT 'BAY 3/4','Shop and technician tools picked up',15 UNION ALL
  SELECT 'BAY 3/4','Ladders, brooms, scrapers and extension cords in place',16 UNION ALL
  SELECT 'BAY 3/4','Bench clean; nothing left on it',17 UNION ALL
  SELECT 'BAY 3/4','Floor clean; no spills, open/unmarked jugs, dirt, grease, trash or floor dry',18 UNION ALL
  SELECT 'BAY 3/4','Laptops plugged in; attachments organized; no clutter',19 UNION ALL
  SELECT 'BAY 3/4','Torches in place',20 UNION ALL
  SELECT 'BAY 3/4','Jacks and attachments in place',21 UNION ALL
  SELECT 'BAY 3/4','Wheel chocks, fans/heaters, creepers and rags in place',22 UNION ALL
  SELECT 'BAY 5/6','Parts/tools picked up; door chains hooked',23 UNION ALL
  SELECT 'BAY 5/6','Ladders, brooms, scrapers and extension cords in place',24 UNION ALL
  SELECT 'BAY 5/6','Welders/A-C machines in place and undamaged',25 UNION ALL
  SELECT 'BAY 5/6','Bench clean; nothing left on it',26 UNION ALL
  SELECT 'BAY 5/6','Trash cans in place and not overflowing',27 UNION ALL
  SELECT 'BAY 5/6','Floor cleaned; no dirt, grease, garbage, spills or open/unmarked jugs',28 UNION ALL
  SELECT 'BAY 5/6','Jacks and attachments in place',29 UNION ALL
  SELECT 'BAY 5/6','PIC table clear; break area clean',30 UNION ALL
  SELECT 'BAY 5/6','Wheel chocks, fans/heaters, creepers and rags in place',31 UNION ALL
  SELECT 'BAY 5/6','Steel rack stacked; no safety issues',32 UNION ALL
  SELECT 'BAY 7','Floor cleaned; no dirt, grease, trash, floor dry, spills or open/unmarked jugs',33 UNION ALL
  SELECT 'BAY 7','Oil pan empty; no filters/seals/etc. on top',34 UNION ALL
  SELECT 'BAY 7','Filters discarded; notify if bin full',35 UNION ALL
  SELECT 'BAY 7','Tools in place; wrenches hanging, etc.',36 UNION ALL
  SELECT 'BAY 7','Ladders, brooms, scrapers and extension cords in place',37 UNION ALL
  SELECT 'BAY 7','Wheel chocks, fans/heaters, creepers and rags in place',38 UNION ALL
  SELECT 'BAY 7','Parts washer free of debris',39 UNION ALL
  SELECT 'BAY 7','Bathroom area clear; hangers off floor, etc.',40 UNION ALL
  SELECT 'BAY 7','Switcher doors and windows closed',41
) v
WHERE t.template_key='shift-shop-inspection'
  AND NOT EXISTS (SELECT 1 FROM shop_duty_template_items i WHERE i.template_id=t.id);
