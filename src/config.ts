import { PermissionFlagsBits, type Snowflake } from "discord.js";
import { parse } from "smol-toml";

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  timezone?: string;
}

export type ModmailConfig = {
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
  allowNotes: boolean;
  allowMove: boolean;
  allowBlock: boolean;
  allowSuspend: boolean;
  allowSnippets: boolean;
  allowStaffEdit: boolean;
  allowStaffDelete: boolean;
  allowChangingDisplayRole: boolean;
  syncPermissionsOnMove: boolean;
  typingProxyToInbox: boolean;
  typingProxyToUser: boolean;
  pingOnBotMention: boolean;
  inboxPermissions: Array<typeof PermissionFlagsBits | Snowflake>;
  automation: {
    defaultCategory: Snowflake;
    newThreadCategory: Array<{ guild: Snowflake; category: Snowflake }>;
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
  showResponseMessageInInbox: boolean;
  overwatchGuildId: string;
  banGuildId: string;
  allowInlineSnippets: boolean;
  inlineSnippetStart: string;
  inlineSnippetEnd: string;
  relayInlineReplies: boolean;
  autoAlert: boolean;
  autoAlertDelay: string;
  errorOnUnknownInlineSnippet: boolean;
  useDisplaynames: boolean;
  notifyOnMainServerLeave: boolean;
  notifyOnMainServerJoin: boolean;
  fallbackRoleName: string;
  threadTimestamps: boolean;
  useNicknames: boolean;
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
  allowNotes: true,
  allowMove: true,
  allowBlock: true,
  allowSuspend: true,
  allowSnippets: true,
  allowStaffEdit: true,
  allowStaffDelete: true,
  allowInlineSnippets: false,
  allowChangingDisplayRole: true,
  syncPermissionsOnMove: true,
  typingProxyToInbox: true,
  typingProxyToUser: false,
  pingOnBotMention: false,
  inboxPermissions: [],
  automation: {
    defaultCategory: "360863035130249235",
    newThreadCategory: [],
  },
  requirements: {
    accountAge: 0,
    accountAgeDeniedMessage: "",
    timeOnServer: 0,
    timeOnServerDeniedMessage: "",
  },
  showResponseMessageInInbox: true,
  overwatchGuildId: "94882524378968064",
  banGuildId: "587215460127473703",
  inlineSnippetStart: "{{",
  inlineSnippetEnd: "}}",
  relayInlineReplies: true,
  autoAlert: false,
  autoAlertDelay: "2m",
  errorOnUnknownInlineSnippet: true,
  useDisplaynames: true,
  notifyOnMainServerLeave: true,
  notifyOnMainServerJoin: true,
  fallbackRoleName: "Moderator",
  threadTimestamps: false,
  useNicknames: false,
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

function deepAssign<T extends Record<string, any>>(
  target: T,
  source: Partial<T>,
): void {
  for (const key in source) {
    const value = source[key];

    if (value === undefined) continue;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      if (typeof target[key] !== "object" || target[key] === null) {
        // @ts-expect-error – safe structural overwrite
        target[key] = {};
      }

      deepAssign(target[key], value);
    } else {
      // @ts-expect-error – structural assignment
      target[key] = value;
    }
  }
}

async function loadConfig() {
  const raw = parse(
    await Bun.file("config.toml").text(),
  ) as Partial<ModmailConfig>;

  // required fields
  if (raw.mainServers === undefined)
    throw new Error("Missing required field: mainServers");

  if (raw.inboxServer === undefined)
    throw new Error("Missing required field: inboxServer");

  if (raw.logChannel === undefined)
    throw new Error("Missing required field: logChannel");

  deepAssign(config, raw);

  config.mainServers = raw.mainServers as Snowflake[];
  config.inboxServer = raw.inboxServer as Snowflake;
  config.logChannel = raw.logChannel as Snowflake;
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
