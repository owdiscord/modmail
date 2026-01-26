-- migrate:up
ALTER TABLE threads
  ADD COLUMN scheduled_close_silent integer NULL AFTER scheduled_close_name;

-- migrate:down
ALTER TABLE threads
  DROP COLUMN scheduled_close_silent;
