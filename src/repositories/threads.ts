import type { User } from "discord.js";
import type { RowDataPacket } from "mysql2";
import { v4 } from "uuid";
import { ThreadMessageType, ThreadStatus } from "../data/constants";
import {
  createNewThreadForUser,
  type NewThreadParams,
  type ThreadProps,
  type Thread as ThreadX,
} from "../data/Thread";
import type { DbQuery, MutationResult } from "../db";
import { threadCreationQueue } from "../queue";
import type { ThreadMessage } from "../data/ThreadMessage";

export type Thread = ThreadX;
export type ThreadRow = ThreadProps & RowDataPacket;

// Find a thread by it's internal ID (uuid format, used in loglinks)
export async function findThreadByID(
  sql: DbQuery,
  id: string,
): Promise<ThreadRow[]> {
  return await sql`SELECT * FROM threads WHERE id = ${id} LIMIT 1`;
}

// Find a thread by the thread number. This format has since been deprecated, but
// we still might like to have this function availble.
export async function findThreadByNumber(
  sql: DbQuery,
  thread_number: number,
): Promise<ThreadRow[]> {
  return await sql`SELECT * FROM threads WHERE thread_number = ${thread_number}`;
}

// Find the currently open thread for a user by their snowflake ID. Only one thread
// can be open for a user at a time. Threads can be in one of 3 states: Open,
// Closed, and Suspended. We only look for the open type here, which is assured by the program to be just one.
export async function findOpenThreadByUserID(
  sql: DbQuery,
  user_id: string,
): Promise<ThreadRow[]> {
  return await sql`SELECT * FROM threads WHERE user_id = ${user_id} AND status = ${ThreadStatus.Open} LIMIT 1`;
}

// Insert a new thread to the database. We default a few values here, and generate the ID using npm:uuid.
// The nulled values are:
// - log_storage_data <- Deprecated and unused
// - thread_number <- Deprecated and unused
// - is_legacy <- Always falsey - we can't created legacy threads.
// We also format metadata to a JSON string if it is passed as an object.
// Optionally, created_at can be left null, and will default to `now()`
export async function create(
  db: DbQuery,
  data: Omit<ThreadProps, "id">,
): Promise<string> {
  const id = v4();
  const number =
    (await db`SELECT COALESCE(COUNT(*) + 1, 0) number FROM threads`)[0]
      ?.number || 0;

  await db.mutation`INSERT INTO threads
  (
    id,
    status,
    user_id,
    user_name,
    channel_id,
    next_message_number,
    thread_number,
    alert_ids,
    log_storage_type,
    log_storage_data,
    metadata,
    roles,
    server_join,
    created_at,
    is_legacy
  ) VALUES (
    ${id},
    ${data.status},
    ${data.user_id},
    ${data.user_name},
    ${data.channel_id},
    ${data.next_message_number},
    ${number},
    ${data.alert_ids},
    ${data.log_storage_type},
    '',
    ${typeof data.metadata === "string" ? data.metadata : JSON.stringify(data.metadata)},
    ${data.roles ? data.roles.join(",") : ""},
    ${data.server_join},
    ${data.created_at || "now()"},
    false
  )`;

  return id;
}

// Set a thread to closed status, reporting the close time and who closed it.
export async function markThreadClosed(
  sql: DbQuery,
  thread_id: string,
  closing_id: string,
): Promise<MutationResult> {
  return sql.mutation`UPDATE threads SET
    status = ${ThreadStatus.Closed},
    closed_by_id = ${closing_id},
    closed_at = now()
  WHERE id = ${thread_id}`;
}

// Schedule the thread to close at a given time, passed to us as microseconds.
// This also puts the closer ID and name into the database.
export async function scheduleThreadClosure(
  sql: DbQuery,
  thread_id: string,
  close_delay: number,
  closer_id: string,
  closer_name: string,
  silent = false,
) {
  return sql.mutation`UPDATE threads SET
    scheduled_close_at = DATE_ADD(NOW(), INTERVAL ${close_delay} MICROSECOND),
    scheduled_close_id = ${closer_id},
    scheduled_close_name = ${closer_name},
    scheduled_close_silent = ${silent}
  WHERE id = ${thread_id}`;
}

