-- migrate:up
ALTER TABLE thread_messages
  ADD COLUMN metadata text NULL;

-- migrate:down
ALTER TABLE thread_messages
  DROP COLUMN metadata;
