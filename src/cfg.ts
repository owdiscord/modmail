import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { DiscordAPIError } from "discord.js";
import ini from "ini";
import json5 from "json5";
import yargs from "yargs-parser";
import schema from "./data/cfg.schema.json";

type ActivityType = "playing" | "watching" | "listening" | "streaming";

type AttachmentStorage = "original" | "local" | "discord";

type LogStorage = "local" | "attachment" | "none";

interface MysqlOptions {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
	timezone?: string;
}

interface LogOptions {
	attachmentDirectory: string;
	allowAttachmentUrlFallback?: boolean;
}

interface CategoryAutomation {
	newThread?: string;
	newThreadFromServer?: Record<string, string>;
	newThreadFromGuild?: Record<string, string>;
}

export interface ModmailConfig {
	token: string;
	mainServerId: string[];
	inboxServerId: string;
	logChannelId: string;
	mainGuildId?: string[];
	mailGuildId?: string;
	prefix: string;
	snippetPrefix?: string;
	snippetPrefixAnon?: string;
	status?: string;
	statusType?: ActivityType;
	statusUrl?: string;
	responseMessage?: string;
	closeMessage?: string;
	allowUserClose?: boolean;
	newThreadCategoryId?: string;
	mentionRole?: string[];
	pingOnBotMention?: boolean;
	botMentionResponse?: string;
	inboxServerPermission?: string[];
	alwaysReply?: boolean;
	alwaysReplyAnon?: boolean;
	forceAnon?: boolean;
	useNicknames?: boolean;
	useDisplaynames?: boolean;
	anonymizeChannelName?: boolean;
	ignoreAccidentalThreads?: boolean;
	threadTimestamps?: boolean;
	allowMove?: boolean;
	syncPermissionsOnMove?: boolean;
	typingProxy?: boolean;
	typingProxyReverse?: boolean;
	mentionUserInThreadHeader?: boolean;
	rolesInThreadHeader?: boolean;
	allowStaffEdit?: boolean;
	allowStaffDelete?: boolean;
	updateMessagesLive?: boolean;
	allowBlock?: boolean;
	allowSuspend?: boolean;
	allowSnippets?: boolean;
	enableGreeting?: boolean;
	greetingMessage?: string;
	greetingAttachment?: string;
	serverGreetings?: Record<string, { message?: string; attachment?: string }>;
	/** Required account age to message Modmail, in hours */
	requiredAccountAge?: number;
	accountAgeDeniedMessage?: string;
	/** Required time on server to message Modmail, in minutes */
	requiredTimeOnServer?: number;
	timeOnServerDeniedMessage?: string;
	relaySmallAttachmentsAsAttachments?: boolean;
	/** Max size of attachment to relay directly. Default is 2MB. */
	smallAttachmentLimit: number;
	relayInlineReplies?: boolean;
	attachmentStorage: AttachmentStorage;
	attachmentStorageChannelId?: string;
	categoryAutomation?: CategoryAutomation;
	updateNotifications?: boolean;
	updateNotificationsForBetaVersions?: boolean;
	plugins?: string[];
	commandAliases?: Record<string, string>;
	reactOnSeen?: boolean;
	reactOnSeenEmoji?: string;
	createThreadOnMention?: boolean;
	blockMessage?: string;
	timedBlockMessage?: string;
	unblockMessage?: string;
	timedUnblockMessage?: string;
	blockedReply?: string;
	notifyOnMainServerLeave?: boolean;
	notifyOnMainServerJoin?: boolean;
	allowInlineSnippets?: boolean;
	inlineSnippetStart?: string;
	inlineSnippetEnd?: string;
	errorOnUnknownInlineSnippet?: boolean;
	allowChangingDisplayRole?: boolean;
	fallbackRoleName?: string;
	overrideRoleNameDisplay?: string;
	breakFormattingForNames?: boolean;
	autoAlert?: boolean;
	/** Delay before auto-alert kicks in. Uses the same format as timed close; for example 1m30s for 1 minute and 30 seconds. */
	autoAlertDelay?: string;
	pinThreadHeader?: boolean;
	showResponseMessageInThreadChannel?: boolean;
	allowNotes?: boolean;
	logStorage?: LogStorage;
	logOptions?: LogOptions;
	host?: string;
	url?: string;
	useGitForGitHubPlugins?: boolean;
	extraIntents?: string[];
	mysqlOptions: MysqlOptions;

	attachmentDir: string;
	/* Privately and statically assigned */
	port: number;
	dbDir: string;
	// Only used for migrating data from older Modmail versions
	logDir: string;
	// TODO: Improve how this is stored
	banGuildId: string;
	overwatchGuildId: string;
}

