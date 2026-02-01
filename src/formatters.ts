import bot from "./bot";
import config from "./cfg";
import { ThreadMessageType } from "./data/constants";
import type Thread from "./data/Thread";
import ThreadMessage from "./data/ThreadMessage";
import * as utils from "./utils";

const defaultFormatters = {
	formatStaffReplyDM(threadMessage: ThreadMessage) {
		const roleName =
			config.overrideRoleNameDisplay ||
			threadMessage.role_name ||
			config.fallbackRoleName;
		const modInfo = threadMessage.is_anonymous
			? roleName
			: roleName
				? `(${roleName}) ${threadMessage.user_name}`
				: threadMessage.user_name;

		return modInfo
			? `**${modInfo}:** ${threadMessage.body}`
			: threadMessage.body;
	},

	formatStaffReplyThreadMessage(threadMessage: ThreadMessage) {
		const roleName =
			config.overrideRoleNameDisplay ||
			threadMessage.role_name ||
			config.fallbackRoleName;
		const modInfo = threadMessage.is_anonymous
			? roleName
				? `(Anonymous) (${threadMessage.user_name}) ${roleName}`
				: `(Anonymous) (${threadMessage.user_name})`
			: roleName
				? `(${roleName}) ${threadMessage.user_name}`
				: threadMessage.user_name;

		let result = modInfo
			? `**${modInfo}:** ${threadMessage.body}`
			: threadMessage.body;

		if (config.threadTimestamps) {
			const formattedTimestamp = utils.getTimestamp(threadMessage.created_at);
			result = `[${formattedTimestamp}] ${result}`;
		}

		result = `\`${threadMessage.message_number}\`  ${result}`;

		return result;
	},

	formatUserReplyThreadMessage(threadMessage: ThreadMessage) {
		let result = `**${threadMessage.user_name}:** ${threadMessage.body}`;

		for (const link of threadMessage.attachments) {
			result += `\n\n${link}`;
		}

		if (config.threadTimestamps) {
			const formattedTimestamp = utils.getTimestamp(threadMessage.created_at);
			result = `[${formattedTimestamp}] ${result}`;
		}

		return result;
	},

	formatStaffReplyEditNotificationThreadMessage(threadMessage: ThreadMessage) {
		const originalThreadMessage = threadMessage.getMetadataValue(
			"originalThreadMessage",
		);
		if (
			!originalThreadMessage ||
			!(originalThreadMessage instanceof ThreadMessage)
		)
			return;

		const newBody = threadMessage.getMetadataValue("newBody") as string;

		let content = `**${originalThreadMessage.user_name}** (\`${originalThreadMessage.user_id}\`) edited reply \`${originalThreadMessage.message_number}\``;

		if (originalThreadMessage.body.length < 200 && newBody.length < 200) {
			// Show edits of small messages inline
			content += ` from \`${utils.disableInlineCode(originalThreadMessage.body)}\` to \`${newBody}\``;
		} else {
			// Show edits of long messages in two code blocks
			content += ":";
			content += `\n\nBefore:\n\`\`\`${utils.disableCodeBlocks(originalThreadMessage.body)}\`\`\``;
			content += `\nAfter:\n\`\`\`${utils.disableCodeBlocks(newBody)}\`\`\``;
		}

		return content;
	},

	formatStaffReplyDeletionNotificationThreadMessage(
		threadMessage: ThreadMessage,
	) {
		const originalThreadMessage = threadMessage.getMetadataValue(
			"originalThreadMessage",
		);
		if (
			!originalThreadMessage ||
			!(originalThreadMessage instanceof ThreadMessage)
		)
			return;
		let content = `**${originalThreadMessage.user_name}** (\`${originalThreadMessage.user_id}\`) deleted reply \`${originalThreadMessage.message_number}\``;

		if (originalThreadMessage.body.length < 200) {
			// Show the original content of deleted small messages inline
			content += ` (message content: \`${utils.disableInlineCode(originalThreadMessage.body)}\`)`;
		} else {
			// Show the original content of deleted large messages in a code block
			content += `:\n\`\`\`${utils.disableCodeBlocks(originalThreadMessage.body)}\`\`\``;
		}

		return content;
	},

	formatSystemThreadMessage(threadMessage: ThreadMessage) {
		let result = threadMessage.body;

		for (const link of threadMessage.attachments) {
			result += `\n\n${link}`;
		}

		return result;
	},

	formatSystemToUserThreadMessage(threadMessage: ThreadMessage): string {
		let result = `**⚙️ ${bot.user?.username}:** ${threadMessage.body}`;

		for (const link of threadMessage.attachments) {
			result += `\n\n${link}`;
		}

		return result;
	},

	formatSystemToUserDM(threadMessage: ThreadMessage) {
		let result = threadMessage.body;

		for (const link of threadMessage.attachments) {
			result += `\n\n${link}`;
		}

		return result;
	},

	formatLog(
		thread: Thread,
		threadMessages: Array<ThreadMessage>,
		opts = { simple: false, verbose: false },
	) {
		if (opts.simple) {
			threadMessages = threadMessages.filter((message) => {
				return (
					message.message_type !== ThreadMessageType.System &&
					message.message_type !== ThreadMessageType.SystemToUser &&
					message.message_type !== ThreadMessageType.Chat &&
					message.message_type !== ThreadMessageType.Command
				);
			});
		}

		const lines = threadMessages.map((message) => {
			// Legacy messages (from 2018) are the entire log in one message, so just serve them as they are
			if (message.message_type === ThreadMessageType.Legacy) {
				return message.body;
			}

			const time = message.created_at
				.toISOString()
				.replace("T", " ")
				.substring(0, 19);

			let line = `[${time}]`;

			if (opts.verbose) {
				if (message.dm_channel_id) {
					line += ` [DM CHA ${message.dm_channel_id}]`;
				}

				if (message.dm_message_id) {
					line += ` [DM MSG ${message.dm_message_id}]`;
				}
			}

			const originalThreadMessage = message.getMetadataValue(
				"originalThreadMessage",
			);

			if (message.message_type === ThreadMessageType.FromUser) {
				line += ` [FROM USER] [${message.user_name}] ${message.body}`;
			} else if (message.message_type === ThreadMessageType.ToUser) {
				if (opts.verbose) {
					line += ` [TO USER] [${message.message_number || "0"}] [${message.user_name}]`;
				} else {
					line += ` [TO USER] [${message.user_name}]`;
				}

				if (message.use_legacy_format) {
					// Legacy format (from pre-2.31.0) includes the role and username in the message body, so serve that as is
					line += ` ${message.body}`;
				} else if (message.is_anonymous) {
					if (message.role_name) {
						line += ` (Anonymous) ${message.role_name}: ${message.body}`;
					} else {
						line += ` (Anonymous) Moderator: ${message.body}`;
					}
				} else {
					if (message.role_name) {
						line += ` (${message.role_name}) ${message.user_name}: ${message.body}`;
					} else {
						line += ` ${message.user_name}: ${message.body}`;
					}
				}
			} else if (message.message_type === ThreadMessageType.System) {
				line += ` [BOT] ${message.body}`;
			} else if (message.message_type === ThreadMessageType.SystemToUser) {
				line += ` [BOT TO USER] ${message.body}`;
			} else if (message.message_type === ThreadMessageType.Chat) {
				line += ` [CHAT] [${message.user_name}] ${message.body}`;
				if (message.metadata.attachments)
					line += `${message.body.length > 0 && message.metadata.attachments ? "\n" : ""}${(message.metadata.attachments as Array<string>).join("\n")}`;
			} else if (message.message_type === ThreadMessageType.Command) {
				line += ` [COMMAND] [${message.user_name}] ${message.body}`;
			} else if (message.message_type === ThreadMessageType.ReplyEdited) {
				if (
					!originalThreadMessage ||
					!(originalThreadMessage instanceof ThreadMessage)
				)
					return message.body;
				line += ` [REPLY EDITED] ${originalThreadMessage.user_name} edited reply ${originalThreadMessage.message_number}:`;
				line += `\n\nBefore:\n${originalThreadMessage.body}`;
				line += `\n\nAfter:\n${message.getMetadataValue("newBody")}`;
			} else if (message.message_type === ThreadMessageType.ReplyDeleted) {
				if (
					!originalThreadMessage ||
					!(originalThreadMessage instanceof ThreadMessage)
				)
					return message.body;
				line += ` [REPLY DELETED] ${originalThreadMessage.user_name} deleted reply ${originalThreadMessage.message_number}:`;
				line += `\n\n${originalThreadMessage.body}`;
			} else {
				line += ` [${message.user_name}] ${message.body}`;
			}

			if (message.attachments.length) {
				line += "\n\n";
				line += message.attachments.join("\n");
			}

			return line;
		});

		const header = `# Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) started at <t:${Math.round(thread.created_at.getTime() / 1000)}:S>. All times are in UTC+0.`;

		const fullResult = `${header}\n\n${lines.join("\n")}`;

		return {
			content: fullResult,
		};
	},
};

