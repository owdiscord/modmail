-- migrate:up
ALTER TABLE threads
  ADD COLUMN thread_number integer UNIQUE;

-- migrate:down
ALTER TABLE threads
  DROP COLUMN thread_number;
