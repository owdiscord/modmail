import config from "./cfg";
import { createCommandManager } from "./commands";
import * as blocked from "./data/blocked";
import { formatters } from "./formatters";
import { messageQueue } from "./queue";
import * as utils from "./utils";
import * as threads from "./data/threads";
import { ACCIDENTAL_THREAD_MESSAGES } from "./data/constants";
import * as updates from "./data/updates";
import { getOrFetchChannel } from "./utils";
import {
  ActivityType,
  ChannelType,
  Client,
  Events,
  Guild,
  Message,
  MessageType,
} from "discord.js";
import { BotError } from "./BotError";
import { getAllOpenThreads } from "./data/threads";
import { useDb } from "./db";
import { getPluginAPI, loadPlugins } from "./plugins";
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

    console.log("Initializing...");

    initStatus(bot);
    initBaseMessageHandlers(bot);
    initUpdateNotifications();

    console.log("Loading plugins...");
    const pluginResult = await loadAllPlugins(bot);
    console.log(
      `Loaded ${pluginResult.loadedCount} plugins (${pluginResult.baseCount} built-in plugins, ${pluginResult.externalCount} external plugins)`,
    );

    console.log("");
    console.log("Done! Now listening to DMs.");
    console.log("");

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
    bot.on("guildCreate", handler);
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

async function messageIsOnInboxServer(bot: Client, msg: Message) {
  const channel = msg.channel;
  if (!channel || !channel.isTextBased) return false;

  const guild = await bot.guilds.fetch(config.inboxServerId);
  if (!guild) {
    throw new BotError("The bot is not on the inbox server!");
  }

  return msg.guildId === config.inboxServerId;
}