export const formatters = { ...defaultFormatters };

type FormatterFn = (message: ThreadMessage) => string;

export function setStaffReplyDMFormatter(fn: FormatterFn) {
	formatters.formatStaffReplyDM = fn;
}

export function setStaffReplyThreadMessageFormatter(fn: FormatterFn) {
	formatters.formatStaffReplyThreadMessage = fn;
}

export function setUserReplyThreadMessageFormatter(fn: FormatterFn) {
	formatters.formatUserReplyThreadMessage = fn;
}

export function setStaffReplyEditNotificationThreadMessageFormatter(
	fn: FormatterFn,
) {
	formatters.formatStaffReplyEditNotificationThreadMessage = fn;
}

export function setStaffReplyDeletionNotificationThreadMessageFormatter(
	fn: FormatterFn,
) {
	formatters.formatStaffReplyDeletionNotificationThreadMessage = fn;
}

export function setSystemThreadMessageFormatter(fn: FormatterFn) {
	formatters.formatSystemThreadMessage = fn;
}

export function setSystemToUserThreadMessageFormatter(fn: FormatterFn) {
	formatters.formatSystemToUserThreadMessage = fn;
}

export function setSystemToUserDMFormatter(fn: FormatterFn) {
	formatters.formatSystemToUserDM = fn;
}

export function setLogFormatter(
	fn: (
		thread: Thread,
		messages: Array<ThreadMessage>,
		opts: { simple: boolean; verbose: boolean },
	) => { content: string },
) {
	formatters.formatLog = fn;
}