// Cancel a previously schedule close by nulling out all the scheduled close values
export async function cancelScheduledClosure(sql: DbQuery, thread_id: string) {
  return sql.mutation`UPDATE threads SET
    scheduled_close_at = null,
    scheduled_close_id = null,
    scheduled_close_name = null,
    scheduled_close_silent = null
  WHERE id = ${thread_id}`;
}

// Set a thread to suspended status
export async function suspendThread(
  sql: DbQuery,
  thread_id: string,
): Promise<MutationResult> {
  return sql.mutation`UPDATE threads SET
    status = ${ThreadStatus.Suspended},
    scheduled_suspend_id = null,
    scheduled_suspend_name = null,
    scheduled_suspend_at = null,
  WHERE id = ${thread_id}`;
}

// Schedule a threat suspension, providing the moderator who scheduled it and the
// time (in microseconds) for the suspension to take place.
export async function scheduleThreadSuspension(
  sql: DbQuery,
  thread_id: string,
  suspend_delay: number,
  suspender_id: string,
  suspender_name: string,
) {
  return sql.mutation`UPDATE threads SET
    scheduled_suspend_at DATE_ADD(NOW(), INTERVAL ${suspend_delay} MICROSECOND),
    scheduled_suspend_id = ${suspender_id},
    scheduled_suspend_name = ${suspender_name}
  WHERE id = ${thread_id}`;
}

// Cancel a previously schedule suspension by nulling out all the scheduled suspension values
export async function cancelScheduledSuspension(
  sql: DbQuery,
  thread_id: string,
) {
  return sql.mutation`UPDATE threads SET
    scheduled_suspend_at = null,
    scheduled_suspend_id = null,
    scheduled_suspend_name = null
  WHERE id = ${thread_id}`;
}

// Re-open a suspended thread by setting its status to open
export async function reOpenThread(
  sql: DbQuery,
  thread_id: string,
): Promise<MutationResult> {
  return sql.mutation`UPDATE threads SET
    status = ${ThreadStatus.Open}
  WHERE id = ${thread_id}`;
}

// Add a user ID to the alerts list, ensuring we properly concatenate new user IDs.
// We do this (and all other alert-related stuff) in SQL, which prevents badly formatted data.
export async function alertUserForThreadReply(
  sql: DbQuery,
  thread_id: string,
  user_id: string,
) {
  return sql.mutation`UPDATE threads
    SET alert_ids = CASE
      WHEN alert_ids IS NULL THEN ${user_id}
      WHEN LENGTH(alert_ids) = 0 THEN ${user_id}
      WHEN FIND_IN_SET(${user_id}, alert_ids) > 0 THEN alert_ids
      ELSE CONCAT_WS(${","}, alert_ids, ${user_id})
    END
    WHERE id = ${thread_id}`;
}

// Remove a user from the alert list for a thread.
export async function removeThreadReplyAlert(
  sql: DbQuery,
  thread_id: string,
  user_id: string,
) {
  await sql.mutation`
  UPDATE threads
  SET alert_ids = NULLIF(
    TRIM(BOTH ',' FROM
      REPLACE(CONCAT(',', alert_ids, ','), ${`,${user_id},`}, ',')
    ),
    ''
  )
  WHERE id = ${thread_id}
    AND FIND_IN_SET(${user_id}, alert_ids) > 0`;
}

// Clear all alerts from a thread
export async function clearThreadAlerts(sql: DbQuery, thread_id: string) {
  await sql.mutation`UPDATE threads SET alert_ids = null WHERE id = ${thread_id}`;
}

// Notably, this function *also* impacts thread messages, resetting
// every reference to the thread id.
export async function resetThreadID(
  db: DbQuery,
  fromId: string,
): Promise<string> {
  const newId = v4();

  await db.transaction(async (sql) => {
    // Temporarily disable foreign key checks
    await sql`SET FOREIGN_KEY_CHECKS = 0`;

    try {
      // Update in reverse order: children first, then parent
      await sql`UPDATE thread_messages SET thread_id = ${newId} WHERE thread_id = ${fromId}`;
      await sql`UPDATE threads SET id = ${newId} WHERE id = ${fromId}`;
    } finally {
      // Re-enable foreign key checks
      await sql`SET FOREIGN_KEY_CHECKS = 1`;
    }
  });

  return newId;
}

