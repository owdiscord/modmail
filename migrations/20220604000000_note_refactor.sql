-- migrate:up
ALTER TABLE notes
  ADD COLUMN id integer PRIMARY KEY,
  ADD COLUMN author_id varchar(20) NULL,
  ADD COLUMN created_at datetime DEFAULT now(),
  ADD INDEX idx_notes_user_id (user_id),
  ADD INDEX idx_notes_author_id (author_id):

-- migrate:down
ALTER TABLE notes
  DROP COLUMN id,
  DROP COLUMN author_id,
  DROP COLUMN created_at;
