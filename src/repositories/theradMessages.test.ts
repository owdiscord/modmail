import test from "node:test";
import assert from "node:assert";
import { useDb } from "../db";
import { create } from "./threadMessages";
import { ThreadMessageType } from "../data/constants";

test("can create a thread message", () => {
  const db = useDb();
  const created = create(db, {
    thread_id: "999999",
    message_type: ThreadMessageType.System,
    message_number: 0,
    user_id: "000111222",
    user_name: "zeroonetwo",
    role_name: "",
    body: "test",
    is_anonymous: false,
    attachments: [],
    small_attachments: [],
    dm_channel_id: "000111222",
    dm_message_id: "000111222",
    inbox_message_id: "000111222",
    created_at: new Date(),
    metadata: {},
    use_legacy_format: false,
  });

  assert.doesNotReject(created);
  return;
});

// getMessagesInThread()
// getNextMessageNumberForThread()
// updateMessageContent()
// deleteThreadMessage(sql: DbQuery, message_id: number)
// deleteMessage()
// getThreadMessageBySnowflake()
// getLatestThreadMessages()
// getLatestThreadMessage()
// getThreadMessageByNumber()
// editMessageByID()
// create(sql: DbQuery, message: ThreadMessage)
// update(sql: DbQuery, id: number, updated: ThreadMessage)
