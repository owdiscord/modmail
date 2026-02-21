import {
  type Attachment,
  type AttachmentBuilder,
  type Channel,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  Message,
  type MessageCreateOptions,
  type MessageMentionOptions,
  type MessageMentionTypes,
  type PermissionsBitField,
  type Role,
  type SendableChannels,
  type Snowflake,
  type TextChannel,
} from "discord.js";
import humanizeDuration from "humanize-duration";
import { publicIp } from "public-ip";
import { BotError } from "./BotError";
import bot from "./bot";
import config from "./config";
import type Thread from "./data/Thread";

const userMentionRegex = /^<@!?([0-9]+?)>$/;

let inboxGuild: Guild | undefined;
let mainGuilds: Array<Guild> = [];

export function getInboxGuild(): Guild {
  if (!inboxGuild)
    inboxGuild = bot.guilds.cache.find((g) => g.id === config.inboxServer);
  if (!inboxGuild) throw new BotError("The bot is not on the inbox server!");
  return inboxGuild;
}

export function getMainGuilds(): Array<Guild> {
  if (mainGuilds.length === 0) {
    mainGuilds = Array.from(bot.guilds.cache.values()).filter((g) =>
      (config.mainServers || "").includes(g.id),
    );
  }

  if (mainGuilds.length !== config.mainServers.length) {
    if (config.mainServers.length === 1) {
      console.warn("[WARN] The bot hasn't joined the main guild!");
    } else {
      console.warn("[WARN] The bot hasn't joined one or more main guilds!");
    }
  }

  return mainGuilds;
}

export async function getLogChannel(): Promise<TextChannel> {
  const _inboxGuild = getInboxGuild();
  const _logChannel = await _inboxGuild.channels.fetch(config.logChannel || "");

  if (!_logChannel) {
    throw new BotError("Log channel (logChannelId) not found!");
  }

  if (
    !_logChannel.isTextBased() ||
    _logChannel.type !== ChannelType.GuildText
  ) {
    throw new BotError(
      "Make sure the logChannelId option is set to a text channel!",
    );
  }

  return _logChannel as TextChannel;
}

export function postLog(
  content: MessageCreateOptions | string,
  files?: Array<AttachmentBuilder>,
) {
  const messageOptions =
    typeof content === "string" ? { content, files } : { ...content, files };

  getLogChannel().then((channel) => {
    channel.send(messageOptions);
  });
}

export function postError(channel: Channel, content: string, opts = {}) {
  console.error(`(ERROR) ${content}`);

  if (channel && channel.isSendable()) {
    return channel.send({
      ...opts,
      content: `❌ ${content}`,
    });
  }
}

export function isStaff(member: GuildMember | null): boolean {
  if (!member) return false;
  if (config.inboxPermissions.length === 0) return true;
  if (member.guild.ownerId === member.id) return true;

  return (config.inboxPermissions || []).some((perm) => {
    if (isSnowflake(perm as string)) {
      // If perm is a snowflake, check it against the member's user id and roles
      if (member.id === perm) return true;
      if (member.roles.cache.has(perm as string)) return true;
    } else {
      // Otherwise assume perm is the name of a permission
      return member.permissions.has(
        perm as keyof typeof PermissionsBitField.Flags,
      );
    }

    return false;
  });
}

export async function messageIsOnInboxServer(msg: Message): Promise<boolean> {
  const channel = msg.channel;
  if (!channel || !("guild" in channel) || !channel.guild) return false;
  if (channel.guild.id !== getInboxGuild().id) return false;

  return true;
}

export async function messageIsOnMainServer(msg: Message): Promise<boolean> {
  const channel = msg.channel;
  if (!channel || !("guild" in channel) || !channel.guild) return false;

  return channel.guild.id === config.overwatchGuildId;
}

export async function formatAttachment(
  attachment: Attachment,
  attachmentUrl: string,
): Promise<string> {
  let filesize = attachment.size || 0;
  filesize /= 1024;

  return `**Attachment:** ${attachment.name} (${filesize.toFixed(1)}KB)\n${attachmentUrl}`;
}

export function getUserMention(str: string): string | null {
  if (!str) return null;

  str = str.trim();

  if (isSnowflake(str)) {
    // User ID
    return str;
  } else {
    const mentionMatch = str.match(userMentionRegex);
    if (mentionMatch) return mentionMatch[1] || null;
  }

  return null;
}

