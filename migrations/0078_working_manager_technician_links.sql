PRAGMA foreign_keys = ON;

-- Jeff and Jesse are managers who also perform hands-on repair work. Keep their
-- manager clearance while linking each login to the existing technician identity
-- used by repairs, labor timers, PM checklists, parts, and technician notes.
CREATE TABLE IF NOT EXISTS working_manager_feature_receipts (
  feature_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE _working_manager_link_validation_0078 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM app_users
WHERE username = 'jeffw' COLLATE NOCASE AND role = 'manager' AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM app_users
WHERE username = 'jesseg' COLLATE NOCASE AND role = 'manager' AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM technicians
WHERE lower(trim(name)) = lower('Jeff Wittig') AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM technicians
WHERE lower(trim(name)) = lower('Jesse Graham') AND active = 1;

-- A technician identity must not already belong to a different active login.
INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM app_users
WHERE active = 1
  AND username <> 'jeffw' COLLATE NOCASE
  AND technician_id = (
    SELECT id FROM technicians
    WHERE lower(trim(name)) = lower('Jeff Wittig') AND active = 1
    LIMIT 1
  );

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM app_users
WHERE active = 1
  AND username <> 'jesseg' COLLATE NOCASE
  AND technician_id = (
    SELECT id FROM technicians
    WHERE lower(trim(name)) = lower('Jesse Graham') AND active = 1
    LIMIT 1
  );

UPDATE app_users
SET technician_id = (
      SELECT id FROM technicians
      WHERE lower(trim(name)) = lower('Jeff Wittig') AND active = 1
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'jeffw' COLLATE NOCASE
  AND role = 'manager'
  AND active = 1;

UPDATE app_users
SET technician_id = (
      SELECT id FROM technicians
      WHERE lower(trim(name)) = lower('Jesse Graham') AND active = 1
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'jesseg' COLLATE NOCASE
  AND role = 'manager'
  AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 2 THEN 1 ELSE 0 END
FROM app_users u
JOIN technicians t ON t.id = u.technician_id AND t.active = 1
WHERE (u.username = 'jeffw' COLLATE NOCASE AND lower(trim(t.name)) = lower('Jeff Wittig'))
   OR (u.username = 'jesseg' COLLATE NOCASE AND lower(trim(t.name)) = lower('Jesse Graham'));

-- This receipt is immutable deployment evidence that the validated link operation
-- succeeded. Current account choices may change later without making old schema
-- migrations appear unhealthy.
INSERT OR REPLACE INTO working_manager_feature_receipts (feature_key, applied_at, detail)
VALUES (
  'working-manager-technician-links-0078',
  CURRENT_TIMESTAMP,
  'Jeff Wittig and Jesse Graham were linked to their active technician identities while retaining manager clearance.'
);

DROP TABLE _working_manager_link_validation_0078;