function initBaseMessageHandlers(bot: Client) {
  bot.on(Events.MessageCreate, async (msg) => {
    if (msg.author.id === bot.user?.id) return;

    if (
      (await utils.messageIsOnMainServer(bot, msg)) &&
      msg.mentions.users.has(bot.user?.id || "") &&
      !msg.author.bot
    ) {
      /**
       * When the bot is mentioned on the main server, ping staff in the log channel about it
       */
      if (await utils.messageIsOnInboxServer(bot, msg)) {
        // For same server setups, check if the person who pinged modmail is staff. If so, ignore the ping.
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

      let content;
      const mainGuilds = utils.getMainGuilds();
      const staffMention = config.pingOnBotMention
        ? utils.getInboxMention()
        : "";
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

      content = utils.chunkMessageLines(content);
      for (let i = 0; i < content.length; i++) {
        const logChannel = utils.getLogChannel();
        logChannel.send({ content: content[i], allowedMentions });
      }

      // Send an auto-response to the mention, if enabled
      if (config.botMentionResponse) {
        const botMentionResponse = utils.readMultilineConfigValue(
          config.botMentionResponse,
        );
        if (channel && channel.isSendable())
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
    } else if (await messageIsOnInboxServer(bot, msg)) {
      /**
       * When a moderator posts in a modmail thread...
       * 1) If alwaysReply is enabled, reply to the user
       * 2) If alwaysReply is disabled, save that message as a chat message in the thread
       */
      const thread = await threads.findByChannelId(db, msg.channel.id);
      if (!thread) return;

      if (
        !msg.author.bot &&
        (msg.content.startsWith(config.prefix) ||
          msg.content.startsWith(config.snippetPrefix || "!!"))
      ) {
        // Save commands as "command messages"
        thread.saveCommandMessageToLogs(msg);
      } else if (!msg.author.bot && config.alwaysReply) {
        const author = await msg.guild?.members.fetch(msg.author.id);
        if (!msg.member) return; // Genuinely should not happen

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
        thread.saveChatMessageToLogs(msg);
      }
    } else if (msg.channel.type === ChannelType.DM) {
      /**
       * When we get a private message...
       * 1) Find the open modmail thread for this user, or create a new one
       * 2) Post the message as a user reply in the thread
       */
      if (msg.author.bot) return;
      if (msg.type !== MessageType.Default && msg.type !== MessageType.Reply)
        return; // Ignore pins etc.

      const channel = await getOrFetchChannel(bot, msg.channel.id);
      if (!channel || !channel.isSendable()) return;

      if (await blocked.isBlocked(msg.author.id)) {
        if (config.blockedReply != null) {
          // Ignore silently if this fails
          channel.send(config.blockedReply || "").catch(utils.noop);
        }
        return;
      }

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
            ACCIDENTAL_THREAD_MESSAGES.includes(
              msg.content.trim().toLowerCase(),
            )
          )
            return;

          let newThread = await threads.createNewThreadForUser(db, msg.author, {
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
              } catch (err: any) {
                await thread.postSystemMessage(
                  `**NOTE:** Could not send auto-response to the user. The error given was: \`${err.message}\``,
                );
              }
            }
          }
        }
      });
    }
  });

  /**
   * When a message is edited...
   * 1) If that message was in DMs, and we have a thread open with that user, post the edit as a system message in the thread, or edit the thread message
   * 2) If that message was moderator chatter in the thread, update the corresponding chat message in the DB
   */
  bot.on(Events.MessageUpdate, async (msg, oldMessage) => {
    if (!msg || !msg.content) return;

    const threadMessage = await threads.findThreadMessageByDMMessageId(
      db,
      msg.id,
    );
    if (!threadMessage) {
      return;
    }

    const thread = await threads.findById(db, threadMessage.thread_id);
    if (!thread) return;

    if (thread.isClosed()) {
      return;
    }

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
        const formatted = formatters.formatUserReplyThreadMessage(
          threadMessageWithEdit,
        );

        try {
          const channel = await bot.channels.fetch(thread.channel_id);

          if (channel?.isTextBased()) {
            const message = await channel.messages.fetch(
              threadMessage.inbox_message_id,
            );
            await message.edit(formatted);
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
  });

  /**
   * When a message is deleted...
   * 1) If that message was in DMs, and we have a thread open with that user, delete the thread message
   * 2) If that message was moderator chatter in the thread, delete it from the database as well
   */
  bot.on(Events.MessageDelete, async (msg) => {
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

    if (threadMessage.isChat()) {
      // If the deleted message was staff chatter in the thread channel, also delete it from the logs
      thread.deleteChatMessageFromLogs(msg.id);
    }
  });
}

function initUpdateNotifications() {
  if (config.updateNotifications) {
    updates.refreshVersionsLoop();
  }
}

function getBasePlugins() {
  return [
    "file:./src/modules/reply",
    "file:./src/modules/close",
    "file:./src/modules/logs",
    "file:./src/modules/block",
    "file:./src/modules/move",
    "file:./src/modules/snippets",
    "file:./src/modules/suspend",
    "file:./src/modules/greeting",
    "file:./src/modules/typingProxy",
    "file:./src/modules/version",
    "file:./src/modules/newthread",
    "file:./src/modules/id",
    "file:./src/modules/alert",
    "file:./src/modules/joinLeaveNotification",
    "file:./src/modules/roles",
    "file:./src/modules/notes",
  ];
}

function getAllPlugins() {
  //  return [...getBasePlugins(), ...getExternalPlugins()];
  return getBasePlugins();
}

async function loadAllPlugins(bot: Client) {
  // Initialize command manager
  const commands = createCommandManager(bot);

  for (const alias in config.commandAliases) {
    if (config.commandAliases[alias]) {
      commands.addAlias(config.commandAliases[alias], alias);
    }
  }

  // Load plugins
  const basePlugins = getBasePlugins();
  const plugins = getAllPlugins();

  const pluginApi = getPluginAPI({ bot, db, config, commands });
  await loadPlugins(plugins, pluginApi);

  return {
    loadedCount: plugins.length,
    baseCount: basePlugins.length,
    externalCount: 0, //externalPlugins.length,
  };
}
