-- migrate:up
UPDATE threads t1
SET thread_number = t2.row_num
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as row_num
    FROM threads
) t2
WHERE t1.id = t2.id;

-- migrate:down
-- Nothing to do here.
