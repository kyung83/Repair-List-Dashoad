PRAGMA foreign_keys = ON;

-- Final atomic application of the corrected 2026-08-18 PM sheet import.
-- Approved rules: replace the batch; skip no-PM placeholder units entirely;
-- every included note becomes a Future Repair for the next PM without interpretation.

-- Preflight guards: all source rows must be staged and every unit must resolve to one active equipment row.
CREATE TABLE _pm_import_validation_0075 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _pm_import_validation_0075 SELECT CASE WHEN COUNT(*) = 509 THEN 1 ELSE 0 END FROM pm_import_stage_20260818;
INSERT INTO _pm_import_validation_0075 SELECT CASE WHEN COUNT(*) = 263 THEN 1 ELSE 0 END FROM pm_import_stage_20260818 WHERE pm_type='40';
INSERT INTO _pm_import_validation_0075 SELECT CASE WHEN COUNT(*) = 163 THEN 1 ELSE 0 END FROM pm_import_stage_20260818 WHERE pm_type='20A';
INSERT INTO _pm_import_validation_0075 SELECT CASE WHEN COUNT(*) = 83 THEN 1 ELSE 0 END FROM pm_import_stage_20260818 WHERE pm_type='20B';
INSERT INTO _pm_import_validation_0075 SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END FROM pm_import_note_stage_20260818;
INSERT INTO _pm_import_validation_0075
SELECT CASE WHEN COUNT(*) = 509 THEN 1 ELSE 0 END
FROM pm_import_stage_20260818 s JOIN equipment e ON e.unit=s.unit AND e.active=1;
INSERT INTO _pm_import_validation_0075
SELECT CASE WHEN COUNT(*) = 54 THEN 1 ELSE 0 END
FROM pm_import_note_stage_20260818 s JOIN equipment e ON e.unit=s.unit AND e.active=1;

-- Replace any earlier manual run of this batch.
DELETE FROM maintenance_events WHERE source='pm-sheet-2026-08-18';
UPDATE repairs
SET status='Completed - Replaced Import', completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
WHERE source='pm-sheet-2026-08-18' AND lower(COALESCE(status,'')) NOT LIKE '%complete%';

-- Remove only the flat baseline import. Checklist/work-order history remains.
DELETE FROM maintenance_events WHERE source='baseline';

INSERT INTO maintenance_events (equipment_id,event_type,pm_type,event_date,mileage,source)
SELECT e.id,'pm',s.pm_type,s.event_date,s.mileage,'pm-sheet-2026-08-18'
FROM pm_import_stage_20260818 s JOIN equipment e ON e.unit=s.unit AND e.active=1;

-- Notes become true Future Repairs, not ordinary open repairs.
INSERT INTO repairs (equipment_id,title,description,status,priority,source,technician_id,opened_at,updated_at)
SELECT e.id,s.note,s.note,'Deferred to Next PM','2','pm-sheet-2026-08-18-future',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM pm_import_note_stage_20260818 s JOIN equipment e ON e.unit=s.unit AND e.active=1;

INSERT INTO pm_next_repairs (
  equipment_id,description,status,origin_repair_id,queued_from_repair_id,target_repair_id,
  tagged_by_user_id,tagged_by_technician_id,tagged_at,updated_at,repair_id,target_event_type
)
SELECT e.id,s.note,'pending',NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
       (SELECT r.id FROM repairs r
        WHERE r.equipment_id=e.id AND r.source='pm-sheet-2026-08-18-future' AND r.title=s.note
        ORDER BY r.id DESC LIMIT 1),
       'pm'
FROM pm_import_note_stage_20260818 s JOIN equipment e ON e.unit=s.unit AND e.active=1;

-- pm_status.pm_type is the NEXT PM due. Derive it from each unit's latest imported completion
-- and configured profile sequence. Fall back to the standard 40 -> 20A -> 20B -> 40 rotation.
WITH ranked AS (
  SELECT me.equipment_id,me.pm_type,me.event_date,me.mileage,
         ROW_NUMBER() OVER(PARTITION BY me.equipment_id ORDER BY me.event_date DESC,me.id DESC) rn
  FROM maintenance_events me WHERE me.source='pm-sheet-2026-08-18' AND me.event_type='pm'
), latest AS (
  SELECT equipment_id,pm_type,event_date,mileage FROM ranked WHERE rn=1
), resolved AS (
  SELECT l.equipment_id,l.event_date,l.mileage,
    CASE
      WHEN p.sequence_json IS NULL OR json_array_length(p.sequence_json)=0 THEN
        CASE l.pm_type WHEN '40' THEN '20A' WHEN '20A' THEN '20B' WHEN '20B' THEN '40' ELSE l.pm_type END
      WHEN NOT EXISTS (SELECT 1 FROM json_each(p.sequence_json) j WHERE CAST(j.value AS TEXT)=l.pm_type) THEN
        CAST(json_extract(p.sequence_json,'$[0]') AS TEXT)
      ELSE CAST(json_extract(p.sequence_json,'$[' || (((SELECT CAST(j.key AS INTEGER) FROM json_each(p.sequence_json) j WHERE CAST(j.value AS TEXT)=l.pm_type LIMIT 1)+1)%json_array_length(p.sequence_json)) || ']') AS TEXT)
    END next_pm_type
  FROM latest l
  LEFT JOIN equipment_pm_settings eps ON eps.equipment_id=l.equipment_id
  LEFT JOIN pm_profiles p ON p.id=eps.profile_id
)
INSERT INTO pm_status (equipment_id,pm_type,status,last_mileage,service_date,updated_at)
SELECT equipment_id,next_pm_type,'Current',mileage,event_date,CURRENT_TIMESTAMP FROM resolved WHERE 1=1
ON CONFLICT(equipment_id) DO UPDATE SET
  pm_type=excluded.pm_type,status='Current',last_mileage=excluded.last_mileage,
  service_date=excluded.service_date,updated_at=CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT me.equipment_id,me.event_date,
         ROW_NUMBER() OVER(PARTITION BY me.equipment_id ORDER BY me.event_date DESC,me.id DESC) rn
  FROM maintenance_events me WHERE me.source='pm-sheet-2026-08-18' AND me.event_type='pm'
)
UPDATE equipment
SET service_date=(SELECT r.event_date FROM ranked r WHERE r.equipment_id=equipment.id AND r.rn=1),
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT equipment_id FROM ranked WHERE rn=1);

-- Post-apply guards. Any mismatch aborts and rolls this entire final migration back.
INSERT INTO _pm_import_validation_0075 SELECT CASE WHEN COUNT(*)=509 THEN 1 ELSE 0 END FROM maintenance_events WHERE source='pm-sheet-2026-08-18';
INSERT INTO _pm_import_validation_0075 SELECT CASE WHEN COUNT(*)=54 THEN 1 ELSE 0 END FROM repairs WHERE source='pm-sheet-2026-08-18-future';
INSERT INTO _pm_import_validation_0075
SELECT CASE WHEN COUNT(*)=54 THEN 1 ELSE 0 END
FROM pm_next_repairs n JOIN repairs r ON r.id=n.repair_id WHERE r.source='pm-sheet-2026-08-18-future';

DROP TABLE _pm_import_validation_0075;
DROP TABLE pm_import_note_stage_20260818;
DROP TABLE pm_import_stage_20260818;
