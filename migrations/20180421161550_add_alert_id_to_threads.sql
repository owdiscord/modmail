-- migrate:up
ALTER TABLE threads
  ADD COLUMN alert_id varchar(20) NULL AFTER scheduled_close_name;

-- migrate:down
ALTER TABLE threads
  DROP COLUMN alert_id;
