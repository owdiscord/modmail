-- migrate:up
CREATE TABLE IF NOT EXISTS updates (
  available_version varchar(16) NULL,
  last_checked datetime nullable
);

-- migrate:down
DROP TABLE IF EXISTS updates;
