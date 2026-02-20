// import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { DiscordAPIError, type Snowflake } from "discord.js";
import { parse } from "smol-toml";
import schema from "./data/cfg.schema.json";

type ActivityType = "playing" | "watching" | "listening" | "streaming";

// type AttachmentStorage = "original" | "local" | "discord";
// type LogStorage = "local" | "attachment" | "none";

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  timezone?: string;
}

// interface LogOptions {
//   attachmentDirectory: string;
//   allowAttachmentUrlFallback?: boolean;
// }

// interface CategoryAutomation {
//   newThread?: string;
//   newThreadFromServer?: Record<string, string>;
//   newThreadFromGuild?: Record<string, string>;
// }

// export interface ModmailConfig {
//   token: string;
//   mainServerId: string[];
//   inboxServerId: string;
//   logChannelId: string;
//   mainGuildId?: string[];
//   mailGuildId?: string;
//   prefix: string;
//   snippetPrefix: string;
//   snippetPrefixAnon: string;
//   status?: string;
//   statusType?: ActivityType;
//   statusUrl?: string;
//   responseMessage?: string;
//   closeMessage?: string;
//   allowUserClose?: boolean;
//   newThreadCategoryId?: string;
//   mentionRole?: string[];
//   pingOnBotMention?: boolean;
//   botMentionResponse?: string;
//   inboxServerPermission?: string[];
//   alwaysReply?: boolean;
//   alwaysReplyAnon?: boolean;
//   forceAnon?: boolean;
//   useNicknames?: boolean;
//   useDisplaynames?: boolean;
//   anonymizeChannelName?: boolean;
//   ignoreAccidentalThreads?: boolean;
//   threadTimestamps?: boolean;
//   allowMove?: boolean;
//   syncPermissionsOnMove?: boolean;
//   typingProxy?: boolean;
//   typingProxyReverse?: boolean;
//   mentionUserInThreadHeader?: boolean;
//   rolesInThreadHeader?: boolean;
//   allowStaffEdit?: boolean;
//   allowStaffDelete?: boolean;
//   updateMessagesLive?: boolean;
//   allowBlock?: boolean;
//   allowSuspend?: boolean;
//   allowSnippets?: boolean;
//   enableGreeting?: boolean;
//   greetingMessage?: string;
//   greetingAttachment?: string;
//   serverGreetings?: Record<string, { message?: string; attachment?: string }>;
//   /** Required account age to message Modmail, in hours */
//   requiredAccountAge?: number;
//   accountAgeDeniedMessage?: string;
//   /** Required time on server to message Modmail, in minutes */
//   requiredTimeOnServer?: number;
//   timeOnServerDeniedMessage?: string;
//   relaySmallAttachmentsAsAttachments?: boolean;
//   /** Max size of attachment to relay directly. Default is 2MB. */
//   smallAttachmentLimit: number;
//   relayInlineReplies?: boolean;
//   attachmentStorage: AttachmentStorage;
//   attachmentStorageChannelId?: string;
//   categoryAutomation?: CategoryAutomation;
//   updateNotifications?: boolean;
//   updateNotificationsForBetaVersions?: boolean;
//   plugins?: string[];
//   commandAliases?: Record<string, string>;
//   reactOnSeen?: boolean;
//   reactOnSeenEmoji?: string;
//   createThreadOnMention?: boolean;
//   blockMessage?: string;
//   timedBlockMessage?: string;
//   unblockMessage?: string;
//   timedUnblockMessage?: string;
//   blockedReply?: string;
//   notifyOnMainServerLeave?: boolean;
//   notifyOnMainServerJoin?: boolean;
//   allowInlineSnippets?: boolean;
//   inlineSnippetStart?: string;
//   inlineSnippetEnd?: string;
//   errorOnUnknownInlineSnippet?: boolean;
//   allowChangingDisplayRole?: boolean;
//   fallbackRoleName?: string;
//   overrideRoleNameDisplay?: string;
//   breakFormattingForNames?: boolean;
//   autoAlert?: boolean;
//   /** Delay before auto-alert kicks in. Uses the same format as timed close; for example 1m30s for 1 minute and 30 seconds. */
//   autoAlertDelay?: string;
//   pinThreadHeader?: boolean;
//   showResponseMessageInThreadChannel?: boolean;
//   allowNotes?: boolean;
//   logStorage?: LogStorage;
//   logOptions?: LogOptions;
//   host?: string;
//   url?: string;
//   useGitForGitHubPlugins?: boolean;
//   extraIntents?: string[];
//   mysqlOptions: DatabaseOptions;
//
//   attachmentDir: string;
//   /* Privately and statically assigned */
//   port: number;
//   dbDir: string;
//   // Only used for migrating data from older Modmail versions
//   logDir: string;
//   banGuildId: string;
//   overwatchGuildId: string;
// }
//

