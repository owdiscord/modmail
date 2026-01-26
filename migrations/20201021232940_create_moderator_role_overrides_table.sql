-- migrate:up
CREATE TABLE IF NOT EXISTS moderator_role_overrides (
  moderator_id varchar(20) NOT NULL PRIMARY KEY,
  thread_id varchar(36) NULL UNIQUE,
  role_id varchar(20) NOT NULL,

);

-- migrate:down
DROP TABLE IF EXISTS moderator_role_overrides;