/** @type {ModmailConfig} */
const config: ModmailConfig = {
	mainServerId: [],
	inboxServerId: "Filled by config",
	logChannelId: "Filled by config",
	prefix: "!",
	token: "Filled by config file",
	port: parseInt(process.env.PORT || "8001", 10),
	dbDir: path.join(__dirname, "..", "db"),
	logDir: path.join(__dirname, "..", "logs"),
	attachmentStorage: "local",
	attachmentDir: path.join(__dirname, "..", "attachments"),
	smallAttachmentLimit: 2097152,
	mysqlOptions: {
		host: "localhost",
		port: 3306,
		user: "modmail",
		password: "",
		database: "modmail",
	},
	overwatchGuildId: "94882524378968064",
	banGuildId: "587215460127473703",
};

// Auto-detected config files, in priority order
const configFilesToSearch = [
	"config.ini",
	"config.json",
	"config.json5",
	"config.js",

	// Possible config files when file extensions are hidden
	"config.ini.ini",
	"config.ini.txt",
	"config.json.json",
	"config.json.txt",
	"config.json.ini",
];

let configFileToLoad: string | undefined;

const args = yargs(process.argv.slice(2));
const requestedConfigFile = args.config || args.c;

if (requestedConfigFile) {
	try {
		// Config files specified with --config/-c are loaded from cwd
		fs.accessSync(requestedConfigFile);
		configFileToLoad = requestedConfigFile;
	} catch (e: unknown) {
		if (e instanceof DiscordAPIError && e.code === "ENOENT") {
			console.error(
				`Specified config file was not found: ${requestedConfigFile}`,
			);
		} else {
			const message = e instanceof Error ? e.message : e;
			console.error(
				`Error reading specified config file ${requestedConfigFile}: ${message}`,
			);
		}

		process.exit(1);
	}
} else {
	for (const configFile of configFilesToSearch) {
		try {
			// Auto-detected config files are always loaded from the bot's folder, even if the cwd differs
			const relativePath = path.relative(
				process.cwd(),
				path.resolve(__dirname, "..", configFile),
			);
			fs.accessSync(relativePath);
			configFileToLoad = relativePath;
			break;
		} catch (_e) {}
	}
}

// Load config values from a config file (if any)
if (configFileToLoad) {
	const srcRelativePath = path.resolve(
		__dirname,
		process.cwd(),
		configFileToLoad,
	);
	console.log(`Loading configuration from ${configFileToLoad}...`);

	try {
		const raw = await Bun.file(srcRelativePath).text();
		let decoded: Record<string, unknown> = {};

		if (
			configFileToLoad.endsWith(".ini") ||
			configFileToLoad.endsWith(".ini.txt")
		) {
			decoded = ini.decode(raw);
		} else {
			decoded = json5.parse(raw);
		}

		const result: Record<string, unknown> = {};

		for (const key in decoded) {
			const keys = key.split(".");
			let current: Record<string, unknown> = result;

			for (let i = 0; i < keys.length; i++) {
				const k = keys[i];
				if (!k) continue;

				if (i === keys.length - 1) {
					// Last key, set the value
					current[k] = decoded[key];
				} else {
					// Not the last key, create nested object if it doesn't exist
					if (!current[k] || typeof current[k] !== "object") {
						current[k] = {};
					}
					current = current[k] as Record<string, unknown>;
				}
			}
		}

		Object.assign(config, result);
	} catch (e) {
		throw new Error(
			`Error reading config file! The error given was: ${(e as Error).message}`,
		);
	}
}

// FIXME: Validate this can be killed off
//
// Load config values from environment variables
// require("dotenv").config();

// const envKeyPrefix = "MM_";
// let loadedEnvValues = 0;
//
// for (const [key, value] of Object.entries(process.env)) {
//   if (!key.startsWith(envKeyPrefix)) continue;
//
//   // MM_CLOSE_MESSAGE -> closeMessage
//   // MM_COMMAND_ALIASES__MV => commandAliases.mv
//   const configKey = key
//     .slice(envKeyPrefix.length)
//     .toLowerCase()
//     .replace(/([a-z])_([a-z])/g, (_m, m1, m2) => `${m1}${m2.toUpperCase()}`)
//     .replace("__", ".");
//
//   // config[configKey] = value.includes("||") ? value.split("||") : value;
//
//   loadedEnvValues++;
// }
//
// if (loadedEnvValues > 0) {
//   console.log(
//     `Loaded ${loadedEnvValues} ${loadedEnvValues === 1 ? "value" : "values"} from environment variables`,
//   );
// }

// mainGuildId => mainServerId
// mailGuildId => inboxServerId
if (config.mainGuildId && !config.mainServerId) {
	config.mainServerId = config.mainGuildId;
}
if (config.mailGuildId && !config.inboxServerId) {
	config.inboxServerId = config.mailGuildId;
}

