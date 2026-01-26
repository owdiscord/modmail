-- migrate:up
ALTER TABLE thread_messages
  ADD COLUMN inbox_message_id varchar(20) NULL UNIQUE;

-- migrate:down
ALTER TABLE thread_messages
  DROP COLUMN inbox_message_id;
