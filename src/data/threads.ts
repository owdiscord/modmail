import type { SQL } from "bun";
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
import { v4 } from "uuid";
import config from "../config";
import {
  type BeforeNewThreadHookResult,
  callBeforeNewThreadHooks,
} from "../hooks/beforeNewThread";
import { UnicodePeriod } from "../style";
import {
  getInboxGuild,
  getInboxMention,
  getInboxMentionAllowedMentions,
  getMainGuilds,
  getValidMentionRoles,
  mentionRolesToAllowedMentions,
  mentionRolesToMention,
  readMultilineConfigValue,
} from "../utils";
import { ThreadMessageType, ThreadStatus } from "./constants";
import Thread, { type ThreadProps } from "./Thread";
import ThreadMessage from "./ThreadMessage";

let threadCreationQueue: Promise<unknown> = Promise.resolve();

export function _addToThreadCreationQueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = threadCreationQueue.then(fn, fn);
  threadCreationQueue = next.catch(() => {});
  return next;
}

export async function findById(db: SQL, id: string): Promise<Thread | null> {
  const threads = await db`SELECT * FROM threads WHERE id = ${id}`;

  if (threads && threads.length !== 1) return null;

  return threads && new Thread(db, threads[0]);
}

export async function findByThreadNumber(
  db: SQL,
  threadNumber: number,
): Promise<Thread | null> {
  const threads =
    await db`SELECT * FROM threads WHERE thread_number = ${threadNumber}`;

  if (threads && threads.length !== 0) return null;

  return threads && new Thread(db, threads[0]);
}

export async function findOpenThreadByUserId(
  db: SQL,
  userId: string,
): Promise<Thread | null> {
  const threads =
    await db`SELECT * FROM threads WHERE user_id = ${userId} AND status = ${ThreadStatus.Open}`;

  if (threads && threads.length !== 1) return null;

  return new Thread(db, threads[0]);
}

export type CreateNewThreadForUserOpts = {
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
  db: SQL,
  user: User,
  opts: CreateNewThreadForUserOpts,
): Promise<Thread | null> {
  return _addToThreadCreationQueue(async (): Promise<Thread | null> => {
    const quiet = opts.quiet != null ? opts.quiet : false;
    const ignoreRequirements =
      opts.ignoreRequirements != null ? opts.ignoreRequirements : false;
    const ignoreHooks = opts.ignoreHooks != null ? opts.ignoreHooks : false;

    const existingThread = await findOpenThreadByUserId(db, user.id);
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
          const accountAgeDeniedMessage = readMultilineConfigValue(
            config.requirements.accountAgeDeniedMessage,
          );
          const privateChannel = user.dmChannel;
          if (privateChannel) {
            await privateChannel.send(accountAgeDeniedMessage);
          }
        }
        return null;
      }
    }

    // Use the user's name for the thread channel's name
    // Channel names are particularly picky about what characters they allow, so we gotta do some clean-up
    let channelName = formatUsername(user.username);

    // if (config.anonymizeChannelName) {
    //   channelName = createHash("md5")
    //     .update(channelName + Date.now())
    //     .digest("hex")
    //     .slice(0, 12);
    // }

    opts.channelName = channelName;

    let hookResult: BeforeNewThreadHookResult | undefined;
    if (!ignoreHooks) {
      // Call any registered beforeNewThreadHooks
      hookResult = await callBeforeNewThreadHooks({
        user,
        opts,
        message: opts.message,
      });
      if (hookResult.cancelled) return null;
    }

    console.log(`[NOTE] Creating new thread channel ${opts.channelName}`);

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

        if (member) {
          userGuildData.set(guild.id, { guild, member });
        }
      } catch (e: unknown) {
        // We can safely discard this error, because it just means we couldn't find the member in the guild
        // Which - for obvious reasons - is completely okay.
        if ((e as DiscordAPIError).code !== 10007) console.log(e);
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

      // Check if the user joined any of the main servers a long enough time ago
      // If we don't see this user on any of the main guilds (the size check below), assume we're just missing some data and give the user the benefit of the doubt
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

          await user.send(timeOnServerDeniedMessage);
        }

        return null;
      }
    }

    // Figure out which category we should place the thread channel in
    let newThreadCategoryId = hookResult?.categoryId || opts.categoryId || null;

    if (!newThreadCategoryId && config.automation.newThreadCategory) {
      // Categories for specific source guilds (in case of multiple main guilds)
      for (const { guild, category } of config.automation.newThreadCategory) {
        if (userGuildData.has(guild)) {
          newThreadCategoryId = category;
          break;
        }
      }
    }

    if (!newThreadCategoryId && config.automation.defaultCategory)
      newThreadCategoryId = config.automation.defaultCategory;

    // Attempt to create the inbox channel for this thread
    let createdChannel: TextChannel | undefined;
    try {
      createdChannel = await getInboxGuild().channels.create({
        name: opts.channelName,
        type: ChannelType.GuildText,
        parent: newThreadCategoryId,
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
        createdChannel = await getInboxGuild().channels.create({
          name: replacedChannelName,
          type: ChannelType.GuildText,
          reason: "New Modmail thread",
          parent: newThreadCategoryId,
        });
      }

      if (!createdChannel || !createdChannel.id) {
        throw err;
      }
    }

    // Save the new thread in the database
    const newThreadId = await createThreadInDB(db, {
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
      metadata: "{}",
      roles:
        userGuildData
          .get(config.overwatchGuildId)
          ?.member.roles.cache.map((r) => r.name) || [],
      server_join: serverJoin || new Date(),
    });

    const newThread = await findById(db, newThreadId);
    if (!newThread) {
      console.error("failed to get a new thread");
      return null;
    }

    if (!quiet) {
      // Ping moderators of the new thread
      const staffMention = opts.mentionRole
        ? mentionRolesToMention(getValidMentionRoles(opts.mentionRole))
        : getInboxMention();

      if (staffMention.trim() !== "") {
        const allowedMentions: MessageMentionOptions = opts.mentionRole
          ? mentionRolesToAllowedMentions(
              getValidMentionRoles(opts.mentionRole),
            )
          : getInboxMentionAllowedMentions();

        await newThread.postNonLogMessage({
          content: staffMention,
          allowedMentions,
        });
      }
    }

    await newThread.sendInfoHeader(user, userGuildData);

    // Return the thread
    return newThread;
  });
}

