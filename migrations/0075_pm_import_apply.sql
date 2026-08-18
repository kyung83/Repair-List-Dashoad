PRAGMA foreign_keys = ON;

-- Diagnostic checkpoint only. The prior 0075 attempt intentionally failed its
-- strict exact-unit preflight, so no live PM/repair replacement was committed.
-- Preserve the staged source and resolve each staged label to one current,
-- in-use equipment row without guessing. A later migration applies the import.

CREATE TABLE IF NOT EXISTS pm_import_unit_resolution_20260818 (
  staged_unit TEXT PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id),
  match_kind TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pm_import_diagnostics_20260818 (
  metric TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

DELETE FROM pm_import_unit_resolution_20260818;
DELETE FROM pm_import_diagnostics_20260818;

WITH units AS (
  SELECT DISTINCT unit FROM pm_import_stage_20260818
  UNION
  SELECT DISTINCT unit FROM pm_import_note_stage_20260818
),
candidates AS (
  SELECT
    u.unit AS staged_unit,
    e.id AS equipment_id,
    CASE
      WHEN lower(trim(e.unit)) = lower(trim(u.unit)) THEN 1
      WHEN lower(replace(replace(replace(replace(trim(e.unit),' ',''),'-',''),'(',''),')',''))
         = lower(replace(replace(replace(replace(trim(u.unit),' ',''),'-',''),'(',''),')','')) THEN 2
      WHEN lower(replace(replace(trim(CASE WHEN instr(e.unit,'(')>0 THEN substr(e.unit,1,instr(e.unit,'(')-1) ELSE e.unit END),' ',''),'-',''))
         = lower(replace(replace(trim(CASE WHEN instr(u.unit,'(')>0 THEN substr(u.unit,1,instr(u.unit,'(')-1) ELSE u.unit END),' ',''),'-','')) THEN 3
      ELSE 99
    END AS score
  FROM units u
  JOIN equipment e
    ON e.active = 1
   AND e.archived_at IS NULL
   AND (
     lower(trim(e.unit)) = lower(trim(u.unit))
     OR lower(replace(replace(replace(replace(trim(e.unit),' ',''),'-',''),'(',''),')',''))
        = lower(replace(replace(replace(replace(trim(u.unit),' ',''),'-',''),'(',''),')',''))
     OR lower(replace(replace(trim(CASE WHEN instr(e.unit,'(')>0 THEN substr(e.unit,1,instr(e.unit,'(')-1) ELSE e.unit END),' ',''),'-',''))
        = lower(replace(replace(trim(CASE WHEN instr(u.unit,'(')>0 THEN substr(u.unit,1,instr(u.unit,'(')-1) ELSE u.unit END),' ',''),'-',''))
   )
),
best AS (
  SELECT staged_unit, MIN(score) AS best_score
  FROM candidates
  GROUP BY staged_unit
),
resolved AS (
  SELECT
    u.unit AS staged_unit,
    CASE WHEN COUNT(c.equipment_id)=1 THEN MAX(c.equipment_id) ELSE NULL END AS equipment_id,
    CASE
      WHEN b.best_score IS NULL THEN 'unmatched'
      WHEN COUNT(c.equipment_id)<>1 THEN 'ambiguous'
      WHEN b.best_score=1 THEN 'exact'
      WHEN b.best_score=2 THEN 'normalized'
      WHEN b.best_score=3 THEN 'base-unit'
      ELSE 'unmatched'
    END AS match_kind,
    COUNT(c.equipment_id) AS candidate_count
  FROM units u
  LEFT JOIN best b ON b.staged_unit=u.unit
  LEFT JOIN candidates c ON c.staged_unit=u.unit AND c.score=b.best_score
  GROUP BY u.unit,b.best_score
)
INSERT INTO pm_import_unit_resolution_20260818 (staged_unit,equipment_id,match_kind,candidate_count)
SELECT staged_unit,equipment_id,match_kind,candidate_count
FROM resolved;

INSERT INTO pm_import_diagnostics_20260818 VALUES
  ('staged_pm_rows',(SELECT COUNT(*) FROM pm_import_stage_20260818)),
  ('staged_40',(SELECT COUNT(*) FROM pm_import_stage_20260818 WHERE pm_type='40')),
  ('staged_20a',(SELECT COUNT(*) FROM pm_import_stage_20260818 WHERE pm_type='20A')),
  ('staged_20b',(SELECT COUNT(*) FROM pm_import_stage_20260818 WHERE pm_type='20B')),
  ('staged_notes',(SELECT COUNT(*) FROM pm_import_note_stage_20260818)),
  ('distinct_units',(SELECT COUNT(*) FROM pm_import_unit_resolution_20260818)),
  ('resolved_units',(SELECT COUNT(*) FROM pm_import_unit_resolution_20260818 WHERE equipment_id IS NOT NULL)),
  ('unmatched_units',(SELECT COUNT(*) FROM pm_import_unit_resolution_20260818 WHERE match_kind='unmatched')),
  ('ambiguous_units',(SELECT COUNT(*) FROM pm_import_unit_resolution_20260818 WHERE match_kind='ambiguous')),
  ('exact_matches',(SELECT COUNT(*) FROM pm_import_unit_resolution_20260818 WHERE match_kind='exact')),
  ('normalized_matches',(SELECT COUNT(*) FROM pm_import_unit_resolution_20260818 WHERE match_kind='normalized')),
  ('base_unit_matches',(SELECT COUNT(*) FROM pm_import_unit_resolution_20260818 WHERE match_kind='base-unit'));
