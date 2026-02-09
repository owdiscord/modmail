import {
  ActivityType,
  ChannelType,
  type Client,
  Events,
  type Guild,
  type Message,
  MessageType,
  type OmitPartialGroupDMChannel,
  type PartialMessage,
} from "discord.js";
import { type Commands, createCommandManager } from "./commands";
import config from "./config";
import * as blocked from "./data/blocked";
import { ACCIDENTAL_THREAD_MESSAGES } from "./data/constants";
import * as threads from "./data/threads";
import { getAllOpenThreads } from "./data/threads";
import { useDb } from "./db";
import { createPluginProps, loadPlugins } from "./plugins";
import { sendCloseNotification } from "./plugins/close";
import { handleSnippet } from "./plugins/snippets";
import { messageQueue } from "./queue";
import * as utils from "./utils";
import { postError } from "./utils";

const db = useDb();

export async function start(bot: Client) {
  console.log("Connecting to Discord...");

  bot.once(Events.ClientReady, async (readyClient) => {
    console.log(
      `Connected as ${readyClient.user.tag}\nWaiting for servers to become available...`,
    );

    await new Promise<void>((resolve) => {
      const waitNoteTimeout = setTimeout(() => {
        console.log(
          "Servers did not become available after 15 seconds, continuing start-up anyway",
        );
        console.log("");

        const isSingleServer =
          config.inboxServerId &&
          config.mainServerId?.includes(config.inboxServerId);

        if (isSingleServer) {
          console.log(
            "WARNING: The bot will not work before it's invited to the server.",
          );
        } else {
          const hasMultipleMainServers = (config.mainServerId || []).length > 1;
          if (hasMultipleMainServers) {
            console.log(
              "WARNING: The bot will not function correctly until it's invited to *all* main servers and the inbox server.",
            );
          } else {
            console.log(
              "WARNING: The bot will not function correctly until it's invited to *both* the main server and the inbox server.",
            );
          }
        }

        console.log("");

        resolve();
      }, 15 * 1000);

      Promise.all([
        ...(config.mainServerId || []).map((id) => waitForGuild(bot, id)),
        waitForGuild(bot, config.inboxServerId || ""),
      ]).then(() => {
        clearTimeout(waitNoteTimeout);
        resolve();
      });
    });

    // Initialize command manager
    const commands = createCommandManager(bot);

    initStatus(bot);
    initialiseListeners(bot, commands);

    console.log("Loading plugins...");
    const pluginsLoaded = await loadAllPlugins(bot, commands);
    console.log(`Loaded ${pluginsLoaded} plugins`);
    console.log("Done! Now listening to DMs.");

    const openThreads = await getAllOpenThreads(db);
    for (const thread of openThreads) {
      try {
        await thread.recoverDowntimeMessages();
      } catch (err) {
        console.error(
          `Error while recovering messages for ${thread.user_id}: ${err}`,
        );
        console.error(err);
      }
    }
  });

  bot.login(config.token);
}

function waitForGuild(bot: Client, guildId: string) {
  if (bot.guilds.cache.has(guildId)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const handler = (guild: Guild) => {
      if (guild.id === guildId) {
        bot.off("guildCreate", handler); // Clean up listener
        resolve();
      }
    };
    bot.on(Events.GuildCreate, handler);
  });
}

function initStatus(bot: Client) {
  function applyStatus() {
    bot.user?.setPresence({
      activities: [
        {
          type: ActivityType.Custom,
          name: config.status || "DM to contact mods",
        },
      ],
      status: "online",
    });
  }

  // Set the bot status initially, then reapply it every hour since in some cases it gets unset
  applyStatus();
  setInterval(applyStatus, 60 * 60 * 1000);
}