export function getTimestamp(input: Date, _strict = false): string {
  const hours = input.getHours().toString().padStart(2, "0");
  const minutes = input.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function disableLinkPreviews(str: string): string {
  return str.replace(/(^|[^<])(https?:\/\/\S+)/gi, "$1<$2>");
}

let cachedIpPromise: Promise<string> | null = null;

export async function getSelfIp(): Promise<string> {
  if (!cachedIpPromise) {
    cachedIpPromise = publicIp({ timeout: 1000 }).catch((err) => {
      console.warn(`Error while fetching public ip: ${err}`);
      return "UNKNOWN";
    });
  }

  if (cachedIpPromise === null) {
    return Promise.resolve("");
  }

  return cachedIpPromise;
}

export async function getSelfUrl(path: string = ""): Promise<string> {
  if (config.web.url) {
    if (path.charAt(0) === "/") path = path.substring(1);
    return `${config.web.url}/${path}`;
  } else {
    const port = config.web.port || 8890;
    const ip = await getSelfIp();
    return `http://${ip}:${port}/${path}`;
  }
}

export function getMainRole(member: GuildMember): Role | undefined {
  const roles = Array.from(member.roles.cache.values());
  roles.sort((a: Role, b: Role) => {
    return a.position > b.position ? -1 : 1;
  });

  return roles.find((r) => r.hoist);
}

/**
 * Splits array items into chunks of the specified size
 */
export function chunk<T>(items: Array<T>, chunkSize: number): Array<Array<T>> {
  const result: Array<Array<T>> = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }

  return result;
}

/**
 * Trims every line in the string
 * @param {String} str
 * @returns {String}
 */
export function trimAll(str: string): string {
  return str
    .split("\n")
    .map((_str) => _str.trim())
    .join("\n");
}

/**
 * @param {string|string[]} mentionRoles
 * @returns {string[]}
 */
export function getValidMentionRoles(
  mentionRoles: string | string[],
): string[] {
  if (!Array.isArray(mentionRoles)) {
    mentionRoles = [mentionRoles];
  }

  return mentionRoles.filter((roleStr) => {
    return (
      roleStr !== null &&
      roleStr !== "none" &&
      roleStr !== "off" &&
      roleStr !== ""
    );
  });
}

/**
 * @param {string[]} mentionRoles
 * @returns {string}
 */
export function mentionRolesToMention(mentionRoles: string[]): string {
  const mentions: Array<string> = [];
  for (const role of mentionRoles) {
    if (role === "here") mentions.push("@here");
    else if (role === "everyone") mentions.push("@everyone");
    else mentions.push(`<@&${role}>`);
  }
  return `${mentions.join(" ")} `;
}

/**
 * @returns {string}
 */
export function getInboxMention(): string {
  const mentionRoles = getValidMentionRoles(config.mentionRoles || []);
  return mentionRolesToMention(mentionRoles);
}

export function mentionRolesToAllowedMentions(
  mentionRoles: string[],
): MessageMentionOptions {
  const allowedMentions = {
    parse: [] as MessageMentionTypes[],
    roles: [] as Snowflake[],
    users: [],
    repliedUser: false,
  };

  for (const role of mentionRoles) {
    if (role === "here" || role === "everyone") {
      allowedMentions.parse.push("everyone");
    } else {
      allowedMentions.parse.push("roles");
      allowedMentions.roles.push(role);
    }
  }

  return allowedMentions;
}

export function getInboxMentionAllowedMentions(): MessageMentionOptions {
  const mentionRoles = getValidMentionRoles(config.mentionRoles || []);
  return mentionRolesToAllowedMentions(mentionRoles);
}

export function postSystemMessageWithFallback(
  channel: SendableChannels,
  thread: Thread | null = null,
  text: string,
) {
  if (thread) {
    thread.postSystemMessage(text);
    return;
  }

  channel.send(text);
}

export function isSnowflake(str: string) {
  return /^[0-9]{17,}$/.test(str);
}

export const humanizeDelay = (delay: number, opts = {}) =>
  humanizeDuration(delay, Object.assign({ conjunction: " and " }, opts));

