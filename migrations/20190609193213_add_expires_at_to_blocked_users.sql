-- migrate:up
ALTER TABLE blocked_users
  ADD COLUMN expires_at datetime NULL;

-- migrate:down
ALTER TABLE blocked_users
  DROP COLUMN expires_at;
