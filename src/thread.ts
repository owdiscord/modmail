import {
  type Attachment,
  Collection,
  DiscordAPIError,
  type DMChannel,
  EmbedBuilder,
  type EmbedField,
  escapeMarkdown,
  type Guild,
  type GuildMember,
  type HexColorString,
  type Message,
  type MessageCreateOptions,
  type MessageReference,
  type ReplyOptions,
  type SendableChannels,
  type User,
  type MessageMentionOptions,
  type MessageSnapshot,
  MessageReferenceType,
  type MessageResolvable,
  MessageActivityType,
  Client,
} from "discord.js";
import humanizeDuration from "humanize-duration";
import bot from "./bot";
import config from "./config";
import { ThreadMessageType, ThreadStatus } from "./data/constants";
import { getModeratorThreadDisplayRoleName } from "./data/displayRoles";
import { getLogUrl } from "./data/logs";
import type { ThreadMessage } from "./data/ThreadMessage";
import { type GuildStatus, userGuildStatus } from "./data/users";
import type { DbQuery } from "./db";
import logger from "./logger";
import { findNotesByUserId } from "./repositories/notes";
import {
  getRegisteredUsername,
  getStaffUsername,
} from "./repositories/registration";
import {
  allSnippets as allSnippets,
  type Snippet,
} from "./repositories/snippets";
import * as threadMessages from "./repositories/threadMessages";
import {
  alertUserForThreadReply,
  cancelScheduledClosure,
  cancelScheduledSuspension,
  clearThreadAlerts,
  getLastClosedThreadByUser,
  getNextThreadMessageNumber,
  getThreadMessageStats,
  getThreadStaffReplyCounts,
  getUserThreadsClosedCount,
  markThreadClosed,
  removeThreadReplyAlert,
  reOpenThread,
  scheduleThreadClosure,
  scheduleThreadSuspension,
  suspendThread,
  type StaffReplyData,
  type Thread,
} from "./repositories/threads";
import {
  Colours,
  Emoji,
  localRole,
  roleEmoji,
  Spacing,
  sortRoles,
} from "./style";
import {
  chunkMessageLines,
  disableCodeBlocks,
  disableInlineCode,
  getInboxGuild,
  getSelfUrl,
  getTimestamp,
  messageContentIsWithinMaxLength,
} from "./utils";
import { BotError } from "./BotError";
import { saveAttachment } from "./data/attachments";
import { callAfterThreadCloseScheduleCanceledHooks } from "./hooks/afterThreadCloseScheduleCanceled";
import { callBeforeNewMessageReceivedHooks } from "./hooks/beforeNewMessageReceived";
import { callAfterNewMessageReceivedHooks } from "./hooks/afterNewMessageReceived";
import { isBlocked } from "./data/blocked";
import { callAfterThreadCloseHooks } from "./hooks/afterThreadClose";
import { callAfterThreadCloseScheduledHooks } from "./hooks/afterThreadCloseScheduled";

async function postToThreadChannel(
  db: DbQuery,
  thread: Thread,
  message: MessageCreateOptions,
): Promise<Message> {
  try {
    const channel = await bot.channels.fetch(thread.channel_id);
    if (!channel?.isSendable()) throw "cannot send to an unsendable channel";

    if (message.content && message.content.length > 0) {
      // Text content is included, chunk it and send it as individual messages.
      // Files (attachments) are only sent with the last message.
      const chunks = chunkMessageLines(message.content);
      for (const [i, chunk] of chunks.entries()) {
        // Only send embeds, files, etc. with the last message
        if (i === chunks.length - 1) {
          return await channel.send({ ...message, content: chunk });
        }

        // Send a regular chunk, no need to return here.
        await channel.send({ content: chunk });
      }
    } else {
      // No text content, we are safe to assume it can be sent
      // as one message, likely only containing a file or similar.
      return await channel.send(message);
    }
  } catch (err: unknown) {
    if (err instanceof DiscordAPIError) {
      // Channel not found
      if (err.code === 10003) {
        logger.info(
          {
            thread_id: thread.id,
            username: thread.user_name,
            user_id: thread.user_id,
          },
          `thread channel no longer exists, auto closing without sending message.`,
        );
        await markThreadClosed(db, thread.id, "system");
      }

      if (err.code === 240000) {
        logger.info(
          {
            thread_id: thread.id,
            channel_id: thread.channel_id,
            username: thread.user_name,
            user_id: thread.user_id,
          },
          `cannot send message to thread, the message contains a link blocked by the harmful links filter.`,
        );

        await (
          (await bot.channels.fetch(thread.channel_id)) as SendableChannels
        ).send(
          "Failed to send message to thread channel because the message contains a link blocked by the harmful links filter",
        );
      }
    } else {
      throw err;
    }
  }

  logger.error(
    {
      thread_id: thread.id,
      channel_id: thread.channel_id,
      username: thread.user_name,
      user_id: thread.user_id,
      message,
    },
    "cannot post to thread channel",
  );

  throw "something truly wild has happened";
}

