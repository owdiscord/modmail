-- migrate:up
ALTER TABLE threads
  ADD COLUMN log_storage_type varchar(255) NULL,
  ADD COLUMN log_storage_data text NULL;

-- migrate:down
ALTER TABLE threads
  DROP COLUMN log_storage_type,
  DROP COLUMN log_storage_data;
