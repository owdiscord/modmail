-- migrate:up
ALTER TABLE registered_users
  ADD COLUMN avatar_hash VARCHAR(40) NULL;

-- migrate:down
ALTER TABLE registered_users
  DROP COLUMN avatar_hash;

