-- migrate:up
ALTER TABLE moderator_role_overrides
  DROP PRIMARY KEY,
  ADD COLUMN id INT AUTO_INCREMENT PRIMARY KEY FIRST,
  ADD UNIQUE KEY unique_moderator_thread (moderator_id, thread_id);

-- migrate:down
ALTER TABLE moderator_role_overrides
  DROP PRIMARY KEY,
  DROP COLUMN id,
  DROP KEY unique_moderator_thread,
  ADD PRIMARY KEY (moderator_id, thread_id);
