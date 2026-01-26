-- migrate:up
ALTER TABLE THREADS
  RENAME COLUMN alert_id TO alert_ids;

-- migrate:down
ALTER TABLE THREADS
  RENAME COLUMN alert_ids TO alert_id;
