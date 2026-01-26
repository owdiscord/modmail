-- migrate:up
CREATE TABLE IF NOT EXISTS notes (
  user_id varchar(20) NULL,
  note mediumtext NULL
);

-- migrate:down
DROP TABLE IF EXISTS "notes";
