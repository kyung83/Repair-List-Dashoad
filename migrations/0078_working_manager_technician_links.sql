PRAGMA foreign_keys = ON;

-- Jeff and Jesse are managers who also perform hands-on repair work. Keep their
-- manager clearance while linking each login to the exact technician identities
-- verified in production. Jesse's legacy records contain an internal double-space;
-- validate the identity without treating whitespace formatting as a different person.
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
WHERE id = 30 AND username = 'jeffw' COLLATE NOCASE AND role = 'manager' AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM app_users
WHERE id = 31 AND username = 'jesseg' COLLATE NOCASE AND role = 'manager' AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM technicians
WHERE id = 2
  AND lower(replace(trim(name), ' ', '')) = 'jeffwittig'
  AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE 0 END
FROM technicians
WHERE id = 3
  AND lower(replace(trim(name), ' ', '')) = 'jessegraham'
  AND active = 1;

-- Neither technician identity may already belong to a different active login.
INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM app_users
WHERE active = 1 AND id <> 30 AND technician_id = 2;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM app_users
WHERE active = 1 AND id <> 31 AND technician_id = 3;

-- Canonicalize Jesse's harmless historical double-space while the identity is
-- positively established by both the known user and technician IDs.
UPDATE technicians
SET name = 'Jesse Graham', updated_at = CURRENT_TIMESTAMP
WHERE id = 3 AND lower(replace(trim(name), ' ', '')) = 'jessegraham';

UPDATE app_users
SET display_name = 'Jesse Graham', updated_at = CURRENT_TIMESTAMP
WHERE id = 31 AND username = 'jesseg' COLLATE NOCASE;

UPDATE app_users
SET technician_id = 2, updated_at = CURRENT_TIMESTAMP
WHERE id = 30 AND username = 'jeffw' COLLATE NOCASE AND role = 'manager' AND active = 1;

UPDATE app_users
SET technician_id = 3, updated_at = CURRENT_TIMESTAMP
WHERE id = 31 AND username = 'jesseg' COLLATE NOCASE AND role = 'manager' AND active = 1;

INSERT INTO _working_manager_link_validation_0078
SELECT CASE WHEN COUNT(*) = 2 THEN 1 ELSE 0 END
FROM app_users u
JOIN technicians t ON t.id = u.technician_id AND t.active = 1
WHERE (u.id = 30 AND u.username = 'jeffw' COLLATE NOCASE AND t.id = 2 AND lower(replace(trim(t.name), ' ', '')) = 'jeffwittig')
   OR (u.id = 31 AND u.username = 'jesseg' COLLATE NOCASE AND t.id = 3 AND lower(replace(trim(t.name), ' ', '')) = 'jessegraham');

-- This receipt is immutable deployment evidence that the validated link operation
-- succeeded. Current account choices may change later without making old schema
-- migrations appear unhealthy.
INSERT OR REPLACE INTO working_manager_feature_receipts (feature_key, applied_at, detail)
VALUES (
  'working-manager-technician-links-0078',
  CURRENT_TIMESTAMP,
  'Jeff Wittig and Jesse Graham were linked to technician IDs 2 and 3 while retaining manager clearance.'
);

DROP TABLE _working_manager_link_validation_0078;
