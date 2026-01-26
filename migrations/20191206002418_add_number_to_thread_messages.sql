-- migrate:up
ALTER TABLE thread_messages
  ADD COLUMN message_number integer unsigned NULL;

-- migrate:down
ALTER TABLE thread_messages
  DROP COLUMN message_number;