export function escapeMarkdown(str: string) {
  return str.replace(/([\\_*|`~])/g, "\\$1");
}

export function disableInlineCode(str: string) {
  return str.replace(/`/g, "'");
}

export function disableCodeBlocks(str: string) {
  return str.replace(/`/g, "`\u200b");
}

export function readMultilineConfigValue(str: Array<string> | string) {
  return Array.isArray(str) ? str.join("\n") : str;
}

// ()' '•)
export function noop() {}

// https://discord.com/developers/docs/resources/channel#create-message-params
const MAX_MESSAGE_CONTENT_LENGTH = 2000;

// https://discord.com/developers/docs/resources/channel#embed-limits
const MAX_EMBED_CONTENT_LENGTH = 6000;

export function messageContentIsWithinMaxLength(
  content: string | MessageCreateOptions,
) {
  const check = {
    content: "",
  };

  if (typeof content === "string") {
    check.content = content;
  }

  if (check.content && check.content.length > MAX_MESSAGE_CONTENT_LENGTH) {
    return false;
  }

  if (content instanceof Message && content.embeds) {
    for (const embed of content.embeds) {
      let embedContentLength = 0;

      // Handle both EmbedBuilder and plain objects
      const embedData = embed instanceof EmbedBuilder ? embed.data : embed;

      if (embedData.title) embedContentLength += embedData.title.length;
      if (embedData.description)
        embedContentLength += embedData.description.length;
      if (embedData.footer?.text) {
        embedContentLength += embedData.footer.text.length;
      }
      if (embedData.author?.name) {
        embedContentLength += embedData.author.name.length;
      }

      if (embedData.fields) {
        for (const field of embedData.fields) {
          if (field.name) embedContentLength += field.name.length;
          if (field.value) embedContentLength += field.value.length;
        }
      }

      if (embedContentLength > MAX_EMBED_CONTENT_LENGTH) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Splits a string into chunks, preferring to split at a newline
 * @param {string} str
 * @param {number} [maxChunkLength=2000]
 * @returns {string[]}
 */
export function chunkByLines(
  str: string,
  maxChunkLength: number = 2000,
): string[] {
  if (str.length < maxChunkLength) {
    return [str];
  }

  const chunks = [];

  while (str.length) {
    if (str.length <= maxChunkLength) {
      chunks.push(str);
      break;
    }

    const slice = str.slice(0, maxChunkLength);

    const lastLineBreakIndex = slice.lastIndexOf("\n");
    if (lastLineBreakIndex === -1) {
      chunks.push(str.slice(0, maxChunkLength));
      str = str.slice(maxChunkLength);
    } else {
      chunks.push(str.slice(0, lastLineBreakIndex));
      str = str.slice(lastLineBreakIndex + 1);
    }
  }

  return chunks;
}

/**
 * Chunks a long message to multiple smaller messages, retaining leading and trailing line breaks, open code blocks, etc.
 *
 * Default maxChunkLength is 1990, a bit under the message length limit of 2000, so we have space to add code block
 * shenanigans to the start/end when needed. Take this into account when choosing a custom maxChunkLength as well.
 */
export function chunkMessageLines(str: string, maxChunkLength = 1990) {
  const chunks = chunkByLines(str, maxChunkLength);
  let openCodeBlock = false;

  return chunks.map((_chunk) => {
    // If the chunk starts with a newline, add an invisible unicode char so Discord doesn't strip it away
    if (_chunk[0] === "\n") _chunk = `\u200b${_chunk}`;
    // If the chunk ends with a newline, add an invisible unicode char so Discord doesn't strip it away
    if (_chunk[_chunk.length - 1] === "\n") _chunk = `${_chunk}\u200b`;
    // If the previous chunk had an open code block, open it here again
    if (openCodeBlock) {
      openCodeBlock = false;
      if (_chunk.startsWith("```")) {
        // Edge case: chunk starts with a code block delimiter, e.g. the previous chunk and this one were split right before the end of a code block
        // Fix: just strip the code block delimiter away from here, we don't need it anymore
        _chunk = _chunk.slice(3);
      } else {
        _chunk = `\`\`\`${_chunk}`;
      }
    }
    // If the chunk has an open code block, close it and open it again in the next chunk
    const codeBlockDelimiters = _chunk.match(/```/g);
    if (codeBlockDelimiters && codeBlockDelimiters.length % 2 !== 0) {
      _chunk += "```";
      openCodeBlock = true;
    }

    return _chunk;
  });
}

export function slugify(from: string): string {
  return String(from)
    .normalize("NFKD") // split accented characters into their base characters and diacritical marks
    .replace(/[\u0300-\u036f]/g, "") // remove all the accents, which happen to be all in the \u03xx UNICODE block.
    .trim() // trim leading or trailing whitespace
    .toLowerCase() // convert to lowercase
    .replace(/[^a-z0-9 -]/g, "") // remove non-alphanumeric characters
    .replace(/\s+/g, "-") // replace spaces with hyphens
    .replace(/-+/g, "-"); // remove consecutive hyphens
}

export const START_CODEBLOCK = "```";
export const END_CODEBLOCK = "```";