// if (!config.sqliteOptions) {
//   config.sqliteOptions = {
//     filename: path.resolve(__dirname, "..", "db", "data.sqlite"),
//   };
// }

if (!config.mysqlOptions) {
	config.mysqlOptions = {
		user: "",
		host: "",
		port: 0,
		database: "",
		password: "",
	};
}

config.categoryAutomation = config.categoryAutomation || {};
// categoryAutomation.newThreadFromGuild => categoryAutomation.newThreadFromServer
if (
	config.categoryAutomation?.newThreadFromGuild &&
	!config.categoryAutomation.newThreadFromServer
) {
	config.categoryAutomation.newThreadFromServer =
		config.categoryAutomation.newThreadFromGuild;
}

// Move greetingMessage/greetingAttachment to the serverGreetings object internally
// Or, in other words, if greetingMessage and/or greetingAttachment is set, it is applied for all servers that don't
// already have something set up in serverGreetings. This retains backwards compatibility while allowing you to override
// greetings for specific servers in serverGreetings.
config.serverGreetings = config.serverGreetings || {};
if (
	config.mainServerId &&
	(config.greetingMessage || config.greetingAttachment)
) {
	for (const guildId of config.mainServerId) {
		if (config.serverGreetings[guildId]) continue;
		config.serverGreetings[guildId] = {
			message: config.greetingMessage,
			attachment: config.greetingAttachment,
		};
	}
}

// newThreadCategoryId is syntactic sugar for categoryAutomation.newThread
if (config.newThreadCategoryId) {
	config.categoryAutomation = config.categoryAutomation || {};
	config.categoryAutomation.newThread = config.newThreadCategoryId;
	delete config.newThreadCategoryId;
}

// Delete empty string options (i.e. "option=" without a value in config.ini)
for (const [key, value] of Object.entries(config)) {
	if (value === "") {
		delete config[key as keyof typeof config];
	}
}

// Validate config and assign defaults (if missing)
const ajv = new Ajv({
	useDefaults: true,
	coerceTypes: "array",
	allowUnionTypes: true,
});

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

// https://github.com/ajv-validator/ajv/issues/141#issuecomment-270692820
const truthyValues = ["1", "true", "on", "yes"];
const falsyValues = ["0", "false", "off", "no"];
ajv.addKeyword({
	keyword: "coerceBoolean",
	compile() {
		return (value, ctx) => {
			if (!value || !ctx) {
				// Disabled -> no coercion
				return true;
			}

			// https://github.com/ajv-validator/ajv/issues/141#issuecomment-270777250
			// The "value" argument doesn't update within the same set of schemas inside "allOf",
			// so we're referring to the original property instead.
			// This also means we can't use { "type": "boolean" }, as it would test the un-updated data value.
			const realValue = ctx.parentData[ctx.parentDataProperty];

			if (typeof realValue === "boolean") {
				return true;
			}

			if (truthyValues.includes(realValue)) {
				ctx.parentData[ctx.parentDataProperty] = true;
			} else if (falsyValues.includes(realValue)) {
				ctx.parentData[ctx.parentDataProperty] = false;
			} else {
				return false;
			}

			return true;
		};
	},
});

ajv.addKeyword({
	keyword: "multilineString",
	compile() {
		return (value, ctx) => {
			if (!value || !ctx) {
				// Disabled -> no coercion
				return true;
			}

			const realValue = ctx.parentData[ctx.parentDataProperty];
			if (typeof realValue === "string") {
				return true;
			}

			ctx.parentData[ctx.parentDataProperty] = realValue.join("\n");

			return true;
		};
	},
});

const validate = ajv.compile(schema);
const configIsValid = validate(config);
if (!configIsValid) {
	const errors =
		validate.errors?.map((error) => {
			if (error.params.missingProperty) {
				return `Missing required option: "${error.params.missingProperty}"`;
			} else {
				return `The "${error.instancePath.slice(1)}" option ${error.message}. (Is currently: ${typeof config[error.instancePath.slice(1)]})`;
			}
		}) || [];

	exitWithConfigurationErrors(errors);
}

const validStreamingUrlRegex = /^https:\/\/(www\.)?twitch.tv\/[a-z\d_-]+\/?$/i;
if (config.statusType === "streaming") {
	if (!validStreamingUrlRegex.test(config.statusUrl || "")) {
		exitWithConfigurationErrors([
			'When statusType is set to "streaming", statusUrl must be set to a valid Twitch channel URL, such as https://www.twitch.tv/Dragory',
		]);
	}
}

console.log("Configuration ok!");

export default config;
