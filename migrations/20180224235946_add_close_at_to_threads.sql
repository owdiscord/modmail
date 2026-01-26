-- migrate:up
ALTER TABLE threads
  ADD COLUMN scheduled_close_name VARCHAR(128) NULL DEFAULT NULL AFTER channel_id,
  ADD COLUMN scheduled_close_id VARCHAR(20) NULL DEFAULT NULL AFTER channel_id,
  ADD COLUMN scheduled_close_at DATETIME NULL DEFAULT NULL AFTER channel_id,
  ADD INDEX idx_threads_scheduled_close_at (scheduled_close_at);

-- migrate:down
ALTER TABLE threads
  DROP COLUMN scheduled_close_at,
  DROP COLUMN scheduled_close_id,
  DROP COLUMN scheduled_close_name,
  DROP INDEX idx_threads_scheduled_close_at;
