-- migrate:up
ALTER TABLE threads
  ADD COLUMN scheduled_suspend_at datetime NULL DEFAULT NULL AFTER channel_id,
  ADD COLUMN scheduled_suspend_id varchar(20) NULL AFTER channel_id,
  ADD COLUMN scheduled_suspend_name varchar(128) NULL AFTER channel_id,
  ADD INDEX idx_scheduled_suspend_at (scheduled_suspend_at);

-- migrate:down
ALTER TABLE threads
  DROP COLUMN scheduled_suspend_at,
  DROP COLUMN scheduled_suspend_id,
  DROP COLUMN scheduled_suspend_name;
