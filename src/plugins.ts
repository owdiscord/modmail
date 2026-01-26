import path from "node:path";
import type { SQL } from "bun";
import type { Client } from "discord.js";
import type { ModmailConfig } from "./cfg";
import type { Commands } from "./commands";
import {
	addStorageType,
	downloadAttachment,
	saveAttachment,
} from "./data/attachments";
import displayRoles from "./data/displayRoles";
import * as logs from "./data/logs";
import * as threads from "./data/threads";
import * as formats from "./formatters";
import { afterNewMessageReceived } from "./hooks/afterNewMessageReceived";
import { afterThreadClose } from "./hooks/afterThreadClose";
import { afterThreadCloseScheduleCanceled } from "./hooks/afterThreadCloseScheduleCanceled";
import { afterThreadCloseScheduled } from "./hooks/afterThreadCloseScheduled";
import { beforeNewMessageReceived } from "./hooks/beforeNewMessageReceived";
import { beforeNewThread } from "./hooks/beforeNewThread";

export class PluginInstallationError extends Error {}

const pluginSources = {
	file: {},
};

async function loadFilePlugin(
	plugin: string,
	pluginApi: ReturnType<typeof getPluginAPI>,
) {
	const pluginImportPath = path.join(__dirname, "..", plugin);
	const pluginFn = (await import(pluginImportPath)).default;

	if (typeof pluginFn !== "function") {
		throw new PluginInstallationError(
			`Plugin '${plugin}' is not a valid plugin`,
		);
	}
	return pluginFn(pluginApi);
}

const defaultPluginSource = "file";

function splitPluginSource(pluginName: string) {
	for (const pluginSource of Object.keys(pluginSources)) {
		if (pluginName.startsWith(`${pluginSource}:`)) {
			return {
				source: pluginSource,
				plugin: pluginName.slice(pluginSource.length + 1),
			};
		}
	}

	return {
		source: defaultPluginSource,
		plugin: pluginName,
	};
}

export async function loadPlugins(
	plugins: Array<string>,
	pluginApi: ReturnType<typeof getPluginAPI>,
) {
	for (const pluginName of plugins) {
		const { source: _, plugin } = splitPluginSource(pluginName);
		await loadFilePlugin(plugin, pluginApi);
	}
}

export type ModuleProps = {
	bot: Client;
	config: ModmailConfig;
	commands: Commands;
	db: SQL;
	attachments: {
		addStorageType: typeof addStorageType;
		downloadAttachment: typeof downloadAttachment;
		saveAttachment: typeof saveAttachment;
	};
	logs: {
		addStorageType: typeof logs.addStorageType;
		saveLogToStorage: typeof logs.saveLogToStorage;
		getLogUrl: typeof logs.getLogUrl;
		getLogFile: typeof logs.getLogFile;
		getLogCustomResponse: typeof logs.getLogCustomResponse;
	};
	hooks: {
		beforeNewThread: typeof beforeNewThread;
		beforeNewMessageReceived: typeof beforeNewMessageReceived;
		afterNewMessageReceived: typeof afterNewMessageReceived;
		afterThreadClose: typeof afterThreadClose;
		afterThreadCloseScheduled: typeof afterThreadCloseScheduled;
		afterThreadCloseScheduleCanceled: typeof afterThreadCloseScheduleCanceled;
	};
	formats: typeof formats;
	threads: typeof threads;
	displayRoles: typeof displayRoles;
};

export function getPluginAPI({
	bot,
	db,
	config,
	commands,
}: {
	bot: Client;
	db: SQL;
	config: ModmailConfig;
	commands: Commands;
}): ModuleProps {
	return {
		bot,
		db,
		config,
		commands,
		attachments: {
			addStorageType: addStorageType,
			downloadAttachment: downloadAttachment,
			saveAttachment: saveAttachment,
		},
		logs: {
			addStorageType: logs.addStorageType,
			saveLogToStorage: logs.saveLogToStorage,
			getLogUrl: logs.getLogUrl,
			getLogFile: logs.getLogFile,
			getLogCustomResponse: logs.getLogCustomResponse,
		},
		hooks: {
			beforeNewThread,
			beforeNewMessageReceived,
			afterNewMessageReceived,
			afterThreadClose,
			afterThreadCloseScheduled,
			afterThreadCloseScheduleCanceled,
		},
		formats,
		threads,
		displayRoles,
	};
}
