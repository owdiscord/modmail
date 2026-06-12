-- migrate:up
CREATE TABLE IF NOT EXISTS academy_waves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  -- One of 'interviews', 'helper', 'historic',
  -- set to 'interviews' when we start, only showing the interview questions, then
  -- set to 'helper' when we want helpers to be managing things, then 'historic'
  -- when the wave ends and trianees are promoted.
  state VARCHAR(32) NOT NULL DEFAULT 'interviews',
  begin_at DATETIME NOT NULL DEFAULT NOW(),
  close_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS academy_staff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snowflake VARCHAR(22) NOT NULL,
  display_name VARCHAR(512) NOT NULL,
  wave_id INT NOT NULL REFERENCES academy_waves(id),
  -- One of 'trainee', 'moderator', 'helper', or 'admin'
  role VARCHAR(64) NOT NULL DEFAULT 'trainee',
  avatar VARCHAR(512) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS academy_issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wave_id INT REFERENCES academy_waves(id),
  created_by VARCHAR(22) REFERENCES academy_staff(snowflake),
  trainee_id VARCHAR(22) REFERENCES academy_staff(snowflake),
  thread_id VARCHAR(36) NULL DEFAULT NULL,
  message_id VARCHAR(36) NULL DEFAULT NULL,
  -- One of 'pending', 'handled', 'archived', or 'deleted'
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS academy_interview_questions (
  id INT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT NOW(),
  updated_at DATETIME NULL DEFAULT NOW(),
  text VARCHAR(512) NOT NULL
);

-- migrate:down
DROP TABLE IF EXISTS academy_issues;
DROP TABLE IF EXISTS academy_staff;
DROP TABLE IF EXISTS academy_interview_questions;
DROP TABLE IF EXISTS academy_waves;