function initialiseListeners(bot: Client, commands: Commands) {
  bot.on(Events.MessageCreate, async (msg) => {
    if (msg.author.id === bot.user?.id) return;

    const isOnInbox = await utils.messageIsOnInboxServer(msg);
    const isOnMain = await utils.messageIsOnMainServer(msg);

    // Route to appropriate handler based on message context
    if (
      isOnMain &&
      msg.mentions.users.has(bot.user?.id || "") &&
      !msg.author.bot
    ) {
      await handleMainServerMention(bot, msg);
    } else if (isOnInbox) {
      await handleInboxServerMessage(bot, commands, msg);
    } else if (msg.channel.type === ChannelType.DM) {
      await handleUserDM(bot, msg);
    }
  });

  bot.on(Events.MessageUpdate, async (msg, oldMessage) => {
    await handleMessageEdit(bot, msg, oldMessage);
  });

  bot.on(Events.MessageDelete, async (msg) => {
    await handleMessageDelete(bot, msg);
  });

  bot.on(Events.ChannelDelete, async (channel) => {
    if (channel.isDMBased()) return;

    if (channel.guildId || channel.guildId !== utils.getInboxGuild().id) return;

    const thread = await threads.findOpenThreadByChannelId(db, channel.id);
    if (!thread) return;

    console.log(
      `[INFO] Auto-closing thread with ${thread.user_name} because the channel was deleted`,
    );
    if (config.closeMessage) {
      const closeMessage = utils.readMultilineConfigValue(config.closeMessage);
      await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
    }

    await thread.close("", true);

    await sendCloseNotification(
      thread,
      `Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) was closed automatically because the channel was deleted`,
    );
  });
}

/**
 * Handle bot mentions on the main server
 */
async function handleMainServerMention(bot: Client, msg: Message) {
  // For same server setups, check if the person who pinged modmail is staff. If so, ignore the ping.
  if (await utils.messageIsOnInboxServer(msg)) {
    if (utils.isStaff(msg.member)) return;
  } else {
    // For separate server setups, check if the member is staff on the modmail server
    const inboxMember = await utils
      .getInboxGuild()
      .members.fetch(msg.author.id);
    if (inboxMember && utils.isStaff(inboxMember)) return;
  }

  // If the person who mentioned the bot is blocked, ignore them
  if (await blocked.isBlocked(msg.author.id)) return;

  let content = "";
  const mainGuilds = utils.getMainGuilds();
  const staffMention = config.pingOnBotMention ? utils.getInboxMention() : "";
  const allowedMentions = config.pingOnBotMention
    ? utils.getInboxMentionAllowedMentions()
    : undefined;

  const channel = await bot.channels.fetch(msg.channelId);

  const userMentionStr = `**${msg.author.username}** (\`${msg.author.id}\`)`;
  const messageLink = `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.id}`;

  if (mainGuilds.length === 1) {
    content = `${staffMention}Bot mentioned in ${channel} by ${userMentionStr}: "${msg.content}"\n\n<${messageLink}>`;
  } else {
    content = `${staffMention}Bot mentioned in ${channel} (${msg.guild?.name}) by ${userMentionStr}: "${msg.content}"\n\n<${messageLink}>`;
  }

  for (const block of utils.chunkMessageLines(content)) {
    const logChannel = await utils.getLogChannel();
    logChannel.send({ content: block, allowedMentions });
  }

  // Send an auto-response to the mention, if enabled
  if (config.botMentionResponse) {
    const botMentionResponse = utils.readMultilineConfigValue(
      config.botMentionResponse,
    );
    if (channel?.isSendable())
      channel.send({
        content: botMentionResponse.replace(
          /{userMention}/g,
          `<@${msg.author.id}>`,
        ),
        allowedMentions: {
          users: [msg.author.id],
        },
      });
  }

  // If configured, automatically open a new thread with a user who has pinged it
  if (config.createThreadOnMention) {
    const existingThread = await threads.findOpenThreadByUserId(
      db,
      msg.author.id,
    );
    if (!existingThread) {
      // Only open a thread if we don't already have one
      const createdThread = await threads.createNewThreadForUser(
        db,
        msg.author,
        {
          quiet: true,
        },
      );

      if (!createdThread) return;

      await createdThread.postSystemMessage(
        `This thread was opened from a bot mention in <#${channel?.id}>`,
      );
      await createdThread.receiveUserReply(msg);
    }
  }
}

