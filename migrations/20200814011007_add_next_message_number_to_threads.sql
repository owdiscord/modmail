-- migrate:up
ALTER TABLE threads
  ADD COLUMN next_message_number integer DEFAULT 1;

-- migrate:down
ALTER TABLE threads
  DROP COLUMN next_message_number;
