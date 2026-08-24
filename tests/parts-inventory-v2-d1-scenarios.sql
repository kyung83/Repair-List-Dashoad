PRAGMA foreign_keys = ON;

CREATE TABLE test_assertions (
  label TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed = 1)
);

INSERT INTO app_users (id,username) VALUES (1,'manager');
INSERT INTO warehouses (id,code,name,active) VALUES (1,'CLARE','Clare',1),(2,'BOYNE','Boyne',1);
INSERT INTO equipment (id,unit,out_of_service) VALUES (1,'100',1),(2,'200',0),(3,'300',0);
INSERT INTO repairs (id,equipment_id,status,priority) VALUES
  (1,1,'Open','2'),
  (2,2,'Open','1'),
  (3,3,'Open','2');
INSERT INTO parts (id,part_number,description,active,quantity_on_hand,reorder_level,unit_cost) VALUES
  (1,'BAT-AGM','AGM Battery',1,10,2,125),
  (2,'BAT-CORE','Battery Core',1,0,0,0),
  (3,'FILTER','Filter',1,5,1,20),
  (4,'TIRE','11R22.5 Tire',1,8,2,300);
INSERT INTO part_warehouse_stock (id,part_id,warehouse_id,quantity_on_hand,unit_cost) VALUES
  (1,1,1,10,125),
  (2,3,1,5,20),
  (3,4,1,8,300);
INSERT INTO repair_tire_positions (repair_id,position_code,recorded_by_user_id) VALUES
  (1,'A2LO',1),
  (3,'A3RI',1);

-- 0093 vendor compatibility migration must normalize existing vendor rows.
INSERT INTO test_assertions
SELECT 'vendor normalization migrated', CASE WHEN normalized_name='acme co' THEN 1 ELSE 0 END
FROM vendors WHERE id=1;

-- Configure one core per issued AGM battery.
UPDATE parts SET core_return_part_id=2,core_return_quantity=1 WHERE id=1;

-- Simulate a successful part issue at the operation/ledger boundary.
INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note)
VALUES ('d1-core-open','apply_part',1,1,'D1 integration issue');
INSERT INTO inventory_operation_lines
  (operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,unit_cost,line_type)
SELECT id,1,1,1,-2,125,'part_issue' FROM inventory_operations WHERE operation_key='d1-core-open';

INSERT INTO test_assertions
SELECT 'core obligation opens once', CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END
FROM part_core_obligations WHERE source_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-core-open');
INSERT INTO test_assertions
SELECT 'core obligation quantity follows issued quantity', CASE WHEN quantity=2 AND status='open' THEN 1 ELSE 0 END
FROM part_core_obligations WHERE source_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-core-open');

-- Undoing an untouched issue removes its open core obligation in the same D1 statement.
UPDATE inventory_operations SET status='undone',undone_at=CURRENT_TIMESTAMP
WHERE operation_key='d1-core-open';
INSERT INTO test_assertions
SELECT 'undo removes untouched open core', CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END
FROM part_core_obligations WHERE source_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-core-open');

-- A second issue is closed through a core-disposition operation and dependency edge.
INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note)
VALUES ('d1-core-closed-source','apply_part',1,1,'Second issue');
INSERT INTO inventory_operation_lines
  (operation_id,part_id,warehouse_stock_id,warehouse_id,quantity_delta,unit_cost,line_type)
SELECT id,1,1,1,-1,125,'part_issue' FROM inventory_operations WHERE operation_key='d1-core-closed-source';
INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note)
VALUES ('d1-core-return','core_returned',1,1,'Core physically returned');
UPDATE part_core_obligations
SET status='returned',closed_at=CURRENT_TIMESTAMP,closed_by_user_id=1
WHERE source_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-core-closed-source');
INSERT INTO inventory_operation_dependencies (operation_id,depends_on_operation_id,reason)
SELECT disposition.id,source.id,'Core obligation disposition depends on the original issued part.'
FROM inventory_operations disposition,inventory_operations source
WHERE disposition.operation_key='d1-core-return' AND source.operation_key='d1-core-closed-source';
INSERT INTO inventory_operation_commits (operation_id,applied)
SELECT id,1 FROM inventory_operations WHERE operation_key='d1-core-return';
INSERT INTO test_assertions
SELECT 'closed core is dependency linked', CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END
FROM inventory_operation_dependencies
WHERE operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-core-return')
  AND depends_on_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-core-closed-source');