/**
 * Handle messages on the inbox server
 */
async function handleInboxServerMessage(
  _bot: Client,
  commands: Commands,
  msg: Message,
) {
  // Check if this is a command (starts with prefix or snippet prefix)
  const isCommand =
    !msg.author.bot &&
    (msg.content.startsWith(config.prefix) ||
      msg.content.startsWith(config.snippetPrefix || "!!"));

  // Check if this is a snippet (handled separately in snippets plugin)
  const isSnippet =
    !msg.author.bot &&
    (msg.content.startsWith(config.snippetPrefix) ||
      msg.content.startsWith(config.snippetPrefixAnon));

  const thread = await threads.findByChannelId(db, msg.channel.id);

  if (isSnippet && thread) {
    await handleSnippet(
      msg,
      config,
      thread,
      msg.content.startsWith(config.snippetPrefixAnon),
    );

    return;
  }

  const errors: Array<string> = [];

  if (isCommand) {
    if (thread) {
      // Thread-specific command
      const threadErr = await commands.handleCommand(msg, "thread");
      if (threadErr) errors.push(threadErr);
      thread.saveCommandMessageToLogs(msg);
    }

    // Inbox server command (not in a thread)
    const inboxErr = await commands.handleCommand(msg, "inbox");
    if (inboxErr) errors.push(inboxErr);

    const globalErr = await commands.handleCommand(msg, "global");
    if (globalErr) errors.push(globalErr);

    if (errors.length > 0) postError(msg.channel, errors[0] || "");

    return;
  }

  if (!msg.author.bot && config.alwaysReply && thread) {
    const author = await msg.guild?.members.fetch(msg.author.id);
    if (!msg.member) return;

    // AUTO-REPLY: If config.alwaysReply is enabled, send
    // all staff chat messages in thread channels as replies
    if (!author || !utils.isStaff(author)) return;

    const replied = await thread.replyToUser(
      msg.member,
      msg.content.trim(),
      msg.attachments,
      config.alwaysReplyAnon || false,
      msg.reference,
    );

    if (replied) msg.delete();
  } else {
    // Otherwise just save the messages as "chat" in the logs
    if (thread) thread.saveChatMessageToLogs(msg);
  }
}

/**
 * Handle DMs from users
 */
