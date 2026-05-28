import type { RowDataPacket } from "mysql2";
import { ThreadMessageType } from "../data/constants";
import type { ThreadMessageProps } from "../data/ThreadMessage";
import type { DbQuery } from "../db";

export type ThreadMessageRow = ThreadMessageProps & RowDataPacket;

// Get all the thread messages belonging to a thread, by its ID.
export async function getMessagesInThread(
  sql: DbQuery,
  thread_id: string,
): Promise<ThreadMessageRow[]> {
  return sql<ThreadMessageRow>`SELECT * FROM thread_messages WHERE thread_id = ${thread_id} ORDER BY created_at ASC, id ASC`;
}

// Get the next message number for a given thread. This is used internally to
// allow use of the !delete and !edit commands, primarily. Default back to 1 if no messages have been sent yet.
export async function getNextMessageNumberForThread(
  sql: DbQuery,
  thread_id: string,
): Promise<number> {
  const rows =
    await sql`SELECT coalesce(MAX(message_number) + 1, 1) as number FROM thread_messages
  WHERE thread_id = ${thread_id} AND message_type = ${ThreadMessageType.ToUser}`;

  return rows[0]?.number ?? 1;
}

// Does what it says on the tin lad. Update the thread message content by its
// given ID (and thread ID, to doubly-ensure no overlaps!)
export async function updateMessageContent(
  sql: DbQuery,
  thread_id: string,
  message_id: string,
  content: string,
) {
  await sql.mutation`UPDATE thread_messages SET body = ${content} WHERE thread_id = ${thread_id} AND dm_message_id = ${message_id}`;
}

// Delete a thread message, once again cross-matching the message ID and thread ID
export async function deleteMessage(
  sql: DbQuery,
  thread_id: string,
  message_id: string,
) {
  await sql.mutation`DELETE FROM thread_messages WHERE thread_id = ${thread_id} AND id = ${message_id}`;
}

// Get the internally stored message for a given Discord message snowflake.
// This can be either end of the exchange, either the inbox ID or the DM ID.
export async function getThreadMessageBySnowflake(
  sql: DbQuery,
  thread_id: string,
  message_id: string,
): Promise<ThreadMessageRow[]> {
  return await sql<ThreadMessageRow>`SELECT * FROM thread_messages WHERE thread_id = ${thread_id} AND (dm_message_id = ${message_id} OR inbox_message_id = ${message_id})`;
}

// Get the latest message from a given thread This only returns non-system
// message, ie FromUser, ToUser, and SystemToUser.
export async function getLatestThreadMessages(
  sql: DbQuery,
  thread_id: string,
): Promise<ThreadMessageRow[]> {
  return await sql`SELECT * FROM thread_messages WHERE thread_id = ${thread_id} AND message_type IN (${ThreadMessageType.FromUser}, ${ThreadMessageType.ToUser}, ${ThreadMessageType.SystemToUser}) ORDER BY created_at DESC, id DESC LIMIT 1`;
}

// Get the stored message by its number in the thread. This refers to the number
// sent alongside the message in user-side messages. usually prefixed in a codeblock.
export async function getThreadMessageByNumber(
  sql: DbQuery,
  thread_id: string,
  message_number: number,
): Promise<ThreadMessageRow[]> {
  return await sql`SELECT * FROM thread_messages WHERE thread_id = ${thread_id} AND message_number = ${message_number} LIMIT `;
}

// Update the body content of a thread message by it's internal ID
export async function editMessageByID(
  sql: DbQuery,
  message_id: number,
  new_content: string,
) {
  await sql.mutation`UPDATE thread_messages SET body = ${new_content} WHERE id = ${message_id}`;
}
