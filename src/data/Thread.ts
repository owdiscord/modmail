import {
  ChannelType,
  type DiscordAPIError,
  type Guild,
  type GuildMember,
  type Message,
  type MessageMentionOptions,
  type TextChannel,
  type User,
} from "discord.js";
import config from "../config";
import type { DbQuery } from "../db";
import {
  type BeforeNewThreadHookResult,
  callBeforeNewThreadHooks,
} from "../hooks/beforeNewThread";
import logger from "../logger";
import type { SerialQueue } from "../queue.ts";
import {
  create,
  findOpenThreadByUserID,
  findThreadByID,
} from "../repositories/threads.ts";
import {
  getInboxGuild,
  getInboxMention,
  getInboxMentionAllowedMentions,
  getMainGuilds,
  getValidMentionRoles,
  mentionRolesToAllowedMentions,
  mentionRolesToMention,
  readMultilineConfigValue,
} from "../utils.ts";
import { ThreadStatus } from "./constants.ts";
import { postNonLogMessage, sendInfoHeader } from "../thread.ts";
import { UnicodePeriod } from "../style.ts";

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

    const existingThread = (await findOpenThreadByUserID(db, user.id))[0];

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

    // Save the new thread in the database
    const newThreadId = await create(db, {
      status: ThreadStatus.Open,
      user_id: user.id,
      user_name: user.username,
      channel_id: createdChannel.id,
      next_message_number: 1,
      created_at: new Date(),
      thread_number: 0,
      alert_ids: "",
      log_storage_type: "local",
      log_storage_data: {},
      metadata: {},
      roles:
        userGuildData
          .get(config.overwatchGuildId)
          ?.member.roles.cache.map((r) => r.name) || [],
      server_join: serverJoin || new Date(),
    });

    const newThreadRow = await findThreadByID(db, newThreadId).catch((err) => {
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

  return queue.enqueue(fn);
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