export async function replyToUser(
  db: DbQuery,
  thread: Thread,
  moderator: GuildMember | null,
  text: string,
  replyAttachments: Collection<string, Attachment> = new Collection(),
  isAnonymous: boolean = false,
  messageReference: MessageReference | null = null,
): Promise<boolean> {
  if (!moderator) return false;

  const moderatorName = (await getStaffUsername(moderator)).replace(
    /[_`~*|]/g,
    "\\$&",
  );

  const roleName = await getModeratorThreadDisplayRoleName(
    moderator,
    thread.id,
  );

  const userMessageReference: ReplyOptions = {
    messageReference: "",
    failIfNotExists: true,
  };

  // Handle replies
  if (config.relayInlineReplies && messageReference) {
    const repliedTo = await threadMessages.getThreadMessageBySnowflake(
      db,
      thread.id,
      messageReference.messageId || "",
    );
    if (repliedTo?.[0]) {
      userMessageReference.messageReference = repliedTo[0].dm_message_id || "";
    }
  }

  if (config.allowSnippets && config.allowInlineSnippets) {
    // Replace {{snippet}} with the corresponding snippet
    // The beginning and end of the variable - {{ and }} - can be changed with the config options
    // config.inlineSnippetStart and config.inlineSnippetEnd
    const all = await allSnippets(db);

    const unknownSnippets = new Set();
    text = text.replace(
      new RegExp(
        `${config.inlineSnippetStart}(\\s*\\S+?\\s*)${config.inlineSnippetEnd}`,
        "ig",
      ),
      (orig, trigger) => {
        const snippet = all.find(
          (snippet: Snippet) =>
            snippet.trigger.toLowerCase === trigger.toLowerCase().trim(),
        );
        if (snippet == null) {
          unknownSnippets.add(trigger);
        }

        return snippet != null ? snippet.body : orig;
      },
    );

    if (config.errorOnUnknownInlineSnippet && unknownSnippets.size > 0) {
      await postSystemMessage(
        db,
        thread,
        `The following snippets used in the reply do not exist:\n${Array.from(unknownSnippets).join(", ")}`,
      );
      return false;
    }
  }

  // Prepare attachments, if any
  const files: Array<Attachment> = [];
  const attachmentLinks: Array<string> = [];

  if (replyAttachments.size > 0) {
    for (const [_, attachment] of replyAttachments) {
      const result = await saveAttachment(attachment);

      if (result) {
        attachment.url = result;
        files.push(attachment);
        attachmentLinks.push(result);
      }
    }
  }

  // Re-fetch the user to avoid using a stale/partial cached User object,
  // which can cause Discord to reject createDM() with 50035 CHANNEL_RECIPIENT_REQUIRED.
  let user;
  try {
    user = await bot.users.fetch(thread.user_id, { force: true });
  } catch (err) {
    throw new BotError(
      `Could not fetch user ${thread.user_id} to open a DM: ${(err as Error).message}`,
    );
  }

  let dmChannel: DMChannel | null;
  try {
    dmChannel = await user.createDM(true);
  } catch (err: any) {
    // 50035 CHANNEL_RECIPIENT_REQUIRED -- Discord refuses to open a DM with thread user
    // (their account is deleted, disabled, not sharing a guild with the bot, or transient backend issue).
    if (err?.code === 50035) {
      throw new BotError(
        `Unable to open a DM channel with <@${user.id}>. ` +
          `The account may be deleted/disabled or not share a server with the bot.`,
      );
    }
    throw err;
  }

  const threadMessage: ThreadMessage = {
    thread_id: thread.id,
    message_type: ThreadMessageType.ToUser,
    message_number: await getNextThreadMessageNumber(db, thread.id),
    user_id: moderator.id,
    dm_channel_id: dmChannel.id,
    user_name: moderatorName,
    body: text,
    is_anonymous: isAnonymous,
    role_name: roleName || "",
    attachments: attachmentLinks,
    small_attachments: [],
    dm_message_id: "",
    inbox_message_id: "",
    created_at: new Date(),
    metadata: {},
    use_legacy_format: false,
  };

  const dmContent = formatMessageAsStaffReplyDM(threadMessage);

  if (userMessageReference) {
    dmContent.reply = userMessageReference;
    // dmContent.allowedMentions = userMessageReference;
  }

  const inboxContent = formatMessageAsStaffReply(threadMessage);

  if (messageReference) {
    inboxContent.reply = {
      messageReference: messageReference.messageId || "",
      failIfNotExists: false,
    };
  }

  // Because moderator replies have to be editable, we enforce them to fit within 1 message
  if (
    !messageContentIsWithinMaxLength(dmContent.content?.toString() || "") ||
    !messageContentIsWithinMaxLength(inboxContent.content?.toString() || "")
  ) {
    //      await threadMessage.delete();
    //    FIXME: Cant delete
    await postSystemMessage(
      db,
      thread,
      "Reply is too long! Make sure your reply is under 2000 characters total, moderator name in the reply included.",
    );
    return false;
  }

  const dmMessage = await user.send(dmContent).catch(async (err) => {
    if (!threadMessage.id) return;

    await threadMessages.deleteThreadMessage(db, threadMessage.id);
    await postSystemMessage(
      db,
      thread,
      `Error while replying to user: ${err.message}`,
    );
  });

  if (!dmMessage) return false;

  threadMessage.dm_message_id = dmMessage.id;

  // Show the reply in the inbox thread
  const inboxMessage = await postToThreadChannel(db, thread, {
    ...inboxContent,
    files,
  });

  if (inboxMessage) {
    threadMessage.inbox_message_id = inboxMessage.id;
  }

  await threadMessages.create(db, threadMessage);

  // Interrupt scheduled closing, if in progress
  if (thread.scheduled_close_at) {
    await cancelScheduledClose(db, thread);
    await postSystemMessage(
      db,
      thread,
      "Cancelling scheduled closing of thread thread due to new reply",
    );
  }

  return true;
}

export async function receiveUserReply(
  db: DbQuery,
  thread: Thread,
  message: Message,
  skipAlert = false,
): Promise<void> {
  const user = await bot.users.fetch(message.author.id);
  const opts = {
    thread,
    message,
    quiet: true,
  };

  // Call any registered beforeNewMessageReceivedHooks
  const hookResult = await callBeforeNewMessageReceivedHooks({
    user,
    opts,
    message: opts.message,
    cancel: () => void {},
  });
  if (hookResult.cancelled) return;

  let messageContent = message.content || "";

  let allMessageAttachments = message.attachments;
  if (message.messageSnapshots.size > 0) {
    allMessageAttachments = allMessageAttachments.concat(
      (message.messageSnapshots.first() as MessageSnapshot).attachments,
    );
  }

  const attachmentUrls: Array<string> = [];
  // const files: Array<AttachmentBuilder> = [];

  for (const attachment of allMessageAttachments.values()) {
    const savedAttachment = await saveAttachment(attachment);

    if (savedAttachment) {
      attachmentUrls.push(savedAttachment);
      // files.push(
      //   new AttachmentBuilder(savedAttachment, {
      //     name: attachment.name,
      //   }),
      // );
    }
  }

  const embeds = message.embeds;

  // Handle forwards
  if (
    message.reference &&
    message.reference.type === MessageReferenceType.Forward
  ) {
    const forward = message.messageSnapshots.first();
    if (!forward) return;

    for (const embed of forward.embeds) {
      embeds.push(embed);
    }

    let textContent = forward.content;
    if (forward.stickers.size > 0) {
      textContent += forward.stickers
        .map((sticker) => `Sticker **[${sticker.name}](${sticker.url})**`)
        .join("\n");
    }

    if (textContent.length === 0) textContent = "Message contains only embeds";
    messageContent = `\n\n> -# *↪ Forwarded from ${forward.guild?.name || "direct messages"}*\n> ${textContent}\n> -# ${forward.url}  •  <t:${Math.round(forward.createdTimestamp / 1000)}:f>`;
  }

  // Handle replies
  let messageReply: MessageResolvable = "";
  if (
    config.relayInlineReplies &&
    message.reference &&
    message.reference.type === MessageReferenceType.Default &&
    message.reference.messageId
  ) {
    const repliedToRows = await threadMessages.getThreadMessageBySnowflake(
      db,
      thread.id,
      message.reference.messageId,
    );

    if (repliedToRows[0]) {
      messageReply = repliedToRows[0].inbox_message_id || "";
    }
  }

  if (message.activity) {
    let applicationName = "Unknown Application";

    if (
      !applicationName &&
      message.activity.partyId &&
      message.activity.partyId.startsWith("spotify:")
    ) {
      applicationName = "Spotify";
    }

    const activityText = ((): string => {
      if (
        message.activity.type === MessageActivityType.Join ||
        message.activity.type === MessageActivityType.JoinRequest
      ) {
        return "join a game";
      } else if (message.activity.type === MessageActivityType.Spectate) {
        return "spectate";
      } else if (message.activity.type === MessageActivityType.Listen) {
        return "listen along";
      }

      return "do something";
    })();

    messageContent += `\n\n*<This message contains an invite to ${activityText} on ${applicationName}>*`;
    messageContent = messageContent.trim();
  }

  if (message.stickers) {
    const stickerLines = message.stickers.map(
      (sticker) =>
        `*Sent sticker "[${sticker.name}](https://media.discordapp.net/stickers/${sticker.id}.webp?size=160)":*`,
    );

    messageContent += `\n\n${stickerLines.join("\n")}`;
  }

  messageContent = messageContent.trim();
  if (
    message.reference &&
    message.reference.type === MessageReferenceType.Forward
  )
    messageContent = `\n${messageContent}`;

  // Save DB entry
  const threadMessage: ThreadMessage = {
    inbox_message_id: "",
    thread_id: thread.id,
    message_type: ThreadMessageType.FromUser,
    user_id: thread.user_id,
    user_name: config.useDisplaynames
      ? message.author.globalName || message.author.username
      : message.author.username,
    body: messageContent,
    is_anonymous: false,
    dm_message_id: message.id,
    dm_channel_id: message.channel.id,
    attachments: attachmentUrls,
    small_attachments: [],
    metadata: {
      embeds,
    },
    message_number: 0,
    role_name: "",
    created_at: new Date(),
    use_legacy_format: false,
  };

  // Show the user reply in the inbox thread
  const inboxContent = formatMessageAsUserReply(threadMessage);

  if (messageReply) {
    inboxContent.reply = {
      messageReference: messageReply,
      failIfNotExists: false,
    };
  }

  // Send message reply
  const inboxMessage = await postToThreadChannel(db, thread, {
    ...inboxContent,
    // files,
    embeds,
  });

  // If we successfully delivered the message, this will include the message ID, which we need to save the ThreadMessage.
  if (inboxMessage) threadMessage.inbox_message_id = inboxMessage.id;

  await threadMessages.create(db, threadMessage);

  // Call any registered afterNewMessageReceivedHooks
  await callAfterNewMessageReceivedHooks({
    user,
    opts,
    message: opts.message,
  });

  // Interrupt scheduled closing, if in progress
  if (thread.scheduled_close_at && thread.scheduled_close_id) {
    await cancelScheduledClose(db, thread);
    await postSystemMessage(
      db,
      thread,
      `<@!${thread.scheduled_close_id}> Thread that was scheduled to be closed got a new reply. Cancelling.`,
      {
        allowedMentions: {
          users: [thread.scheduled_close_id],
        },
      },
    );
  }

  if (thread.alert_ids && !skipAlert) {
    const ids = thread.alert_ids.split(",");
    const mentionsStr = ids.map((id) => `<@!${id}> `).join("");

    await deleteAlerts(db, thread);
    await postSystemMessage(
      db,
      thread,
      `${Emoji.Alert} ${mentionsStr} New message from ${thread.user_name}`,
      {
        allowedMentions: {
          users: ids,
        },
      },
    );
  }
}

export async function postSystemMessage(
  db: DbQuery,
  thread: Thread,
  message: string | MessageCreateOptions,
  opts: {
    allowedMentions?: MessageMentionOptions;
    messageReference?: MessageReference;
    emptyContent?: boolean;
  } = {},
): Promise<{
  message: Message;
  threadMessage: ThreadMessage;
}> {
  message = typeof message === "string" ? { content: message } : message;

  const threadMessage: ThreadMessage = {
    thread_id: thread.id,
    message_type: ThreadMessageType.System,
    user_id: "",
    user_name: "",
    body: opts.emptyContent ? "" : message.content || "",
    is_anonymous: false,
    message_number: 0,
    role_name: "",
    attachments: [],
    small_attachments: [],
    dm_channel_id: "",
    dm_message_id: "",
    inbox_message_id: "",
    created_at: new Date(),
    metadata: {},
    use_legacy_format: false,
  };

  const { content } = formatMessageAsSystem(threadMessage);

  message.content = opts.emptyContent ? "" : content;

  message.allowedMentions = opts.allowedMentions;
  if (opts.messageReference) {
    message.reply = {
      messageReference: opts.messageReference.messageId || "",
    };
  }

  const msg = await postToThreadChannel(db, thread, message);

  threadMessage.inbox_message_id = msg.id;
  await threadMessages.create(db, threadMessage);

  return {
    message: msg,
    threadMessage: threadMessage,
  };
}

export async function addSystemMessageToLogs(
  db: DbQuery,
  thread_id: string,
  text: string,
): Promise<ThreadMessage> {
  const threadMessage: ThreadMessage = {
    thread_id,
    message_type: ThreadMessageType.System,
    user_name: "",
    body: text,
    is_anonymous: false,
    message_number: 0,
    user_id: "",
    role_name: "",
    attachments: [],
    small_attachments: [],
    dm_channel_id: "",
    dm_message_id: "",
    inbox_message_id: "",
    created_at: new Date(),
    metadata: {},
    use_legacy_format: false,
  };

  await threadMessages.create(db, threadMessage);
  return threadMessage;
}

export async function sendSystemMessageToUser(
  db: DbQuery,
  thread: Thread,
  text: string,
  opts: {
    postToThreadChannel?: boolean;
    allowedMentions?: MessageMentionOptions;
  } = {},
): Promise<void> {
  const user = await bot.users.fetch(thread.user_id);
  if (!user) throw `user (${thread.user_id}) could not be retrieved`;

  const threadMessage: ThreadMessage = {
    thread_id: thread.id,
    message_type: ThreadMessageType.SystemToUser,
    user_name: "",
    body: text,
    is_anonymous: false,
    message_number: 0,
    user_id: "",
    role_name: "",
    attachments: [],
    small_attachments: [],
    dm_channel_id: "",
    dm_message_id: "",
    inbox_message_id: "",
    created_at: new Date(),
    metadata: {},
    use_legacy_format: false,
  };

  const dmMessage = await user
    .send(formatMessageAsSystemToUserDM(threadMessage))
    .catch((e) => {
      throw `could not send a dm to the user: ${e}`;
    });

  if (opts.postToThreadChannel !== false) {
    const inboxMessage = formatMessageAsSystem(threadMessage);
    inboxMessage.allowedMentions = opts.allowedMentions;

    const inboxMsg = await postToThreadChannel(db, thread, inboxMessage);
    threadMessage.inbox_message_id = inboxMsg.id;
  }

  threadMessage.dm_channel_id = dmMessage.channelId;
  threadMessage.dm_message_id = dmMessage.id;

  await threadMessages.create(db, threadMessage);
}

export async function postNonLogMessage(
  db: DbQuery,
  thread: Thread,
  message: MessageCreateOptions,
): Promise<Message | null> {
  return postToThreadChannel(db, thread, message);
}

export async function saveChatMessageToLogs(
  db: DbQuery,
  thread: Thread,
  msg: Message,
) {
  const threadMessage: ThreadMessage = {
    thread_id: thread.id,
    message_type: ThreadMessageType.Chat,
    user_id: msg.author.id,
    user_name: config.useDisplaynames
      ? msg.author.globalName || msg.author.username
      : msg.author.username,
    body: msg.content,
    metadata: {
      attachments: msg.attachments,
    },
    is_anonymous: false,
    dm_message_id: msg.id,
    message_number: 0,
    role_name: "",
    attachments: [],
    small_attachments: [],
    dm_channel_id: "",
    inbox_message_id: msg.id,
    created_at: new Date(),
    use_legacy_format: false,
  };

  await threadMessages.create(db, threadMessage);
}

export async function saveCommandMessageToLogs(
  db: DbQuery,
  thread: Thread,
  msg: Message,
) {
  const threadMessage: ThreadMessage = {
    thread_id: thread.id,
    message_type: ThreadMessageType.Command,
    user_id: msg.author.id,
    user_name: config.useDisplaynames
      ? msg.author.globalName || msg.author.username
      : msg.author.username,
    body: msg.content,
    dm_message_id: msg.id,
    created_at: new Date(),
    is_anonymous: false,
    message_number: 0,
    role_name: "",
    attachments: [],
    small_attachments: [],
    dm_channel_id: "",
    inbox_message_id: "",
    metadata: {},
    use_legacy_format: false,
  };
  await threadMessages.create(db, threadMessage);
}

export async function getThreadMessages(
  db: DbQuery,
  thread: Thread,
): Promise<ThreadMessage[]> {
  return (await threadMessages.getMessagesInThread(
    db,
    thread.id,
  )) as ThreadMessage[];
}

export async function getThreadMessageForMessageId(
  db: DbQuery,
  thread: Thread,
  messageId: string,
): Promise<ThreadMessage> {
  const data = await threadMessages.getThreadMessageBySnowflake(
    db,
    thread.id,
    messageId,
  );

  if (data && data.length > 0) return data[0] as ThreadMessage;

  throw "[getThreadMessageForMessageId] could not get thread message";
}

export async function getLatestThreadMessage(
  db: DbQuery,
  thread: Thread,
): Promise<ThreadMessage> {
  const data = await threadMessages.getLatestThreadMessages(db, thread.id);

  if (data && data.length === 1) return data[0] as ThreadMessage;

  throw "[getLatestThreadMessage] could not get latest thread message";
}

export async function findThreadMessageByMessageNumber(
  db: DbQuery,
  thread: Thread,
  message_number: number,
): Promise<ThreadMessage> {
  const data = await threadMessages.getThreadMessageByNumber(
    db,
    thread.id,
    message_number,
  );

  if (data && data.length === 1) return data[0] as ThreadMessage;

  throw "[findThreadMessageByMessageNumber] could not get thread message by number";
}

export async function closeThread(
  db: DbQuery,
  thread: Thread,
  closed_by_id: string,
  suppressSystemMessage = false,
  silent = false,
): Promise<void> {
  const log = logger.child({
    msg: `Closing thread ${thread.id}`,
    user_id: thread.user_id,
    username: thread.user_name,
    silent,
  });

  if (!suppressSystemMessage) {
    if (silent) {
      await postSystemMessage(db, thread, "Closing thread silently...");
    } else {
      await postSystemMessage(db, thread, "Closing thread...");
    }
  }

  await markThreadClosed(db, thread.id, closed_by_id);

  const channel = await bot.channels.fetch(thread.channel_id);
  if (channel) {
    log.info({ channel: thread.channel_id });
    await channel.delete("Thread closed");
  }

  await callAfterThreadCloseHooks({ threadId: thread.id });
}

export async function scheduleClose(
  db: DbQuery,
  thread: Thread,
  delay_ms: number,
  user: User,
  silent: boolean,
): Promise<void> {
  const closer_id = user.id;
  const closer_name = config.useDisplaynames
    ? user.globalName || user.username
    : user.username;

  await scheduleThreadClosure(
    db,
    thread.id,
    delay_ms * 1000,
    closer_id,
    closer_name,
    silent,
  );

  await callAfterThreadCloseScheduledHooks({ thread });
}

export async function cancelScheduledClose(
  db: DbQuery,
  thread: Thread,
): Promise<void> {
  await cancelScheduledClosure(db, thread.id);
  await callAfterThreadCloseScheduleCanceledHooks({ thread });
}

export async function suspend(db: DbQuery, thread: Thread): Promise<void> {
  await suspendThread(db, thread.id);
}

export async function unsuspend(db: DbQuery, thread: Thread): Promise<void> {
  await reOpenThread(db, thread.id);
}

export async function scheduleSuspend(
  db: DbQuery,
  thread: Thread,
  delay_ms: number,
  user: User,
): Promise<void> {
  const suspend_id = user.id;
  const suspend_name = config.useDisplaynames
    ? user.globalName || user.username
    : user.username;

  await scheduleThreadSuspension(
    db,
    thread.id,
    delay_ms * 1000,
    suspend_id,
    suspend_name,
  );
}

export async function cancelScheduledSuspend(
  db: DbQuery,
  thread: Thread,
): Promise<void> {
  await cancelScheduledSuspension(db, thread.id);
}

export async function addAlert(
  db: DbQuery,
  thread: Thread,
  user_id: string,
): Promise<void> {
  await alertUserForThreadReply(db, thread.id, user_id);
}

export async function removeAlert(
  db: DbQuery,
  thread: Thread,
  user_id: string,
): Promise<void> {
  await removeThreadReplyAlert(db, thread.id, user_id);
}

async function deleteAlerts(db: DbQuery, thread: Thread): Promise<void> {
  logger.info(
    { thread_id: thread.id, username: thread.user_name },
    "removing alerts for thread",
  );
  clearThreadAlerts(db, thread.id);
}

export async function editStaffReply(
  db: DbQuery,
  thread: Thread,
  threadMessage: ThreadMessage,
  newText: string,
  quiet = true,
): Promise<boolean> {
  const newThreadMessage: ThreadMessage = {
    ...threadMessage,
    body: newText,
  };

  const formattedThreadMessage = formatMessageAsStaffReply(newThreadMessage);
  const formattedDM = formatMessageAsStaffReplyDM(newThreadMessage);

  if (
    !messageContentIsWithinMaxLength(formattedDM) ||
    !messageContentIsWithinMaxLength(formattedThreadMessage)
  ) {
    await postSystemMessage(
      db,
      thread,
      "Edited reply is too long! Make sure the edit is under 2000 characters total, moderator name in the reply included.",
    );
    return false;
  }

  const { dm_channel_id, dm_message_id, inbox_message_id } = threadMessage;

  const threadChannel = await bot.channels.fetch(dm_channel_id);
  if (threadChannel?.isSendable()) {
    const message = await threadChannel.messages.fetch(dm_message_id);
    message.edit({ content: formattedDM.content });
  }

  const inboxChannel = await bot.channels.fetch(thread.channel_id);
  if (inboxChannel?.isSendable()) {
    const message = await inboxChannel.messages.fetch(inbox_message_id);
    message.edit({ content: formattedThreadMessage.content });
  }

  if (!quiet) {
    const editThreadMessage: ThreadMessage = {
      thread_id: thread.id,
      message_type: ThreadMessageType.ReplyEdited,
      user_name: "",
      body: "",
      is_anonymous: false,
      metadata: {
        originalThreadMessage: threadMessage,
        newBody: newText,
      },
      message_number: 0,
      user_id: "",
      role_name: "",
      attachments: [],
      small_attachments: [],
      dm_channel_id: "",
      dm_message_id: "",
      inbox_message_id: "",
      created_at: new Date(),
      use_legacy_format: false,
    };

    const threadNotification = formatMessageAsStaffReplyEdit(editThreadMessage);
    if (!threadNotification) return false;

    const inboxMessage = await postToThreadChannel(
      db,
      thread,
      threadNotification,
    );
    editThreadMessage.inbox_message_id = inboxMessage.id;
    await threadMessages.create(db, editThreadMessage);
  }

  await threadMessages.editMessageByID(db, threadMessage.id || 0, newText);
  return true;
}

export async function deleteStaffReply(
  db: DbQuery,
  thread: Thread,
  threadMessage: ThreadMessage,
  quiet = false,
): Promise<void> {
  const dmChannel = await bot.channels.fetch(threadMessage.dm_channel_id);
  if (dmChannel?.isSendable())
    dmChannel.messages.delete(threadMessage.dm_message_id);

  const inboxChannel = await bot.channels.fetch(thread.channel_id);
  if (inboxChannel?.isSendable())
    inboxChannel.messages.delete(threadMessage.inbox_message_id);

  if (!quiet) {
    const deletionThreadMessage: ThreadMessage = {
      thread_id: thread.id,
      message_type: ThreadMessageType.ReplyDeleted,
      user_name: "",
      body: "",
      is_anonymous: false,
      metadata: {
        originalThreadMessage: threadMessage,
      },
      message_number: 0,
      user_id: "",
      role_name: "",
      attachments: [],
      small_attachments: [],
      dm_channel_id: "",
      dm_message_id: "",
      inbox_message_id: "",
      created_at: new Date(),
      use_legacy_format: false,
    };

    const threadNotification = formatMessageAsStaffReplyDeletion(
      deletionThreadMessage,
    );
    if (!threadNotification) return;

    const inboxMessage = await postToThreadChannel(
      db,
      thread,
      threadNotification,
    );
    deletionThreadMessage.inbox_message_id = inboxMessage.id;

    await threadMessages.create(db, deletionThreadMessage);
  }

  await threadMessages.deleteThreadMessage(db, threadMessage.id || 0);
}

export function isClosed(thread: Thread): boolean {
  return thread.status === ThreadStatus.Closed;
}

export async function recoverDowntimeMessages(db: DbQuery, thread: Thread) {
  if (await isBlocked(thread.user_id)) return;
  const user = await bot.users.fetch(thread.user_id);
  const dmChannel = await user.createDM();
  if (!dmChannel) return;
  const lastMessageID =
    (await threadMessages.getLatestThreadMessage(db, thread.id))[0]
      ?.dm_message_id || "";
  if (lastMessageID === "") return;
  const messages = await dmChannel.messages.fetch({
    limit: 50,
    after: lastMessageID,
  });
  if (!messages || messages.size === 0) return;
  const filtered = messages
    .values()
    .toArray()
    .filter((msg) => msg.author.id === thread.user_id);
  if (filtered.length === 0) return;
  postSystemMessage(
    db,
    thread,
    `📥 Recovering ${filtered.length} message${filtered.length === 1 ? "" : "s"} sent by user during bot downtime!`,
  );
  let isFirst = true;
  for (const msg of filtered.reverse()) {
    await receiveUserReply(db, thread, msg, !isFirst);
    isFirst = false;
  }
}

export async function getDMChannel(thread: Thread): Promise<DMChannel> {
  try {
    const user = await bot.users.fetch(thread.user_id);
    return await user.createDM();
  } catch (err) {
    logger.error({ thread_id: thread.id, user_id: thread.user_id, err });
    throw err;
  }
}

export async function getThreadChannel(
  thread: Thread,
): Promise<SendableChannels> {
  try {
    const channel = await bot.channels.fetch(thread.channel_id);

    if (channel?.isSendable()) return channel;

    throw "it was impossible to retrieve the thread channel";
  } catch (err) {
    logger.error({ thread_id: thread.id, user_id: thread.user_id, err });
    throw err;
  }
}

//
// ## Info Header
//

const RegularColours = new Set([
  "Guillard Purple",
  "Vishkar Blue",
  "Kamori Teal",
  "Oladele Green",
  "Helix Yellow",
]);

function separator(len = 16): string {
  return "".padStart(Math.min(len, 28), "⎽");
}

function extractPronounsAndRoles(member: GuildMember): {
  pronouns: string[];
  roles: string[];
  muteStatus: boolean;
} {
  const pronouns: string[] = [];
  const roles: string[] = [];
  let muteStatus = false;

  for (const role of member.roles.cache.values()) {
    if (role.name.includes("She/Her")) pronouns.push("she/her");
    else if (role.name.includes("He/Him")) pronouns.push("he/him");
    else if (role.name.includes("They/Them")) pronouns.push("they/them");
    else if (role.name.includes("Any Pronouns")) pronouns.push("any");
    else if (role.name.includes("Muted")) muteStatus = true;

    const modmailRole = localRole(role.name);
    if (modmailRole) roles.push(modmailRole);
  }

  return {
    pronouns: pronouns.includes("any") ? ["any"] : pronouns,
    roles,
    muteStatus,
  };
}

function buildRolesForDisplay(roles: string[]): string {
  const sorted = sortRoles(roles);
  const hasRegularColour = sorted.some((r) => RegularColours.has(r));
  return sorted
    .filter((r) => !hasRegularColour || r !== "Regular")
    .map((r) => (RegularColours.has(r) ? "Regular" : r))
    .join(", ");
}

function buildJoinField(user: User, guildStatus: GuildStatus): string {
  const discordTimestamp = `${Emoji.Discord} <t:${Math.round(user.createdAt.getTime() / 1000)}:d>`;

  if (guildStatus.ban && !guildStatus.main) {
    const time = Math.round(
      (guildStatus.ban.joinedTimestamp || Date.now()) / 1000,
    );
    return `${discordTimestamp}${Spacing.Doublespace}**•**${Spacing.Doublespace}${Emoji.Appeals} <t:${time}:d>`;
  }
  if (guildStatus.main) {
    const time = Math.round(
      (guildStatus.main.joinedTimestamp || Date.now()) / 1000,
    );
    return `${discordTimestamp}${Spacing.Doublespace}**•**${Spacing.Doublespace}${Emoji.Overwatch} <t:${time}:d>`;
  }
  return `${discordTimestamp}${Spacing.Doublespace}**•**${Spacing.Doublespace}Unknown`;
}

function buildMainGuildFields(
  member: GuildMember,
  muteStatus: boolean,
): EmbedField[] {
  const { pronouns, roles } = extractPronounsAndRoles(member);
  const rolesForDisplay = buildRolesForDisplay(roles);
  const displayName = escapeMarkdown(member.nickname || member.user.username);
  const pronounStr = pronouns.length > 0 ? `  •  (${pronouns.join("/")})` : "";
  const fields: EmbedField[] = [
    {
      name: `${displayName}${pronounStr}`,
      value:
        rolesForDisplay.length > 0
          ? `${roleEmoji(roles[0] || "")}${Spacing.DraysPrecious}${rolesForDisplay}`
          : "",
      inline: false,
    },
  ];

  if (member.voice.channelId && !muteStatus) {
    const channelName = member.voice.channel?.name || "unknown";
    const lastField = fields.at(-1)!;
    lastField.value += `\n-# ${separator((member.voice.channel?.name?.length || 10) * 2)}`;
    fields.push({
      name: "In Voice Channel",
      value: `<#${member.voice.channelId}> (${channelName})`,
      inline: false,
    });
  }

  return fields;
}

async function buildExternalGuildHeaderItems(
  guildData: { guild: Guild; member: GuildMember },
  muteStatus: boolean,
): Promise<string> {
  const member = await guildData.member.fetch();
  const nickname =
    guildData.member.nickname || config.useDisplaynames
      ? guildData.member.user.globalName
      : guildData.member.user.username;

  const items = [
    {
      name: "Display Name",
      value: escapeMarkdown(nickname || member.user.username),
    },
  ];

  if (member.voice.channelId && !muteStatus) {
    items.push({
      name: "Voice Channel",
      value: escapeMarkdown(member.voice.channel?.name || "unknown"),
    });
  }

  if (member.roles.cache.size > 0) {
    items.push({
      name: "Roles",
      value: member.roles.cache
        .filter((r) => r.name !== "@everyone")
        .map((r) => r.name)
        .join(", "),
    });
  }

  const headerStr = items
    .map((h) => `${h.name.toUpperCase()} ${h.value}`)
    .join(", ");
  return `\n**[${escapeMarkdown(guildData.guild.name)}]** ${headerStr}`;
}

export async function sendInfoHeader(
  db: DbQuery,
  thread: Thread,
  user: User,
  userGuildData: Map<string, { guild: Guild; member: GuildMember }>,
): Promise<boolean> {
  const [guildStatus, userLogCount, userNotes] = await Promise.all([
    userGuildStatus(bot, user),
    getUserThreadsClosedCount(db, thread.user_id, thread.created_at),
    findNotesByUserId(db, user.id),
  ]);

  const { muteStatus } = guildStatus.main
    ? extractPronounsAndRoles(guildStatus.main)
    : { muteStatus: false };

  const userBanned = guildStatus.ban !== null && guildStatus.main === null;

  // Build embed fields
  const fields: EmbedField[] = [
    {
      name: "Joined",
      value: buildJoinField(user, guildStatus),
      inline: true,
    },
    {
      name: "User ID",
      value: `\`${user.id}\``,
      inline: true,
    },
  ];

  if (guildStatus.main) {
    fields.push(...buildMainGuildFields(guildStatus.main, muteStatus));
  }

  // Build infoHeader text - deprecated at this point, but we keep it in the database for whatever reason.
  const accountAge = humanizeDuration(Date.now() - user.createdAt.getTime(), {
    largest: 2,
    round: true,
  });
  let infoHeader = [
    `ACCOUNT AGE **${accountAge}**`,
    `ID **${user.id}** (<@!${user.id}>)`,
  ].join(", ");

  for (const [, guildData] of userGuildData) {
    infoHeader += await buildExternalGuildHeaderItems(guildData, muteStatus);
  }

  if (userLogCount > 0) {
    infoHeader += `\n\nThis user has **${userLogCount}** previous modmail threads. Use \`${config.prefix}logs\` to see them.`;
  }
  if (userNotes.length) {
    infoHeader += `\n\nThis user has **${userNotes.length}** notes. Use \`${config.prefix}notes\` to see them.`;
  }
  infoHeader += "\n────────────────";

  // Build embed
  const embed = new EmbedBuilder();
  if (user.avatarURL !== null) embed.setThumbnail(user.avatarURL());
  embed.setTitle(`Thread #${userLogCount + 1} with ${user.username}`);

  if (userLogCount > 0) {
    const mostRecentThread = await getLastClosedThreadByUser(db, user.id);
    if (mostRecentThread) {
      mostRecentThread.log_storage_type = "local";
      const logUrl = await getLogUrl(mostRecentThread);
      embed.setDescription(
        `${userLogCount} previous thread${userLogCount === 1 ? "" : "s"} [(view last)](${logUrl})`,
      );
    }
  } else {
    embed.setDescription("No previous threads");
  }

  if (muteStatus) {
    embed.setColor(Colours.MuteRed as HexColorString);
    const lastField = fields.at(-1)!;
    lastField.value += `\n-# ${separator(20)}`;
    fields.push({
      name: `${Emoji.Muted} **User is currently muted**\n`,
      value: "",
      inline: false,
    });
  }

  if (userBanned) {
    embed.setColor(Colours.BanRed as HexColorString);
    fields.push(
      { name: user.displayName, value: `\n-# ${separator(20)}`, inline: false },
      {
        name: `${Emoji.Banned} **User is currently banned**\n`,
        value: "",
        inline: false,
      },
    );
  }

  embed.setFields(fields);

  const message = await (await getThreadChannel(thread)).send({
    content: "",
    embeds: [embed],
  });

  const threadMessage: ThreadMessage = {
    thread_id: thread.id,
    message_type: ThreadMessageType.System,
    user_id: "",
    user_name: "",
    body: infoHeader,
    metadata: { embeds: [embed] },
    inbox_message_id: message.id,
    is_anonymous: false,
    message_number: 0,
    role_name: "",
    attachments: [],
    small_attachments: [],
    dm_channel_id: "",
    dm_message_id: "",
    created_at: new Date(),
    use_legacy_format: false,
  };

  await threadMessages.create(db, threadMessage);

  return !!message;
}

//
// ## Closing embed
//

function getRoleEmoji(member: GuildMember): string {
  const roles = member.roles.cache.map((r) => r.name.toLowerCase());
  if (roles.includes("admin")) return Emoji.Roles.Admin;
  if (roles.includes("trainee")) return Emoji.Roles.Trainee;
  return Emoji.Roles.Moderator;
}

async function resolveDisplayName(
  db: DbQuery,
  user_id: string,
): Promise<string> {
  const registered = await getRegisteredUsername(db, user_id);
  if (registered) return registered;
  return (await bot.users.fetch(user_id)).username;
}

async function formatStaffReplies(
  db: DbQuery,
  staffReplyData: StaffReplyData[],
): Promise<string[]> {
  return Promise.all(
    staffReplyData.map(async (reply) => {
      const name = await resolveDisplayName(db, reply.user_id);
      return `${name} (${reply.msg_count})`;
    }),
  );
}

export async function buildCloseEmbed(
  db: DbQuery,
  thread: Thread,
  closer_id: string,
): Promise<EmbedBuilder | null> {
  const [user, author, msgStats, staffReplyData] = await Promise.all([
    bot.users.fetch(thread.user_id),
    getInboxGuild().members.cache.get(closer_id) ??
      getInboxGuild().members.fetch(closer_id),
    getThreadMessageStats(db, thread.id),
    getThreadStaffReplyCounts(db, thread.id),
  ]);

  if (!user || !author || !msgStats) return null;

  const [threadNumber, closerName, staffReplies] = await Promise.all([
    getUserThreadsClosedCount(db, user.id, thread.created_at),
    resolveDisplayName(db, author.id),
    staffReplyData ? formatStaffReplies(db, staffReplyData) : [],
  ]);

  const participantList =
    staffReplies.length > 0 ? staffReplies.join(", ") : "None";
  const logUrl = await getSelfUrl(`/logs/${thread.id}`);
  const roleEmoji = getRoleEmoji(author);

  return new EmbedBuilder()
    .setTitle(`Thread #${threadNumber} with ${user.username} closed`)
    .setDescription(
      `-# \`${user.id}\`${Spacing.Doublespace}•${Spacing.Doublespace}` +
        `Closed by ${roleEmoji} ${closerName}${Spacing.Doublespace}•${Spacing.Doublespace}` +
        `[(View log)](${logUrl})\n`,
    )
    .setColor(Colours.BanRed as HexColorString)
    .addFields([
      {
        name: "Total Messages",
        value: `-# **${msgStats.received}** User, **${msgStats.replies}** Replies, **${msgStats.internal}** Internal`,
        inline: true,
      },
      {
        name: "Participants",
        value: `-# ${participantList}`,
        inline: true,
      },
    ]);
}

// Format as a staff reply (in the DM interface)
export function formatMessageAsStaffReplyDM(
  message: ThreadMessage,
): MessageCreateOptions {
  let content = message.body;

  if (message.attachments.length > 0)
    content += `\n\n${message.attachments.join("\n")}`;

  const roleName = message.role_name || config.fallbackRoleName;
  const modInfo = message.is_anonymous
    ? roleName
    : roleName
      ? `(${roleName}) ${message.user_name}`
      : message.user_name;

  return {
    content: modInfo ? `**${modInfo}:** ${content}` : content,
  };
}

// Format a message as a staff reply (->User)
export function formatMessageAsStaffReply(
  message: ThreadMessage,
): MessageCreateOptions {
  const roleName = message.role_name || config.fallbackRoleName;
  const modInfo = message.is_anonymous
    ? roleName
      ? `(Anonymous) (${message.user_name}) ${roleName}`
      : `(Anonymous) (${message.user_name})`
    : roleName
      ? `(${roleName}) ${message.user_name}`
      : message.user_name;

  let result = modInfo ? `**${modInfo}:** ${message.body}` : message.body;

  if (config.threadTimestamps) {
    const formattedTimestamp = getTimestamp(message.created_at);
    result = `[${formattedTimestamp}] ${result}`;
  }

  result = `\`${message.message_number}\`  ${result}`;

  return {
    content: result,
  };
}

// Format message as a system message
export function formatMessageAsUserReply(
  message: ThreadMessage,
): MessageCreateOptions {
  let content = `**${message.user_name}:** ${message.body}`;

  if (message.attachments.length > 0)
    content += `\n\n${message.attachments.join("\n")}`;

  if (config.threadTimestamps) {
    const formattedTimestamp = getTimestamp(message.created_at);
    content = `[${formattedTimestamp}] ${content}`;
  }

  content = content.replace(/@(here|everyone)/g, "@\u200b$1");

  return {
    content,
    allowedMentions: {
      parse: ["users"],
    },
  };
}

// Format message as a system message
export function formatMessageAsSystem(
  message: ThreadMessage,
): MessageCreateOptions {
  let content = message.body;

  if (message.attachments.length > 0)
    content += `\n\n${message.attachments.join("\n")}`;

  return {
    content,
  };
}

// Format a message as a System->User message
export function formatMessageAsSystemToUser(
  bot: Client,
  message: ThreadMessage,
): MessageCreateOptions {
  let content = `**⚙️ ${bot.user?.username}:** ${message.body}`;

  if (message.attachments.length > 0)
    content += `\n\n${message.attachments.join("\n")}`;

  return {
    content: content,
  };
}

// Format a ThreadMessage as a staff reply edit
export function formatMessageAsSystemToUserDM(
  message: ThreadMessage,
): MessageCreateOptions {
  let content = message.body;

  if (message.attachments.length > 0)
    content += `\n\n${message.attachments.join("\n")}`;

  return {
    content,
  };
}

// Format a ThreadMessage as a staff reply edit
export function formatMessageAsStaffReplyEdit(
  message: ThreadMessage,
): MessageCreateOptions | null {
  const originalThreadMessage =
    (message.metadata.originalThreadMessage as ThreadMessage) || null;
  if (!originalThreadMessage) return null;

  const newBody = (message.metadata.newBody as string) || "Unknown";

  let content = `**${originalThreadMessage.user_name}** (\`${originalThreadMessage.user_id}\`) edited reply \`${originalThreadMessage.message_number}\``;

  if (originalThreadMessage.body.length < 200 && newBody.length < 200) {
    // Show edits of small messages inline
    content += ` from \`${disableInlineCode(originalThreadMessage.body)}\` to \`${newBody}\``;
  } else {
    // Show edits of long messages in two code blocks
    content += ":";
    content += `\n\n\`B\`:\n\`\`\`${disableCodeBlocks(originalThreadMessage.body)}\`\`\``;
    content += `\n\`A\`:\n\`\`\`${disableCodeBlocks(newBody)}\`\`\``;
  }

  return { content };
}

// Format a ThreadMessage as a staff reply deletion
export function formatMessageAsStaffReplyDeletion(
  message: ThreadMessage,
): MessageCreateOptions | null {
  const originalThreadMessage =
    (message.metadata.originalThreadMessage as ThreadMessage) || null;

  if (!originalThreadMessage) return null;

  let content = `**${originalThreadMessage.user_name}** (\`${originalThreadMessage.user_id}\`) deleted reply \`${originalThreadMessage.message_number}\``;

  if (originalThreadMessage.body.length < 200) {
    // Show the original content of deleted small messages inline
    content += ` (message content: \`${disableInlineCode(originalThreadMessage.body)}\`)`;
  } else {
    // Show the original content of deleted large messages in a code block
    content += `:\n\`\`\`${disableCodeBlocks(originalThreadMessage.body)}\`\`\``;
  }

  return { content };
}
