import type { RowDataPacket } from "mysql2";
import { ThreadMessageType } from "../data/constants";
import type { ThreadMessage } from "../data/ThreadMessage";
import type { DbQuery } from "../db";

export type ThreadMessageRow = ThreadMessage & RowDataPacket;

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

// Delete a thread message by its ID
export async function deleteThreadMessage(sql: DbQuery, message_id: number) {
  await sql.mutation`DELETE FROM thread_messages WHERE AND id = ${message_id}`;
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

// Get the latest messages from a given thread This only returns non-system
// message, ie FromUser, ToUser, and SystemToUser.
export async function getLatestThreadMessages(
  sql: DbQuery,
  thread_id: string,
): Promise<ThreadMessageRow[]> {
  return await sql`SELECT * FROM thread_messages WHERE thread_id = ${thread_id} AND message_type IN (${ThreadMessageType.FromUser}, ${ThreadMessageType.ToUser}, ${ThreadMessageType.SystemToUser}) ORDER BY created_at DESC, id DESC LIMIT 1`;
}

// Get the latest messages from a given thread This only returns non-system
// message, ie FromUser, ToUser, and SystemToUser.
export async function getLatestThreadMessage(
  sql: DbQuery,
  thread_id: string,
): Promise<ThreadMessageRow[]> {
  return await sql`SELECT * FROM thread_messages WHERE thread_id = ${thread_id} AND message_type IN (${ThreadMessageType.FromUser}, ${ThreadMessageType.ToUser}, ${ThreadMessageType.SystemToUser}) ORDER BY created_at DESC, id`;
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

// Insert a ThreadMessage to the database
export async function create(sql: DbQuery, message: ThreadMessage) {
  return await sql.mutation`INSERT INTO thread_messages (
    thread_id,
    message_type,
    user_id,
    user_name,
    is_anonymous,
    dm_message_id,
    created_at,
    message_number,
    inbox_message_id,
    dm_channel_id,
    role_name,
    attachments,
    small_attachments,
    use_legacy_format,
    metadata,
    body
) VALUES (
    ${message.thread_id},
    ${message.message_type},
    ${message.user_id},
    ${message.user_name},
    ${message.is_anonymous},
    ${message.dm_message_id},
    ${message.created_at},
    ${message.message_number},
    ${message.inbox_message_id},
    ${message.dm_channel_id},
    ${message.role_name},
    ${JSON.stringify(message.attachments)},
    ${JSON.stringify(message.small_attachments)},
    ${message.use_legacy_format},
    ${JSON.stringify(message.metadata)},
    ${message.body}
) ON DUPLICATE KEY UPDATE body = ${message.body}`;
}

// Update a ThreadMessage to the database
export async function update(sql: DbQuery, id: number, updated: ThreadMessage) {
  return await sql.mutation`UPDATE thread_messages (
    thread_id = ${updated.thread_id},
    message_type = ${updated.message_type},
    user_id = ${updated.user_id},
    user_name = ${updated.user_name},
    is_anonymous = ${updated.is_anonymous},
    dm_message_id = ${updated.dm_message_id},
    created_at = ${updated.created_at},
    message_number = ${updated.message_number},
    inbox_message_id = ${updated.inbox_message_id},
    dm_channel_id = ${updated.dm_channel_id},
    role_name = ${updated.role_name},
    attachments = ${JSON.stringify(updated.attachments)},
    small_attachments = ${JSON.stringify(updated.small_attachments)},
    metadata = ${JSON.stringify(updated.metadata)},
    body = ${updated.body},
) WHERE id = ${id}`;
}
