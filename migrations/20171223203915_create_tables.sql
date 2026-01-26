-- migrate:up
CREATE TABLE IF NOT EXISTS threads (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  status INT UNSIGNED NOT NULL,
  is_legacy INT UNSIGNED NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  user_name VARCHAR(128) NOT NULL,
  channel_id VARCHAR(20) NULL UNIQUE,
  created_at DATETIME NOT NULL,
  INDEX idx_threads_status (status),
  INDEX idx_threads_user_id (user_id),
  INDEX idx_threads_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  thread_id VARCHAR(36) NOT NULL,
  message_type INT UNSIGNED NOT NULL,
  user_id VARCHAR(20) NULL,
  user_name VARCHAR(128) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  is_anonymous INT UNSIGNED NOT NULL,
  dm_message_id VARCHAR(20) NULL UNIQUE,
  created_at DATETIME NOT NULL,
  INDEX idx_thread_messages_thread_id (thread_id),
  INDEX idx_thread_messages_created_at (created_at),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocked_users (
  user_id VARCHAR(20) NOT NULL PRIMARY KEY,
  user_name VARCHAR(128) NOT NULL,
  blocked_by VARCHAR(20) NULL,
  blocked_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS snippets (
  trigger VARCHAR(32) NOT NULL PRIMARY KEY,
  body TEXT NOT NULL,
  is_anonymous INT UNSIGNED NOT NULL,
  created_by VARCHAR(20) NULL,
  created_at DATETIME NOT NULL
);

-- migrate:down
DROP TABLE IF EXISTS thread_messages;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS blocked_users;
DROP TABLE IF EXISTS snippets;
