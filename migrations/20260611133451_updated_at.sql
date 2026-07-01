-- migrate:up
ALTER TABLE threads
  ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

UPDATE threads SET updated_at = created_at;

ALTER TABLE thread_messages
  ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

UPDATE thread_messages SET updated_at = created_at;

-- migrate:down
ALTER TABLE threads
  DROP COLUMN updated_at;

ALTER TABLE thread_messages
  DROP COLUMN updated_at;
