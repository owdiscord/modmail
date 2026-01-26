-- migrate:up
ALTER TABLE thread_messages
  MODIFY body TEXT;

-- migrate:down
ALTER TABLE thread_messages
  MODIFY body MEDIUMTEXT;