// # Required
// mainServers = [
//   394676747876171796
// ]
// inboxServer = 394676747876171796
// logChannel = 1098587148493525083
//
// # Common settings
// prefix = "!"
// anonPrefix = "!!"
// status = "DM to contact mods"
// responseMessage = "Thank you for your message! Our mod team will reply to you here as soon as possible."
// closeMessage = "Thank you for contacting us, the ticket is now closed. If you need more help, feel free to send us another message!"
// mentionRoles = ["here"]
// alwaysReply = false
// alwaysReplyAnon = false
// rolesInThreadHeader = true
// useNicknames = true
// ignoreAccidentalThreads = true
// allowMove = true
// typingProxyToInbox = true
// typingProxyToUser = false
// pingOnBotMention = false
//
// [automation]
// newThreadCategory = [
//   { server =  394676747876171796, category = 1098587148493525083 }
// ]
//
// [requirements]
// accountAge = 0.166
// accountAgeDeniedMessage = "Your Discord account is not old enough to contact modmail yet"
// timeOnServer = 10
// timeOnServerDeniedMessage = "You haven't been a member of the server for long enough to contact modmail yet"
//
// [web]
// port = "8800"
// url = "http://localhost:8800"
//

type ModmailConfig = {
  secrets: {
    token: Snowflake;
    database: DatabaseConfig;
  };
  mainServers: Array<Snowflake>;
  inboxServer: Snowflake;
  logChannel: Snowflake;
  prefix: string;
  snippetPrefix: string;
  anonSnippetPrefix: string;
  status: string;
  responseMessage: string;
  closeMessage: string;
  mentionRoles: Array<string | Snowflake>;
  alwaysReply: boolean;
  alwaysReplyAnon: boolean;
  ignoreAccidentalThreads: boolean;
  allowMove: boolean;
  typingProxyToInbox: boolean;
  typingProxyToUser: boolean;
  pingOnBotMention: boolean;
  automation: {
    newThreadCategory: Array<{ server: Snowflake; category: Snowflake }>;
  };
  requirements: {
    accountAge: number;
    accountAgeDeniedMessage: string;
    timeOnServer: number;
    timeOnServerDeniedMessage: string;
  };
  web: {
    port: number;
    url: string;
  };
  // TODO: Properlty configure this
  overwatchGuildId: string;
  banGuildId: string;
};

const config: ModmailConfig = {
  secrets: {
    token: "not-set",
    database: {
      host: "localhost",
      port: 3306,
      user: "modmail",
      password: "",
      database: "modmail",
    },
  },
  mainServers: [],
  inboxServer: "requries-config",
  logChannel: "requires-config",
  prefix: "!",
  snippetPrefix: "!!",
  anonSnippetPrefix: "!!!",
  web: {
    url: "http://localhost:8001",
    port: parseInt(process.env.PORT || "8001", 10),
  },
  status: "DM to contact mods",
  responseMessage:
    "Thank you for your message! Our mod team will reply to you here as soon as possible.",
  closeMessage:
    "Thank you for contacting us, the ticket is now closed. If you need more help, feel free to send us another message!",
  mentionRoles: ["here"],
  alwaysReply: false,
  alwaysReplyAnon: false,
  ignoreAccidentalThreads: true,
  allowMove: true,
  typingProxyToInbox: true,
  typingProxyToUser: false,
  pingOnBotMention: false,
  automation: {
    newThreadCategory: [],
  },
  requirements: {
    accountAge: 0,
    accountAgeDeniedMessage: "",
    timeOnServer: 0,
    timeOnServerDeniedMessage: "",
  },
  overwatchGuildId: "94882524378968064",
  banGuildId: "587215460127473703",
};