export async function findByChannelID(
  db: DbQuery,
  channelId: string,
): Promise<ThreadRow[]> {
  return await db`SELECT * FROM threads WHERE channel_id = ${channelId}`;
}

export async function findOpenThreadByChannelID(
  db: DbQuery,
  channelId: string,
): Promise<Thread | null> {
  const thread =
    await db`SELECT * FROM threads WHERE channel_id = ${channelId} AND status = ${ThreadStatus.Open}`;

  if (thread?.[0]) return thread[0] as Thread;

  return null;
}

export async function findSuspendedThreadByChannelId(
  db: DbQuery,
  channelId: string,
): Promise<Thread | null> {
  const thread =
    await db`SELECT * FROM threads WHERE channel_id = ${channelId} AND status = ${ThreadStatus.Suspended}`;

  if (thread?.[0]) return thread[0] as Thread;

  return null;
}

export async function getClosedThreadsByUserId(
  db: DbQuery,
  userId: string,
  page = 1,
  limit = 12,
): Promise<Thread[]> {
  return (await db.raw(
    `SELECT * FROM threads WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    [userId, ThreadStatus.Closed],
  )) as Thread[];
}

export async function getClosedThreadCountByUserId(
  db: DbQuery,
  user_id: string,
  created_time: Date,
): Promise<number> {
  const result =
    await db`SELECT COUNT(id) AS thread_count FROM threads WHERE status = ${ThreadStatus.Closed} AND user_id = ${user_id} AND created_at <= ${created_time}`;

  return result && result[0]?.thread_count ? result[0].thread_count : 0;
}

export async function findOrCreateThreadForUser(
  db: DbQuery,
  user: User,
  opts: NewThreadParams,
): Promise<Thread | null> {
  const existingThread = await findOpenThreadByUserID(db, user.id);
  if (existingThread[0]) return existingThread[0] as Thread;

  return createNewThreadForUser(db, threadCreationQueue, user, opts);
}

export async function getThreadsThatShouldBeClosed(
  db: DbQuery,
): Promise<Array<Thread>> {
  try {
    return (await db`SELECT * FROM threads WHERE status = ${ThreadStatus.Open} AND scheduled_close_at IS NOT NULL AND scheduled_close_at <= now()`) as Thread[];
  } catch (e) {
    throw new Error(
      `[getThreadsThatShouldBeClosed] failed to get threads that should be closed: ${e}`,
    );
  }
}

export async function getThreadsThatShouldBeSuspended(db: DbQuery) {
  try {
    return (await db`SELECT * FROM threads WHERE status = ${ThreadStatus.Open} AND scheduled_suspend_at IS NOT NULL AND scheduled_suspend_at <= now()`) as Thread[];
  } catch (e) {
    throw new Error(
      `[getThreadsThatShouldBeSuspended] failed to get threads that should be suspended: ${e}`,
    );
  }
}

export async function getAllOpenThreads(db: DbQuery): Promise<Thread[]> {
  try {
    return (await db`SELECT * FROM threads WHERE status = ${ThreadStatus.Open}`) as Thread[];
  } catch (e) {
    throw new Error(`[getAllOpenThreads] failed to get open threads: ${e}`);
  }
}

export async function findThreadMessageByDMMessageId(
  db: DbQuery,
  dmMessageId: string,
): Promise<ThreadMessage | null> {
  const result =
    await db`SELECT * FROM thread_messages WHERE dm_message_id = ${dmMessageId}`;

  return result[0] ? (result[0] as ThreadMessage) : null;
}

export async function findThreadLogByChannelID(
  db: DbQuery,
  channel_id: string,
): Promise<{ thread_id: string; channel_id: string; name: string }> {
  const thread =
    await db`SELECT id, user_name FROM threads WHERE channel_id = ${channel_id}`;

  if (thread[0])
    return { thread_id: thread[0].id, channel_id, name: thread[0].user_name };

  throw "could not find a log for that thread";
}

export async function getNextThreadMessageNumber(
  db: DbQuery,
  thread_id: string,
): Promise<number> {
  const rows =
    await db`SELECT coalesce(MAX(message_number) + 1, 1) as count FROM thread_messages WHERE thread_id = ${thread_id} AND message_type = ${ThreadMessageType.ToUser}`;

  return rows[0] ? rows[0].count : 1;
}

export async function getThreadByNumber(
  db: DbQuery,
  thread_number: number,
): Promise<Thread | null> {
  const result =
    await db`SELECT * FROM threads WHERE thread_number = ${thread_number} LIMIT 1`;

  return result[0] ? (result[0] as Thread) : null;
}

export async function getThreadById(
  db: DbQuery,
  id: string,
): Promise<Thread | null> {
  const result = await db`SELECT * FROM threads WHERE id = ${id} LIMIT 1`;

  return result[0] ? (result[0] as Thread) : null;
}

export async function getLastClosedThreadByUser(
  db: DbQuery,
  user_id: string,
): Promise<Thread | null> {
  const result =
    await db`SELECT * FROM threads WHERE user_id = ${user_id} AND status = ${ThreadStatus.Closed} ORDER BY created_at DESC LIMIT 1`;

  return result[0] ? (result[0] as Thread) : null;
}

export type ThreadMessageStats = {
  received: number;
  replies: number;
  internal: number;
};

export async function getThreadMessageStats(
  db: DbQuery,
  thread_id: string,
): Promise<ThreadMessageStats> {
  const result = await db<
    RowDataPacket & { message_type: ThreadMessageType; msg_count: number }
  >`
SELECT message_type, COUNT(*) msg_count FROM thread_messages WHERE thread_id = ${thread_id} GROUP BY message_type ORDER BY msg_count;`;

  if (result) {
    const received =
      result.find((r) => r.message_type === ThreadMessageType.FromUser)
        ?.msg_count || 0;
    const replies =
      result.find((r) => r.message_type === ThreadMessageType.ToUser)
        ?.msg_count || 0;
    const internal =
      result.find((r) => r.message_type === ThreadMessageType.Chat)
        ?.msg_count || 0;

    return {
      received,
      replies,
      internal,
    };
  }

  return { received: 0, replies: 0, internal: 0 };
}

export interface StaffReplyData {
  user_id: string;
  msg_count: number;
}

export async function getThreadStaffReplyCounts(
  db: DbQuery,
  thread_id: string,
): Promise<StaffReplyData[]> {
  const rows = await db<
    StaffReplyData & RowDataPacket
  >`SELECT user_id, COUNT(*) msg_count FROM thread_messages WHERE thread_id = ${thread_id} AND message_type = ${ThreadMessageType.ToUser} GROUP BY user_id ORDER BY msg_count DESC`;

  return rows || [];
}

export async function getUserThreadsClosedCount(
  db: DbQuery,
  user_id: string,
  created_time: Date,
): Promise<number> {
  const result = await db<
    RowDataPacket & {
      count: number;
    }
  >`SELECT coalesce(COUNT(id), 0) count FROM threads WHERE user_id = ${user_id} AND created_at <= ${created_time} AND status = ${ThreadStatus.Closed}`;

  if (result && result[0]) return result[0]?.count || 0;

  return 0;
}

// Yeah this feels unrelated, doesn't it? But we're actually only using
// Levenshtein distance to check if message edits are at all worth logging.
export function levenshteinDistance(a: string, b: string): number {
  const cols = b.length + 1;
  const dp: number[] = Array.from({ length: (a.length + 1) * cols }, (_, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return row === 0 ? col : col === 0 ? row : 0;
  });

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        // @ts-expect-error It won't be undefined, silly!
        dp[i * cols + j] = dp[(i - 1) * cols + (j - 1)];
      } else {
        dp[i * cols + j] =
          1 +
          Math.min(
            // @ts-expect-error Same as above
            dp[(i - 1) * cols + j],
            dp[i * cols + (j - 1)],
            dp[(i - 1) * cols + (j - 1)],
          );
      }
    }
  }

  return dp[a.length * cols + b.length] || 0;
}