export async function createThreadInDB(
  db: SQL,
  data: Omit<ThreadProps, "id">,
): Promise<string> {
  const id = v4();
  data.created_at = new Date();
  data.thread_number = null;

  await db`INSERT INTO threads ${db({ ...data, id, is_legacy: false })}`;

  return id;
}

/**
 * Notably, this function _also_ impacts thread messages, resetting every reference to the thread id.
 */
export async function resetThreadId(db: SQL, fromId: string): Promise<string> {
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

export async function findByChannelId(
  db: SQL,
  channelId: string,
): Promise<Thread | null> {
  const thread =
    await db`SELECT * FROM threads WHERE channel_id = ${channelId}`;

  if (thread?.[0]) return new Thread(db, thread[0]);

  return null;
}

export async function findOpenThreadByChannelId(
  db: SQL,
  channelId: string,
): Promise<Thread | null> {
  const thread =
    await db`SELECT * FROM threads WHERE channel_id = ${channelId} AND status = ${ThreadStatus.Open}`;

  if (thread?.[0]) return new Thread(db, thread[0]);

  return null;
}

export async function findSuspendedThreadByChannelId(
  db: SQL,
  channelId: string,
): Promise<Thread | null> {
  const thread =
    await db`SELECT * FROM threads WHERE channel_id = ${channelId} AND status = ${ThreadStatus.Suspended}`;

  if (thread?.[0]) return new Thread(db, thread[0]);

  return null;
}

export async function getClosedThreadsByUserId(
  db: SQL,
  userId: string,
  page = 1,
  limit = 10,
): Promise<Thread[]> {
  const threads =
    await db`SELECT * FROM threads WHERE user_id = ${userId} AND status = ${ThreadStatus.Closed} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

  if (threads)
    return threads.map((thread: ThreadProps) => new Thread(db, thread));

  throw "[getClosedThreadsByUserId] could not retrieve thread";
}

export async function getClosedThreadCountByUserId(
  db: SQL,
  userId: string,
): Promise<number> {
  const [{ thread_count }] =
    await db`SELECT COUNT(id) AS thread_count FROM threads WHERE status = ${ThreadStatus.Closed} AND user_id = ${userId}`;

  return thread_count;
}

export async function findOrCreateThreadForUser(
  db: SQL,
  user: User,
  opts: CreateNewThreadForUserOpts,
): Promise<Thread | null> {
  const existingThread = await findOpenThreadByUserId(db, user.id);
  if (existingThread) return existingThread;

  return createNewThreadForUser(db, user, opts);
}

export async function getThreadsThatShouldBeClosed(
  db: SQL,
): Promise<Array<Thread>> {
  const threads =
    await db`SELECT * FROM threads WHERE status = ${ThreadStatus.Open} AND scheduled_close_at IS NOT NULL AND scheduled_close_at <= now()`;

  return threads.map((thread: ThreadProps) => new Thread(db, thread));
}

export async function getThreadsThatShouldBeSuspended(db: SQL) {
  try {
    const threads =
      await db`SELECT * FROM threads WHERE status = ${ThreadStatus.Open} AND scheduled_suspend_at IS NOT NULL AND scheduled_suspend_at <= now()`;

    return threads.map((thread: ThreadProps) => new Thread(db, thread));
  } catch (e) {
    throw new Error(
      `[getAllOpenThreads@threads.ts:516] failed to get threads that should be suspended: ${e}`,
    );
  }
}

export async function getAllOpenThreads(db: SQL): Promise<Thread[]> {
  try {
    const threads =
      await db`SELECT * FROM threads WHERE status = ${ThreadStatus.Open}`;

    return threads.map((thread: ThreadProps) => new Thread(db, thread));
  } catch (e) {
    throw new Error(
      `[getAllOpenThreads@threads.ts:531] failed to get open threads: ${e}`,
    );
  }
}

export async function findThreadMessageByDMMessageId(
  db: SQL,
  dmMessageId: string,
): Promise<ThreadMessage | null> {
  const message =
    await db`SELECT * FROM thread_messages WHERE dm_message_id = ${dmMessageId}`;

  if (message?.[0]) return new ThreadMessage(message[0]);

  return null;
}

export async function findThreadLogByChannelID(
  db: SQL,
  channel_id: string,
): Promise<{ thread_id: string; channel_id: string; name: string }> {
  const thread =
    await db`SELECT id, user_name FROM threads WHERE channel_id = ${channel_id}`;

  if (thread && thread.length === 1)
    return { thread_id: thread[0].id, channel_id, name: thread[0].user_name };

  throw "could not find a log for that thread";
}

export async function getNextThreadMessageNumber(
  db: SQL,
  thread_id: string,
): Promise<number> {
  const rows =
    await db`SELECT COUNT(*) + 1 as count FROM thread_messages WHERE thread_id = ${thread_id} AND message_type = ${ThreadMessageType.ToUser}`;
  if (rows && rows.length === 1) return rows[0].count;

  return 1;
}

export async function getThreadByNumber(
  db: SQL,
  thread_number: number,
): Promise<Thread | null> {
  const threads =
    await db`SELECT * FROM threads WHERE thread_number = ${thread_number} LIMIT 1`;

  if (threads && threads.length === 1) return new Thread(db, threads[0]);

  return null;
}

export async function getThreadById(
  db: SQL,
  id: string,
): Promise<Thread | null> {
  const threads = await db`SELECT * FROM threads WHERE id = ${id} LIMIT 1`;

  if (threads && threads.length === 1) return new Thread(db, threads[0]);

  return null;
}

export async function getLastClosedThreadByUser(
  db: SQL,
  user_id: string,
): Promise<Thread | null> {
  const threads =
    await db`SELECT * FROM threads WHERE user_id = ${user_id} AND status = ${ThreadStatus.Closed} ORDER BY created_at DESC LIMIT 1`;

  if (threads && threads.length === 1) return new Thread(db, threads[0]);

  return null;
}

export type ThreadMessageStats = {
  received: number;
  replies: number;
  internal: number;
};

export async function getThreadMessageStats(
  db: SQL,
  thread_id: string,
): Promise<ThreadMessageStats | null> {
  const result = await db<
    Array<{ message_type: ThreadMessageType; msg_count: number }>
  >`
SELECT message_type, COUNT(*) msg_count FROM thread_messages WHERE thread_id = ${thread_id} GROUP BY message_type ORDER BY msg_count;`;

  if (result && result.length > 1) {
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

  return null;
}

export async function getThreadStaffReplyCounts(
  db: SQL,
  thread_id: string,
): Promise<null | Array<{ user_id: string; msg_count: number }>> {
  const result = await db<
    Array<{ user_id: string; msg_count: number }>
  >`SELECT user_id, COUNT(*) msg_count FROM thread_messages WHERE thread_id = ${thread_id} AND message_type = ${ThreadMessageType.ToUser} GROUP BY user_id ORDER BY msg_count DESC`;

  if (result) return result;

  return null;
}

export async function getUserThreadNumber(
  db: SQL,
  user_id: string,
  created_time: Date,
): Promise<number> {
  const result = await db<
    Array<{ count: number }>
  >`SELECT COUNT(*) count FROM threads WHERE user_id = ${user_id} AND created_at <= ${created_time}`;

  if (result && result.length === 1) return result[0]?.count || 1;

  return 1;
}

export function formatUsername(inputName: string): string {
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
