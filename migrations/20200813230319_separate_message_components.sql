-- migrate:up
ALTER TABLE thread_messages
  ADD COLUMN role_name varchar(255) NULL,
  ADD COLUMN attachments text NULL,
  ADD COLUMN small_attachments text NULL,
  ADD COLUMN use_legacy_format boolean NULL;

-- migrate:down
ALTER TABLE thread_messages
  DROP COLUMN role_name,
  DROP COLUMN attachments,
  DROP COLUMN small_attachments,
  DROP COLUMN use_legacy_format;