-- Recovered tire is segregated from normal stock and traced to a recorded source position.
INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note)
VALUES ('d1-tire-recover','recover_used_tire',1,1,'Usable take-off');
INSERT INTO recovered_used_tires
  (source_operation_id,repair_id,part_id,warehouse_id,position_code,condition_note,status)
SELECT id,1,4,1,'A2LO','8/32 tread','available'
FROM inventory_operations WHERE operation_key='d1-tire-recover';
INSERT INTO inventory_operation_commits (operation_id,applied)
SELECT id,1 FROM inventory_operations WHERE operation_key='d1-tire-recover';
INSERT INTO test_assertions
SELECT 'recovered tire available outside saleable stock', CASE WHEN
  (SELECT COUNT(*) FROM recovered_used_tires WHERE status='available')=1
  AND (SELECT quantity_on_hand FROM part_warehouse_stock WHERE id=3)=8
THEN 1 ELSE 0 END;

-- Reuse records a destination repair/position and still does not touch new tire stock.
INSERT INTO inventory_operations (operation_key,operation_type,repair_id,user_id,note)
VALUES ('d1-tire-reuse','used_tire_reused',3,1,'Reuse take-off');
UPDATE recovered_used_tires
SET status='reused',disposition_at=CURRENT_TIMESTAMP,
    disposition_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-tire-reuse'),
    disposition_repair_id=3,disposition_position_code='A3RI'
WHERE source_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-tire-recover') AND status='available';
INSERT INTO inventory_operation_dependencies (operation_id,depends_on_operation_id,reason)
SELECT reuse.id,recovery.id,'Recovered tire disposition depends on the recovery operation.'
FROM inventory_operations reuse,inventory_operations recovery
WHERE reuse.operation_key='d1-tire-reuse' AND recovery.operation_key='d1-tire-recover';
INSERT INTO inventory_operation_commits (operation_id,applied)
SELECT id,1 FROM inventory_operations WHERE operation_key='d1-tire-reuse';
INSERT INTO test_assertions
SELECT 'reused tire trace preserved', CASE WHEN
  status='reused' AND disposition_repair_id=3 AND disposition_position_code='A3RI'
THEN 1 ELSE 0 END
FROM recovered_used_tires WHERE source_operation_id=(SELECT id FROM inventory_operations WHERE operation_key='d1-tire-recover');
INSERT INTO test_assertions
SELECT 'reused tire does not decrement new tire stock', CASE WHEN quantity_on_hand=8 THEN 1 ELSE 0 END
FROM part_warehouse_stock WHERE id=3;

-- Derived reservations allocate physical stock by out-of-service, priority, then age.
INSERT INTO repair_part_requests (repair_id,part_id,warehouse_id,requested_quantity,used_quantity,status,created_at) VALUES
  (1,3,1,4,0,'open','2026-08-24 08:00:00'),
  (2,3,1,4,0,'open','2026-08-24 07:00:00');
INSERT INTO test_assertions
SELECT 'out of service reservation wins first', CASE WHEN reserved_quantity=4 THEN 1 ELSE 0 END
FROM derived_repair_part_reservations WHERE repair_id=1 AND part_id=3;
INSERT INTO test_assertions
SELECT 'lower queue receives remaining physical stock', CASE WHEN reserved_quantity=1 THEN 1 ELSE 0 END
FROM derived_repair_part_reservations WHERE repair_id=2 AND part_id=3;

UPDATE repairs SET status='Complete' WHERE id=1;
INSERT INTO test_assertions
SELECT 'completed repair releases reservation', CASE WHEN
  (SELECT COUNT(*) FROM derived_repair_part_reservations WHERE repair_id=1 AND part_id=3)=0
  AND (SELECT reserved_quantity FROM derived_repair_part_reservations WHERE repair_id=2 AND part_id=3)=4
THEN 1 ELSE 0 END;

-- Final count lets the shell harness verify every D1 assertion executed.
SELECT COUNT(*) AS passed_assertions FROM test_assertions;