async function handleUserDM(_bot: Client, msg: Message) {
  if (msg.author.bot) return;
  if (msg.type !== MessageType.Default && msg.type !== MessageType.Reply)
    return; // Ignore pins etc.

  const channel = await msg.channel.fetch();
  if (!channel || !channel.isSendable()) return;

  if (await blocked.isBlocked(msg.author.id)) {
    if (config.blockedReply != null) {
      // Ignore silently if this fails
      channel.send(config.blockedReply || "").catch(utils.noop);
    }
    return;
  }

  const author = await msg.author.fetch();
  if (!author) throw "utter flop";

  // Private message handling is queued so e.g. multiple message in quick succession don't result in multiple channels being created
  messageQueue.add(async () => {
    let thread = await threads.findOpenThreadByUserId(db, msg.author.id);
    const createNewThread = thread == null;

    // New thread
    if (createNewThread) {
      // Ignore messages that shouldn't usually open new threads, such as "ok", "thanks", etc.
      if (
        config.ignoreAccidentalThreads &&
        msg.content &&
        ACCIDENTAL_THREAD_MESSAGES.includes(msg.content.trim().toLowerCase())
      )
        return;

      const newThread = await threads.createNewThreadForUser(db, author, {
        quiet: false,
        source: "dm",
        message: msg,
      });
      if (newThread) thread = newThread;
    }

    if (thread) {
      await thread.receiveUserReply(msg);

      if (createNewThread) {
        // Send auto-reply to the user
        if (config.responseMessage) {
          const responseMessage = utils.readMultilineConfigValue(
            config.responseMessage,
          );

          try {
            const postToThreadChannel =
              config.showResponseMessageInThreadChannel;

            await thread.sendSystemMessageToUser(responseMessage, {
              postToThreadChannel,
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : err;

            await thread.postSystemMessage(
              `**NOTE:** Could not send auto-response to the user. The error given was: \`${message}\``,
            );
          }
        }
      }
    }
  });
}

/**
 * Handle message edits
 */
async function handleMessageEdit(
  bot: Client,
  msg: OmitPartialGroupDMChannel<Message<boolean> | PartialMessage<boolean>>,
  oldMessage: OmitPartialGroupDMChannel<
    Message<boolean> | PartialMessage<boolean>
  > | null,
) {
  if (!msg || !msg.content) return;

  const threadMessage = await threads.findThreadMessageByDMMessageId(
    db,
    msg.id,
  );
  if (!threadMessage) return;

  const thread = await threads.findById(db, threadMessage.thread_id);
  if (!thread) return;

  if (thread.isClosed()) return;

  // FIXME: There is a small bug here. When we don't have the old message cached (i.e. when we use threadMessage.body as oldContent),
  //        multiple edits of the same message will show the unedited original content as the "before" version in the logs.
  //        To fix this properly, we'd have to store both the original version and the current edited version in the thread message,
  //        and it's probably not worth it.
  const newContent = oldMessage?.content || threadMessage.body;
  const oldContent = msg.content;

  if (threadMessage.isFromUser()) {
    const editMessage = utils.disableLinkPreviews(
      `**The user edited their message:**\n\`B:\` ${oldContent}\n\`A:\` ${newContent}`,
    );

    if (config.updateMessagesLive) {
      // When directly updating the message in the staff view, we still want to keep the original content in the logs.
      // To do this, we don't edit the log message at all and instead add a fake system message that includes the edit.
      // This mirrors how the logs would look when we're not directly updating the message.
      await thread.addSystemMessageToLogs(editMessage);

      const threadMessageWithEdit = threadMessage.clone();
      threadMessageWithEdit.body = newContent;
      const formatted = threadMessageWithEdit.formatAsUserReply();

      try {
        const channel = await bot.channels.fetch(thread.channel_id);

        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(
            threadMessage.inbox_message_id,
          );

          await message.edit({
            content: formatted.content,
          });
        }
      } catch (e) {
        console.warn(e);
      }
    } else {
      await thread.postSystemMessage(editMessage);
    }
  }

  if (threadMessage.isChat()) {
    const message = await msg.fetch();
    thread.updateChatMessageInLogs(message);
  }
}

/**
 * Handle message deletions
 */
async function handleMessageDelete(
  bot: Client,
  msg: OmitPartialGroupDMChannel<Message<boolean> | PartialMessage<boolean>>,
) {
  const msgThread = await threads.findByChannelId(db, msg.channelId);
  if (!msgThread && msg.channel.type !== ChannelType.DM) return;

  const threadMessage = await threads.findThreadMessageByDMMessageId(
    db,
    msg.id,
  );
  if (!threadMessage) return;

  const thread = await threads.findById(db, threadMessage.thread_id);
  if (!thread) return;

  if (thread.isClosed()) {
    return;
  }

  if (threadMessage.isFromUser() && config.updateMessagesLive) {
    // If the deleted message was in DMs and updateMessagesLive is enabled, reflect the deletion in staff view
    try {
      const channel = await bot.channels.fetch(thread.channel_id);

      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(
          threadMessage.inbox_message_id,
        );
        await message.delete();
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // If the deleted message was staff chatter in the thread channel, also delete it from the logs
  if (threadMessage.isChat()) thread.deleteChatMessageFromLogs(msg.id);
}

async function loadAllPlugins(
  bot: Client,
  commands: Commands,
): Promise<number> {
  for (const alias in config.commandAliases) {
    if (config.commandAliases[alias]) {
      commands.addAlias(config.commandAliases[alias], alias);
    }
  }

  const props = createPluginProps({ bot, db, config, commands });
  return loadPlugins(props);
}
