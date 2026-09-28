-- migrate:up
CREATE TABLE IF NOT EXISTS thread_alerts (
  thread_id varchar(36) NOT NULL REFERENCES threads(id),
  user_id varchar(24) NOT NULL,
  is_sticky boolean DEFAULT false,
  PRIMARY KEY (thread_id, user_id)
);

-- migrate:down
DROP TABLE thread_alerts;