async function loadSecrets() {
  const raw = parse(await Bun.file("secrets.toml").text());

  const discord = raw.discord as { token: string };
  if (discord === undefined || discord.token === undefined)
    throw new Error("Missing required secret: discord.token");

  config.secrets.token = discord.token;

  const db = raw.database as {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };

  if (
    db === undefined ||
    db.host === undefined ||
    db.port === undefined ||
    db.user === undefined ||
    db.password === undefined ||
    db.database === undefined
  )
    throw new Error(
      "Missing required secrets: [database, database.host, database.port, database.user, database.password]",
    );

  config.secrets.database = db;
}

async function loadConfig() {
  const raw = parse(await Bun.file("config.toml").text());
  if (raw.mainServers === undefined)
    throw new Error("Missing required field: mainServers");
  if (raw.inboxServer === undefined)
    throw new Error("Missing required field: inboxServer");
  if (raw.logChannel === undefined)
    throw new Error("Missing required field: logChannel");

  config.mainServers = raw.mainServers as string[];
  config.inboxServer = raw.inboxServer as string;
  config.logChannel = raw.logChannel as string;

  if (raw.prefix !== undefined) config.prefix = raw.prefix as string;
  if (raw.status !== undefined) config.status = raw.status as string;
  if (raw.responseMessage !== undefined)
    config.responseMessage = raw.responseMessage as string;
  if (raw.closeMessage !== undefined)
    config.closeMessage = raw.closeMessage as string;
  if (raw.mentionRoles !== undefined)
    config.mentionRoles = raw.mentionRoles as string[];
  if (raw.alwaysReply !== undefined)
    config.alwaysReply = raw.alwaysReply as boolean;
  if (raw.alwaysReplyAnon !== undefined)
    config.alwaysReplyAnon = raw.alwaysReplyAnon as boolean;
  if (raw.ignoreAccidentalThreads !== undefined)
    config.ignoreAccidentalThreads = raw.ignoreAccidentalThreads as boolean;
  if (raw.allowMove !== undefined) config.allowMove = raw.allowMove as boolean;
  if (raw.typingProxyToInbox !== undefined)
    config.typingProxyToInbox = raw.typingProxyToInbox as boolean;
  if (raw.typingProxyToUser !== undefined)
    config.typingProxyToUser = raw.typingProxyToUser as boolean;
  if (raw.pingOnBotMention !== undefined)
    config.pingOnBotMention = raw.pingOnBotMention as boolean;
  if (raw.overwatchGuildId !== undefined)
    config.overwatchGuildId = raw.overwatchGuildId as string;
  if (raw.banGuildId !== undefined)
    config.banGuildId = raw.banGuildId as string;

  const req = raw.requirements as Record<string, unknown>;
  if (req !== undefined) {
    if (req.accountAge !== undefined)
      config.requirements.accountAge = req.accountAge as number;
    if (req.accountAgeDeniedMessage !== undefined)
      config.requirements.accountAgeDeniedMessage =
        req.accountAgeDeniedMessage as string;
    if (req.timeOnServer !== undefined)
      config.requirements.timeOnServer = req.timeOnServer as number;
    if (req.timeOnServerDeniedMessage !== undefined)
      config.requirements.timeOnServerDeniedMessage =
        req.timeOnServerDeniedMessage as string;
  }

  const web = raw.web as Record<string, unknown>;
  if (web !== undefined) {
    if (web.port !== undefined) config.web.port = web.port as number;
    if (web.url !== undefined) config.web.url = web.url as string;
  }

  const auto = raw.automation as Record<string, unknown>;
  if (auto !== undefined) {
    if (auto.newThreadCategory !== undefined)
      config.automation.newThreadCategory = auto.newThreadCategory as Array<{
        server: Snowflake;
        category: Snowflake;
      }>;
  }
}

function exitWithConfigurationErrors(errors: Array<string>): void {
  console.error("");
  console.error("NOTE! Issues with configuration:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  console.error("");
  console.error(
    "Please restart the bot after fixing the issues mentioned above.",
  );
  console.error("");

  process.exit(1);
}

if (config.anonSnippetPrefix.length < config.snippetPrefix.length) {
  exitWithConfigurationErrors([
    "The anonymous snippet prefix *must* be longer than the non-anonymous prefix.",
  ]);
}

if (config.web.url.includes("localhost")) {
  config.overwatchGuildId = "394676747876171796";
  config.banGuildId = "281931255052894209";
}

try {
  await loadSecrets();
  await loadConfig();
} catch (e) {
  exitWithConfigurationErrors([`${e}`]);
}

console.log("Configuration ok!");

export default config;
