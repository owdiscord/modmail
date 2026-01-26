-- migrate:up
ALTER TABLE thread_messages
  ADD COLUMN dm_channel_id varchar(20) NULL;

-- migrate:down
ALTER TABLE thread_messages
  DROP COLUMN dm_channel_id;
