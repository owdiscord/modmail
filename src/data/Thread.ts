import {
  ChannelType,
  type DiscordAPIError,
  type Guild,
  type GuildMember,
  type Message,
  type MessageMentionOptions,
  type TextChannel,
  type User,
  GuildChannel,
} from "discord.js";
import config from "../config";
import type { DbQuery } from "../db";
import {
  type BeforeNewThreadHookResult,
  callBeforeNewThreadHooks,
} from "../hooks/beforeNewThread";
import logger from "../logger";
import { BotError } from "../BotError.ts";

const escapeFormattingRegex = /[_`~*|]/g;

export type ThreadProps = {
  id: string;
  thread_number: number | null;
  status: number;
  user_id: string;
  user_name: string;
  channel_id: string;
  next_message_number: number;
  scheduled_close_at?: Date;
  scheduled_close_id?: string;
  scheduled_close_name?: string;
  scheduled_close_silent?: boolean;
  scheduled_suspend_at?: Date;
  scheduled_suspend_id?: string;
  scheduled_suspend_name?: string;
  alert_ids: string;
  log_storage_type: string;
  log_storage_data: Record<string, unknown> | string;
  created_at?: Date;
  metadata: Record<string, unknown>;
  roles?: Array<string>;
  server_join: Date;
};

export type Thread = {
  id: string;
  thread_number: number | null;
  status: number;
  user_id: string;
  user_name: string;
  channel_id: string;
  next_message_number: number;
  scheduled_close_at: Date | null;
  scheduled_close_id: string | null;
  scheduled_close_name: string | null;
  scheduled_close_silent: boolean | null;
  scheduled_suspend_at: Date | null;
  scheduled_suspend_id: string | null;
  scheduled_suspend_name: string | null;
  alert_ids: string;
  log_storage_type: string;
  log_storage_data:
    | {
        fullPath?: string;
        filename: string;
      }
    | string;
  created_at: Date;
  metadata: Record<string, unknown>;
  roles: Array<string>;
  server_join: Date;
};

export type NewThreadParams = {
  quiet: boolean;
  ignoreRequirements?: true;
  ignoreHooks?: true;
  message?: Message;
  categoryId?: string;
  channelName?: string;
  source?: string;
  mentionRole?: string;
  roles?: Array<string>;
  server_join?: Date;
};

export async function createNewThreadForUser(
  db: DbQuery,
  queue: SerialQueue,
  user: User,
  params: NewThreadParams,
): Promise<Thread | null> {
  const fn = async (): Promise<Thread | null> => {
    const quiet = params.quiet != null ? params.quiet : false;
    const ignoreRequirements =
      params.ignoreRequirements != null ? params.ignoreRequirements : false;
    const ignoreHooks = params.ignoreHooks != null ? params.ignoreHooks : false;

    logger.debug(
      Object.fromEntries(
        Object.entries(this).filter(
          ([_, value]) => typeof value !== "function",
        ),
      ),
      "thread created",
    );
  }

    if (existingThread) {
      throw new Error(
        "Attempted to create a new thread for a user with an existing open thread!",
      );
    }

    // If set in config, check that the user's account is old enough (time since they registered on Discord)
    // If the account is too new, don't start a new thread and optionally reply to them with a message
    if (config.requirements.accountAge && !ignoreRequirements) {
      const requiredAge = new Date();
      requiredAge.setTime(
        requiredAge.getTime() -
          config.requirements.accountAge * (60 * 60 * 1000),
      );

      if (user.createdAt >= requiredAge) {
        if (config.requirements.accountAgeDeniedMessage) {
          const accountAgeDeniedMessage =
            config.requirements.accountAgeDeniedMessage;
          const privateChannel = user.dmChannel;

          if (privateChannel)
            await privateChannel.send(accountAgeDeniedMessage);
        }
        return null;
      }
    }

    // Use the user's name for the thread channel's name
    // Channel names are particularly picky about what characters they allow, so we gotta do some clean-up
    const channelName = formatUsernameForChannel(user.username);

    params.channelName = channelName;

    let hookResult: BeforeNewThreadHookResult | undefined;
    if (!ignoreHooks) {
      // Call any registered beforeNewThreadHooks
      hookResult = await callBeforeNewThreadHooks({
        user,
        opts: params,
        message: params.message,
      });
      if (hookResult.cancelled) return null;
    }

    const log = logger.child({
      event: "creating_thread",
      user,
      channelName: params.channelName,
    });

    // Find which main guilds this user is part of
    const mainGuilds = getMainGuilds();
    const userGuildData = new Map<
      string,
      { guild: Guild; member: GuildMember }
    >();

    const serverJoin: Date | null = null;

    for (const guild of mainGuilds) {
      try {
        const member = await guild.members.fetch(user.id);

        if (member) userGuildData.set(guild.id, { guild, member });
      } catch (e: unknown) {
        // We can safely discard this error, because it just means we couldn't find the member in the guild
        // Which - for obvious reasons - is completely okay.
        if ((e as DiscordAPIError).code !== 10007)
          logger.debug({
            discord_api_code: (e as DiscordAPIError).code,
            err: e,
          });
      }
    }

    // If set in config, check that the user has been a member of one of the main guilds long enough
    // If they haven't, don't start a new thread and optionally reply to them with a message
    if (config.requirements.timeOnServer && !ignoreRequirements) {
      // The minimum required time required on the server
      const timeRequired = new Date();
      timeRequired.setTime(
        timeRequired.getTime() - config.requirements.timeOnServer * (60 * 1000),
      );

      // Check if the user joined any of the main servers a long enough time ago If we don't see
      // this user on any of the main guilds (the size check below), assume we're just missing some
      // data and give the user the benefit of the doubt.
      const isAllowed =
        userGuildData.size === 0 ||
        Array.from(userGuildData.values()).some(({ member }) => {
          return (member.joinedAt || new Date()) < timeRequired;
        });

      if (!isAllowed) {
        if (config.requirements.timeOnServerDeniedMessage) {
          const timeOnServerDeniedMessage = readMultilineConfigValue(
            config.requirements.timeOnServerDeniedMessage,
          );

          log.debug("user has not been on server long enough");
          await user.send(timeOnServerDeniedMessage);
        }

        return null;
      }
    }

    // Figure out which category we should place the thread channel in
    const parentCategory = (() => {
      if (hookResult?.categoryId) return hookResult.categoryId;

      if (params.categoryId) return params.categoryId;

      return config.automation.newThreadCategory.reduce(
        (acc, { server, category }) => {
          return userGuildData.has(server) ? category : acc;
        },
        config.automation.defaultCategory,
      );
    })();

    // Attempt to create the inbox channel for this thread
    let createdChannel: TextChannel | undefined;
    try {
      createdChannel = await getInboxGuild().channels.create({
        name: params.channelName,
        type: ChannelType.GuildText,
        parent: parentCategory,
        reason: "New modmail thread",
      });
    } catch (err: unknown) {
      // Fix for disallowed channel names in servers in Server Discovery
      if (
        err instanceof Error &&
        err.message.includes(
          "Contains words not allowed for servers in Server Discovery",
        )
      ) {
        const replacedChannelName = "badname";
        createdChannel =
          (await getInboxGuild()
            .channels.create({
              name: replacedChannelName,
              type: ChannelType.GuildText,
              reason: "New Modmail thread",
              parent: parentCategory,
            })
            .catch((e) => {
              log.error({ msg: "can't create channel", err: e });
            })) || undefined;
      }

      if (!createdChannel?.id) {
        log.error({ msg: "can't create channel", err });
        throw err;
      }
    }

    logger.error(
      {
        thread_id: this.id,
        channel_id: this.channel_id,
        username: this.user_name,
        user_id: this.user_id,
        message,
      },
      "cannot post to thread channel",
    );

    throw "something truly wild has happened";
  }

  async _startAutoAlertTimer(modId: string): Promise<void> {
    if (this._autoAlertTimeout) clearTimeout(this._autoAlertTimeout);

    const autoAlertDelay =
      convertDelayStringToMS(config.autoAlertDelay) || 120 * 1000;

    this._autoAlertTimeout = setTimeout(() => {
      if (this.status !== ThreadStatus.Open) return;
      this.addAlert(modId);
    }, autoAlertDelay);
  }

  async replyToUser(
    moderator: GuildMember | null,
    text: string,
    replyAttachments: Collection<string, Attachment> = new Collection(),
    isAnonymous: boolean = false,
    messageReference: MessageReference | null = null,
  ): Promise<boolean> {
    if (!moderator) return false;

    const inbox = await bot.channels.fetch(this.channel_id);
    if (!(inbox instanceof GuildChannel)) return false;

    const parent = await inbox.parent?.fetch();
    if (!parent) return false;

    const isApps = parent.name.toLowerCase().includes("mod app");

    isAnonymous = isApps || isAnonymous;

    const moderatorName = (await getStaffUsername(moderator)).replace(
      escapeFormattingRegex,
      "\\$&",
    );

    const roleName = isApps
      ? "Interviewer"
      : await getModeratorThreadDisplayRoleName(moderator, this.id);

    const userMessageReference: ReplyOptions = {
      messageReference: "",
      failIfNotExists: true,
    };

    // Handle replies
    if (config.relayInlineReplies && messageReference) {
      const repliedTo = await this.getThreadMessageForMessageId(
        messageReference.messageId || "",
      );
      if (repliedTo) {
        userMessageReference.messageReference = repliedTo.dm_message_id;
      }
    }

    if (config.allowSnippets && config.allowInlineSnippets) {
      // Replace {{snippet}} with the corresponding snippet
      // The beginning and end of the variable - {{ and }} - can be changed with the config options
      // config.inlineSnippetStart and config.inlineSnippetEnd
      const allSnippets = await all();

      const unknownSnippets = new Set();
      text = text.replace(
        new RegExp(
          `${config.inlineSnippetStart}(\\s*\\S+?\\s*)${config.inlineSnippetEnd}`,
          "ig",
        ),
        (orig, trigger) => {
          const snippet = allSnippets.find(
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
        await this.postSystemMessage(
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
      user = await bot.users.fetch(this.user_id, { force: true });
    } catch (err) {
      throw new BotError(
        `Could not fetch user ${this.user_id} to open a DM: ${(err as Error).message}`,
      );
    }

    let dmChannel;
    try {
      dmChannel = await user.createDM(true);
    } catch (err: any) {
      // 50035 CHANNEL_RECIPIENT_REQUIRED -- Discord refuses to open a DM with this user
      // (their account is deleted, disabled, not sharing a guild with the bot, or transient backend issue).
      if (err?.code === 50035) {
        throw new BotError(
          `Unable to open a DM channel with <@${user.id}>. ` +
            `The account may be deleted/disabled or not share a server with the bot.`,
        );
      }
      throw err;
    }

    const threadMessage = new ThreadMessage({
      thread_id: this.id,
      message_type: ThreadMessageType.ToUser,
      message_number: await getNextThreadMessageNumber(this.db, this.id),
      user_id: moderator.id,
      dm_channel_id: dmChannel.id,
      user_name: moderatorName,
      body: text,
      is_anonymous: isAnonymous,
      role_name: roleName,
      attachments: attachmentLinks,
    });

    const dmContent = threadMessage.formatAsStaffReplyDM();

    if (userMessageReference) {
      dmContent.reply = userMessageReference;
      // dmContent.allowedMentions = userMessageReference;
    }

    const inboxContent = threadMessage.formatAsStaffReplyThreadMessage();

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
      await this.postSystemMessage(
        "Reply is too long! Make sure your reply is under 2000 characters total, moderator name in the reply included.",
      );
      return false;
    }

    const dmMessage = await user.send(dmContent).catch(async (err) => {
      await threadMessage.deleteFromDb(this.db);
      await this.postSystemMessage(
        `Error while replying to user: ${err.message}`,
      );
    });

    if (!dmMessage) return false;

    threadMessage.dm_message_id = dmMessage.id;

    // Show the reply in the inbox thread
    const inboxMessage = await this.postToThreadChannel({
      ...inboxContent,
      files,
    });

    if (inboxMessage) {
      threadMessage.inbox_message_id = inboxMessage.id;
    }

    await threadMessage.saveToDb(this.db);

    // Interrupt scheduled closing, if in progress
    if (this.scheduled_close_at) {
      await this.cancelScheduledClose();
      await this.postSystemMessage(
        "Cancelling scheduled closing of this thread due to new reply",
      );
    }

    // If enabled, set up a reply alert for the moderator after a slight delay
    if (config.autoAlert) {
      await this._startAutoAlertTimer(moderator.id);
    }

    return true;
  }

  async receiveUserReply(msg: Message, skipAlert = false): Promise<void> {
    const user = await bot.users.fetch(msg.author.id);
    const opts = {
      thread: this,
      message: msg,
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

    let messageContent = msg.content || "";

    let allMessageAttachments = msg.attachments;
    if (msg.messageSnapshots.size > 0) {
      allMessageAttachments = allMessageAttachments.concat(
        (msg.messageSnapshots.first() as MessageSnapshot).attachments,
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

    const embeds = msg.embeds;

    // Handle forwards
    if (msg.reference && msg.reference.type === MessageReferenceType.Forward) {
      const forward = msg.messageSnapshots.first();
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

      if (textContent.length === 0)
        textContent = "Message contains only embeds";
      messageContent = `\n\n> -# *↪ Forwarded from ${forward.guild?.name || "direct messages"}*\n> ${textContent}\n> -# ${forward.url}  •  <t:${Math.round(forward.createdTimestamp / 1000)}:f>`;
    }

    // Handle replies
    let messageReply: MessageResolvable = "";
    if (
      config.relayInlineReplies &&
      msg.reference &&
      msg.reference.type === MessageReferenceType.Default &&
      msg.reference.messageId
    ) {
      const repliedTo = await this.getThreadMessageForMessageId(
        msg.reference.messageId,
      );

      if (repliedTo) {
        messageReply = repliedTo.inbox_message_id;
      }
    }
    if (msg.activity) {
      let applicationName = "Unknown Application";

      if (
        !applicationName &&
        msg.activity.partyId &&
        msg.activity.partyId.startsWith("spotify:")
      ) {
        applicationName = "Spotify";
      }

      const activityText = ((): string => {
        if (
          msg.activity.type === MessageActivityType.Join ||
          msg.activity.type === MessageActivityType.JoinRequest
        ) {
          return "join a game";
        } else if (msg.activity.type === MessageActivityType.Spectate) {
          return "spectate";
        } else if (msg.activity.type === MessageActivityType.Listen) {
          return "listen along";
        }

        return "do something";
      })();

      messageContent += `\n\n*<This message contains an invite to ${activityText} on ${applicationName}>*`;
      messageContent = messageContent.trim();
    }

    if (msg.stickers) {
      const stickerLines = msg.stickers.map(
        (sticker) =>
          `*Sent sticker "[${sticker.name}](https://media.discordapp.net/stickers/${sticker.id}.webp?size=160)":*`,
      );

      messageContent += `\n\n${stickerLines.join("\n")}`;
    }

    messageContent = messageContent.trim();
    if (msg.reference && msg.reference.type === MessageReferenceType.Forward)
      messageContent = `\n${messageContent}`;

    // Save DB entry
    const threadMessage = new ThreadMessage({
      inbox_message_id: "",
      thread_id: this.id,
      message_type: ThreadMessageType.FromUser,
      user_id: this.user_id,
      user_name: config.useDisplaynames
        ? msg.author.globalName || msg.author.username
        : msg.author.username,
      body: messageContent,
      is_anonymous: false,
      dm_message_id: msg.id,
      dm_channel_id: msg.channel.id,
      attachments: attachmentUrls,
      // small_attachments: smallAttachmentLinks,
      metadata: {
        embeds,
      },
    });

    // Show the user reply in the inbox thread
    const inboxContent = threadMessage.formatAsUserReply();

    if (messageReply) {
      inboxContent.reply = {
        messageReference: messageReply,
        failIfNotExists: false,
      };
    }

    // Send message reply
    const inboxMessage = await this.postToThreadChannel({
      ...inboxContent,
      // files,
      embeds,
    });

    // If we successfully delivered the message, this will include the message ID, which we need to save the ThreadMessage.
    if (inboxMessage) threadMessage.inbox_message_id = inboxMessage.id;

    await threadMessage.saveToDb(this.db);

    // Call any registered afterNewMessageReceivedHooks
    await callAfterNewMessageReceivedHooks({
      user,
      opts,
      message: opts.message,
    });

    // Interrupt scheduled closing, if in progress
    if (this.scheduled_close_at && this.scheduled_close_id) {
      await this.cancelScheduledClose();
      await this.postSystemMessage(
        `<@!${this.scheduled_close_id}> Thread that was scheduled to be closed got a new reply. Cancelling.`,
        {
          allowedMentions: {
            users: [this.scheduled_close_id],
          },
        },
      );
    }

    if (this.alert_ids && !skipAlert) {
      const ids = this.alert_ids.split(",");
      const mentionsStr = ids.map((id) => `<@!${id}> `).join("");

      await this.deleteAlerts();
      await this.postSystemMessage(
        `${Emoji.Alert} ${mentionsStr} New message from ${this.user_name}`,
        {
          allowedMentions: {
            users: ids,
          },
        },
      );
    }
  }

  async postSystemMessage(
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

    const threadMessage = new ThreadMessage({
      thread_id: this.id,
      message_type: ThreadMessageType.System,
      user_id: undefined,
      user_name: "",
      body: opts.emptyContent ? "" : message.content,
      is_anonymous: false,
    });

    const { content } = threadMessage.formatAsSystem();

    message.content = opts.emptyContent ? "" : content;

    message.allowedMentions = opts.allowedMentions;
    if (opts.messageReference) {
      message.reply = {
        messageReference: opts.messageReference.messageId || "",
      };
    }

    const msg = await this.postToThreadChannel(message);

    threadMessage.inbox_message_id = msg.id;
    const finalThreadMessage = await threadMessage.saveToDb(this.db);

    return {
      message: msg,
      threadMessage: finalThreadMessage,
    };
  }

  async addSystemMessageToLogs(text: string): Promise<ThreadMessage> {
    const threadMessage = new ThreadMessage({
      thread_id: this.id,
      message_type: ThreadMessageType.System,
      user_name: "",
      body: text,
      is_anonymous: false,
    });

    return await threadMessage.saveToDb(this.db);
  }

  async sendSystemMessageToUser(
    text: string,
    opts: {
      postToThreadChannel?: boolean;
      allowedMentions?: MessageMentionOptions;
    } = {},
  ): Promise<void> {
    const user = await bot.users.fetch(this.user_id);
    if (!user) throw `user (${this.user_id}) could not be retrieved`;

    const threadMessage = new ThreadMessage({
      thread_id: this.id,
      message_type: ThreadMessageType.SystemToUser,
      user_name: "",
      body: text,
      is_anonymous: false,
    });

    const dmMessage = await user
      .send(threadMessage.formatAsSystemToUserDM())
      .catch((e) => {
        throw `could not send a dm to the user: ${e}`;
      });

    if (opts.postToThreadChannel !== false) {
      const inboxMessage = threadMessage.formatAsSystemToUserThreadMessage(bot);
      inboxMessage.allowedMentions = opts.allowedMentions;

      const inboxMsg = await this.postToThreadChannel(inboxMessage);
      threadMessage.inbox_message_id = inboxMsg.id;
    }

    threadMessage.dm_channel_id = dmMessage.channelId;
    threadMessage.dm_message_id = dmMessage.id;

    await threadMessage.saveToDb(this.db);
  }

  async postNonLogMessage(
    message: MessageCreateOptions,
  ): Promise<Message | null> {
    return this.postToThreadChannel(message);
  }

  async saveChatMessageToLogs(msg: Message): Promise<void> {
    // FIXME: Check if we need to save attachments here !!!

    const threadMessage = new ThreadMessage({
      thread_id: this.id,
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
    });

    return await threadMessage.saveToDb(this.db);
  }

  async saveCommandMessageToLogs(msg: Message) {
    const threadMessage = new ThreadMessage({
      thread_id: this.id,
      message_type: ThreadMessageType.Command,
      user_id: msg.author.id,
      user_name: config.useDisplaynames
        ? msg.author.globalName || msg.author.username
        : msg.author.username,
      body: msg.content,
      dm_message_id: msg.id,
      created_at: new Date(),
      thread_number: 0,
      alert_ids: "",
      log_storage_type: "local",
      log_storage_data: {},
      metadata: "{}",
      roles:
        userGuildData
          .get(config.overwatchGuildId)
          ?.member.roles.cache.map((r) => r.name) || [],
      server_join: serverJoin || new Date(),
    });

    const newThreadRow = await threads
      .findThreadByID(db, newThreadId)
      .catch((err) => {
        log.error({ message: "could not find latest created thread", err });
      });
    if (!newThreadRow || newThreadRow.length === 0) {
      log.error({ message: "could not find latest created thread" });
      return null;
    }

    // We already check this above and know it can't be undefined, hence the type coercion.
    const newThread = newThreadRow[0] as Thread;

    if (!quiet) {
      // Ping moderators of the new thread
      const staffMention = params.mentionRole
        ? mentionRolesToMention(getValidMentionRoles(params.mentionRole))
        : getInboxMention();

      if (staffMention.trim() !== "") {
        const allowedMentions: MessageMentionOptions = params.mentionRole
          ? mentionRolesToAllowedMentions(
              getValidMentionRoles(params.mentionRole),
            )
          : getInboxMentionAllowedMentions();

        await postNonLogMessage(db, newThread, {
          content: staffMention,
          allowedMentions,
        });
      }
    }

    await sendInfoHeader(db, newThread, user, userGuildData);

    return newThread;
  };

    // Guild member info
    for (const [_guildId, guildData] of userGuildData.entries()) {
      const nickname =
        guildData.member.nickname || config.useDisplaynames
          ? guildData.member.user.globalName
          : guildData.member.user.username;

      const headerItems = [
        {
          name: "Display Name",
          value: escapeMarkdown(nickname || guildData.member.user.username),
        },
      ];

      if (guildData.member.voice.channelId && !muteStatus) {
        const voiceChannel =
          guildData.member?.voice?.channel?.name || "unknown";

        headerItems.push({
          name: "Voice Channel",
          value: escapeMarkdown(voiceChannel),
        });
      }

      const member = await guildData.member.fetch();
      if (member.roles.cache.size > 0) {
        headerItems.push({
          name: "Roles",
          value: guildData.member.roles.cache
            .filter((c) => c.name !== "@everyone")
            .map((r) => r.name)
            .join(", "),
        });
      }

      const headerStr = headerItems
        .map((h) => `${h.name.toUpperCase()} ${h.value}`)
        .join(", ");

      infoHeader += `\n**[${escapeMarkdown(guildData.guild.name)}]** ${headerStr}`;
    }

    const userLogCount = await getUserThreadsClosedCount(
      this.db,
      this.user_id,
      this.created_at,
    );

    embed.setTitle(`Thread #${userLogCount + 1} with ${user.username}`);

    if (userLogCount > 0) {
      infoHeader += `\n\nThis user has **${userLogCount}** previous modmail threads. Use \`${config.prefix}logs\` to see them.`;
    }

    const userNotes = await findNotesByUserId(user.id);
    if (userNotes.length) {
      infoHeader += `\n\nThis user has **${userNotes.length}** notes. Use \`${config.prefix}notes\` to see them.`;
    }

    if (userLogCount > 0) {
      const mostRecentThread = await getLastClosedThreadByUser(
        this.db,
        user.id,
      );

      if (mostRecentThread) {
        mostRecentThread.log_storage_type = "local";
        const mostRecentLog = await getLogUrl(mostRecentThread);

        embed.setDescription(
          `${userLogCount} previous thread${userLogCount === 1 ? `` : "s"} [(view last)](${mostRecentLog})`,
        );
      }
    } else {
      embed.setDescription("No previous threads");
    }

    if (muteStatus) {
      embed.setColor(Colours.MuteRed as HexColorString);
      const lastField = fields.at(-1);
      if (lastField) lastField.value += `\n-# ${separator(20)}`;

      fields.push({
        name: `${Emoji.Muted} **User is currently muted**\n`,
        value: "",
        inline: false,
      });
    }

    if (userBanned) {
      embed.setColor(Colours.BanRed as HexColorString);

      fields.push(
        {
          name: `${user.displayName}`,
          value: `\n-# ${separator(20)}`,
          inline: false,
        },
        {
          name: `${Emoji.Banned} **User is currently banned**\n`,
          value: "",
          inline: false,
        },
      );
    }

    embed.setFields(fields);
    infoHeader += "\n────────────────";

    const message = await (await this.getThreadChannel()).send({
      content: "",
      embeds: [embed],
    });

    await new ThreadMessage({
      thread_id: this.id,
      message_type: ThreadMessageType.System,
      user_id: undefined,
      user_name: "",
      body: infoHeader,
      metadata: {
        embeds: [embed],
      },
      inbox_message_id: message.id,
      is_anonymous: false,
    }).saveToDb(this.db);

    return !!message;
  }

  public async getCloseEmbed(closer_id: string): Promise<EmbedBuilder | null> {
    const user = await bot.users.fetch(this.user_id);
    if (!user) return null;

    const author =
      getInboxGuild().members.cache.get(closer_id) ||
      (await getInboxGuild().members.fetch(closer_id));
    if (!author) return null;

    const msgStats = await getThreadMessageStats(this.db, this.id);
    if (!msgStats) return null;

    const staffReplyData = await getThreadStaffReplyCounts(this.db, this.id);
    let staffReplies: Array<string> = [];
    if (staffReplyData)
      staffReplies = await Promise.all(
        staffReplyData.map(async (reply) => {
          const registeredName = await getRegisteredUsername(
            this.db,
            reply.user_id,
          );
          const username = await (async () => {
            if (!registeredName)
              return (await bot.users.fetch(reply.user_id)).username;

            return registeredName;
          })();

          return `${username} (${reply.msg_count})`;
        }),
      );

    const embed = new EmbedBuilder();
    const threadNumber = await getUserThreadsClosedCount(
      this.db,
      user.id,
      this.created_at,
    );
    embed.setTitle(`Thread #${threadNumber} with ${user.username} closed`);
    const roleEmoji = (() => {
      const roleNames = author.roles.cache.map((r) => r.name.toLowerCase());
      if (roleNames.includes("admin")) return Emoji.Roles.Admin;

      if (roleNames.includes("trainee")) return Emoji.Roles.Trainee;

      return Emoji.Roles.Moderator;
    })();

    embed.setDescription(
      `-# \`${user.id}\`${Spacing.Doublespace}•${Spacing.Doublespace}Closed by ${roleEmoji} ${(await getRegisteredUsername(this.db, author.id)) || author.user.username}${Spacing.Doublespace}•${Spacing.Doublespace}[(View log)](${await this.logUrl()})\n`,
    );
    embed.setColor(Colours.BanRed as HexColorString);

    embed.addFields([
      {
        name: "Total Messages",
        value: `-# **${msgStats.received}** User, **${msgStats.replies}** Replies, **${msgStats.internal}** Internal`,
        inline: true,
      },
      {
        name: `Participants`,
        value: `-# ${staffReplies.length > 0 ? staffReplies.join(", ") : "None"}`,
        inline: true,
      },
    ]);

    return embed;
  }

  public async logUrl(): Promise<string> {
    return await getSelfUrl(`logs/${this.id}`);
  }
}

/*
 * Utils
 **/

// Format usernames for use as channel names. Removes all non-alphanumeric characters,
// replaces full-stops with a special character we spoof, and replaces spaces with hyphens.
export function formatUsernameForChannel(inputName: string): string {
  let channelName = String(inputName)
    .normalize("NFKD") // split accented characters into their base characters and diacritical marks
    .replace(/[\u0300-\u036f]/g, "") // remove all the accents, which happen to be all in the \u03xx UNICODE block.
    .replace(/\./g, UnicodePeriod) // Replace fullstops with a unicode character that is supported in channel names
    .trim() // trim leading or trailing whitespace
    .toLowerCase() // convert to lowercase
    .replace(/[^a-z0-9 _․]/g, "") // remove non-alphanumeric characters
    .replace(/\s+/g, "_"); // replace spaces with hyphens

  if (channelName === "") channelName = "unknown";

  return channelName;
}
