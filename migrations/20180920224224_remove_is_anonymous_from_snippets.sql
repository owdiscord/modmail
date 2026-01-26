-- migrate:up
ALTER TABLE snippets
  DROP COLUMN is_anonymous;

-- migrate:down
ALTER TABLE snippets
  ADD COLUMN is_anonymous integer unsigned NOT NULL DEFAULT 0;
