-- migrate:up
ALTER TABLE threads
  ADD COLUMN metadata text NULL;

-- migrate:down
ALTER TABLE threads
  DROP COLUMN metadata;
