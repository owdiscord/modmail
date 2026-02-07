-- migrate:up
ALTER TABLE threads
  ADD COLUMN closed_by_id VARCHAR(20) NULL DEFAULT NULL,
  ADD COLUMN closed_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN roles VARCHAR(512) NULL DEFAULT NULL,
  ADD COLUMN server_join DATETIME NULL DEFAULT NULL,
  ADD INDEX closed_by_id_idx (closed_by_id);

CREATE TABLE registered_users (
  discord_id VARCHAR(25) PRIMARY KEY,
  registered_name VARCHAR(50),
  created_at DATETIME NOT NULL DEFAULT now(),
  updated_at DATETIME NULL DEFAULT null
);

UPDATE threads
SET
    -- Add the closing ID to historical threads
    closed_by_id = (
      SELECT user_id
      FROM thread_messages
      WHERE thread_messages.thread_id = threads.id
        AND body LIKE '!close%'
      ORDER BY id DESC
      LIMIT 1
    ),
    -- Overwatch 2 roles
    roles = (
        SELECT
            TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'ROLES **', -1), '**', 1))
        FROM thread_messages
        WHERE thread_messages.thread_id = threads.id
          AND body LIKE '%**[Overwatch 2]** NICKNAME%'
        ORDER BY id ASC
        LIMIT 1
    ),
    -- Overwatch 2 server join date
    server_join = (
        SELECT
            CASE
                -- Handle "X years, Y months" (with sanity check: max 50 years)
                WHEN body REGEXP 'JOINED \\*\\*[0-9]+ year' AND
                     REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' year', 1), '[^0-9]', '') REGEXP '^[0-9]+$' AND
                     CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' year', 1), '[^0-9]', '') AS UNSIGNED) <= 50 THEN
                    DATE_SUB(
                        threads.created_at,
                        INTERVAL
                            CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' year', 1), '[^0-9]', '') AS UNSIGNED) * 12 +
                            COALESCE(
                                IF(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(body, ', ', -1), ' month', 1), ' ago', 1), '[^0-9]', '') REGEXP '^[0-9]+$',
                                   CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(body, ', ', -1), ' month', 1), ' ago', 1), '[^0-9]', '') AS UNSIGNED),
                                   0),
                                0
                            )
                        MONTH
                    )
                -- Handle "X months" (with sanity check: max 600 months = 50 years)
                WHEN body REGEXP 'JOINED \\*\\*[0-9]+ month' AND
                     REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' month', 1), '[^0-9]', '') REGEXP '^[0-9]+$' AND
                     CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' month', 1), '[^0-9]', '') AS UNSIGNED) <= 600 THEN
                    DATE_SUB(
                        threads.created_at,
                        INTERVAL CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' month', 1), '[^0-9]', '') AS UNSIGNED) MONTH
                    )
                -- Handle "X weeks" (with sanity check: max 2600 weeks = 50 years)
                WHEN body REGEXP 'JOINED \\*\\*[0-9]+ week' AND
                     REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' week', 1), '[^0-9]', '') REGEXP '^[0-9]+$' AND
                     CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' week', 1), '[^0-9]', '') AS UNSIGNED) <= 2600 THEN
                    DATE_SUB(
                        threads.created_at,
                        INTERVAL CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' week', 1), '[^0-9]', '') AS UNSIGNED) WEEK
                    )
                -- Handle "X days" (with sanity check: max 18250 days = 50 years)
                WHEN body REGEXP 'JOINED \\*\\*[0-9]+ day' AND
                     REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' day', 1), '[^0-9]', '') REGEXP '^[0-9]+$' AND
                     CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' day', 1), '[^0-9]', '') AS UNSIGNED) <= 18250 THEN
                    DATE_SUB(
                        threads.created_at,
                        INTERVAL CAST(REGEXP_REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(body, 'JOINED **', -1), ' day', 1), '[^0-9]', '') AS UNSIGNED) DAY
                    )
                ELSE NULL
            END
        FROM thread_messages
        WHERE thread_messages.thread_id = threads.id
          AND body LIKE '%**[Overwatch 2]** NICKNAME%'
          AND body REGEXP 'JOINED \\*\\*[0-9]+'
        ORDER BY id ASC
        LIMIT 1
    );

UPDATE threads
SET closed_at = (
    SELECT MAX(created_at)
    FROM thread_messages
    WHERE thread_messages.thread_id = threads.id
)
WHERE status = 2;

-- migrate:down

DROP TABLE registered_users;

ALTER TABLE threads
  DROP COLUMN closed_by_id,
  DROP COLUMN roles,
  DROP COLUMN server_join,
  DROP COLUMN closed_at,
  DROP INDEX closed_by_id_idx;
