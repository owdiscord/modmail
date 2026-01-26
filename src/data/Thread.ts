import bot from "../bot";
import cfg from "../cfg";
import {
	chunkMessageLines,
	convertDelayStringToMS,
	messageContentIsWithinMaxLength,
	noop,
} from "../utils";

const {
	autoAlertDelay: _autoAlertDelay,
	useDisplaynames,
	useNicknames,
	breakFormattingForNames,
	relayInlineReplies,
	allowSnippets,
	allowInlineSnippets,
	inlineSnippetStart,
	inlineSnippetEnd,
	errorOnUnknownInlineSnippet,
	attachmentStorage,
	autoAlert,
	relaySmallAttachmentsAsAttachments,
	smallAttachmentLimit,
	reactOnSeen,
	reactOnSeenEmoji,
} = cfg;

import type { SQL } from "bun";
import {
	type Attachment,
	Collection,
	DiscordAPIError,
	type DMChannel,
	type GuildMember,
	type Message,
	MessageActivityType,
	type MessageCreateOptions,
	type MessageMentionOptions,
	type MessageReference,
	MessageReferenceType,
	type MessageResolvable,
	type MessageSnapshot,
	type ReplyOptions,
	type SendableChannels,
	type User,
} from "discord.js";
import config from "../cfg";
import { formatters } from "../formatters";
import { callAfterNewMessageReceivedHooks } from "../hooks/afterNewMessageReceived";
import { callAfterThreadCloseHooks } from "../hooks/afterThreadClose";
import { callAfterThreadCloseScheduleCanceledHooks } from "../hooks/afterThreadCloseScheduleCanceled";
import { callAfterThreadCloseScheduledHooks } from "../hooks/afterThreadCloseScheduled";
import { callBeforeNewMessageReceivedHooks } from "../hooks/beforeNewMessageReceived";
import { messageContentToAdvancedMessageContent } from "../utils";
import { saveAttachment } from "./attachments";
import { isBlocked } from "./blocked";
import { ThreadMessageType, ThreadStatus } from "./constants";
import { getModeratorThreadDisplayRoleName } from "./displayRoles";
import type { Snippet } from "./Snippet";
import { all } from "./snippets";
import ThreadMessage, { type ThreadMessageProps } from "./ThreadMessage";

const escapeFormattingRegex = /[_`~*|]/g;

export type ThreadProps = {
	id?: string;
	thread_number: number;
	status: number;
	user_id: string;
	user_name: string;
	channel_id: string;
	next_message_number: number;
	scheduled_close_at?: Date;
	scheduled_close_id?: string;
	scheduled_close_name?: string;
	scheduled_close_silent?: number;
	scheduled_suspend_at?: Date;
	scheduled_suspend_id?: string;
	scheduled_suspend_name?: string;
	alert_ids: string;
	log_storage_type: string;
	log_storage_data: object;
	created_at?: Date;
	metadata: string;
};

export class Thread {
	private db: SQL;
	public id!: string;
	public thread_number!: number;
	public status!: number;
	public user_id!: string;
	public user_name!: string;
	public channel_id!: string;
	public next_message_number!: number;
	public scheduled_close_at: Date | null;
	public scheduled_close_id: string | null;
	public scheduled_close_name: string | null;
	public scheduled_close_silent: number | null;
	public scheduled_suspend_at: Date | null;
	public scheduled_suspend_id: string | null;
	public scheduled_suspend_name: string | null;
	public alert_ids!: string;
	public log_storage_type!: string;
	public log_storage_data!:
		| {
				fullPath?: string;
				filename: string;
		  }
		| string;
	public created_at: Date;
	public metadata: Record<string, unknown>;
	private _autoAlertTimeout: ReturnType<typeof setTimeout> | null = null;
	private dm_channel_id?: string;

	constructor(db: SQL, props: ThreadProps) {
		this.db = db;
		if (props.id) this.id = props.id;
		this.thread_number = props.thread_number;
		this.status = props.status;
		this.user_id = props.user_id;
		this.user_name = props.user_name;
		this.channel_id = props.channel_id;
		this.next_message_number = props.next_message_number;
		this.scheduled_close_at = props.scheduled_close_at || null;
		this.scheduled_close_id = props.scheduled_close_id || null;
		this.scheduled_close_name = props.scheduled_close_name || null;
		this.scheduled_close_silent = props.scheduled_close_silent || null;
		this.scheduled_suspend_at = props.scheduled_suspend_at || null;
		this.scheduled_suspend_id = props.scheduled_suspend_id || null;
		this.scheduled_suspend_name = props.scheduled_suspend_name || null;
		this.alert_ids = props.alert_ids;
		this.log_storage_type = props.log_storage_type;
		this.log_storage_data =
			typeof props.log_storage_data === "string"
				? JSON.parse(props.log_storage_data)
				: props.log_storage_data;
		this.created_at = props.created_at || new Date();
		if (typeof props.metadata === "string" && props.metadata.length > 0)
			this.metadata = JSON.parse(props.metadata);
		else if (typeof props.metadata === "object") this.metadata = props.metadata;
		else this.metadata = {};
	}

	async _sendDMToUser(content: MessageCreateOptions): Promise<Message> {
		const user = await bot.users.fetch(this.user_id);

		if (user) {
			const msg = await user.send(content);
			this.dm_channel_id = msg.channelId;
			return msg;
		}

		throw "We could not send a message to the user, they may have blocked the bot, or have strict privacy settings.";
	}

	async _postToThreadChannel(message: MessageCreateOptions): Promise<Message> {
		try {
			const channel = await bot.channels.fetch(this.channel_id);
			if (!channel || !channel?.isSendable())
				throw "cannot send to an unsendable channel";

			if (message.content && message.content.length > 0) {
				// Text content is included, chunk it and send it as individual messages.
				// Files (attachments) are only sent with the last message.
				const chunks = chunkMessageLines(message.content);
				for (const [i, chunk] of chunks.entries()) {
					// Only send embeds, files, etc. with the last message
					if (i === chunks.length - 1) {
						return await channel.send({ ...message, content: chunk });
					}

					// Send a regular chunk, no need to return here.
					await channel.send({ content: chunk });
				}
			} else {
				// No text content, we are safe to assume it can be sent
				// as one message, likely only containing a file or similar.
				return await channel.send(message);
			}
		} catch (err: unknown) {
			if (err instanceof DiscordAPIError) {
				// Channel not found
				if (err.code === 10003) {
					console.log(
						`[INFO] Failed to send message to thread channel for ${this.user_name} because the channel no longer exists. Auto-closing the thread.`,
					);
					this.close(true);
				}

				if (err.code === 240000) {
					console.log(
						`[INFO] Failed to send message to thread channel for ${this.user_name} because the message contains a link blocked by the harmful links filter`,
					);

					(
						(await bot.channels.fetch(this.channel_id)) as SendableChannels
					).send(
						"Failed to send message to thread channel because the message contains a link blocked by the harmful links filter",
					);
				}
			} else {
				throw err;
			}
		}

		console.error(
			`You're on your own, bossman.\nPayload:\n${JSON.stringify(message, null, 2)}`,
		);
		throw "something truly wild has happend";
	}

	async _addThreadMessageToDB(
		db: SQL,
		message: ThreadMessage,
	): Promise<ThreadMessage> {
		console.log("adding message to DB");
		const data = {
			thread_id: this.id,
			created_at: Date.now(),
			is_anonymous: false,
			dm_channel_id: this.dm_channel_id,
			message_type: message.message_type,
			message_number:
				message.message_type === ThreadMessageType.ToUser
					? await this._getAndIncrementNextMessageNumber()
					: message.message_number,
		};
		try {
			const inserted = await db`INSERT INTO thread_messages ${db(data)}`;

			return new ThreadMessage(inserted[0]);
		} catch (e) {
			throw new Error(`could not create a thread: ${e}`);
		}
	}

	async _getAndIncrementNextMessageNumber(): Promise<number> {
		const next = await this.db.transaction(async (sql) => {
			const nextNumberRow =
				await sql`SELECT next_message_number FROM threads WHERE id = ${this.id}`;
			if (nextNumberRow?.[0]) {
				await sql`UPDATE threads SET next_message_number = ${nextNumberRow[0].next_message_number + 1}`;
				return nextNumberRow[0].next_message_number;
			}
		});

		return next;
	}

	async _startAutoAlertTimer(modId: string): Promise<void> {
		if (this._autoAlertTimeout) clearTimeout(this._autoAlertTimeout);

		const autoAlertDelay =
			convertDelayStringToMS(config.autoAlertDelay || "1s") || 1000;

		this._autoAlertTimeout = setTimeout(() => {
			if (this.status !== ThreadStatus.Open) return;
			this.addAlert(modId);
		}, autoAlertDelay);
	}

	async replyToUser(
		moderator: GuildMember,
		text: string,
		replyAttachments: Collection<string, Attachment> = new Collection(),
		isAnonymous: boolean = false,
		messageReference: MessageReference | null = null,
	): Promise<boolean> {
		const regularName = useDisplaynames
			? moderator.user.globalName || moderator.user.username
			: moderator.user.username;
		let moderatorName =
			useNicknames && moderator.nickname ? moderator.nickname : regularName;
		if (breakFormattingForNames) {
			moderatorName = moderatorName.replace(escapeFormattingRegex, "\\$&");
		}

		const roleName = await getModeratorThreadDisplayRoleName(
			moderator,
			this.id,
		);

		const userMessageReference: ReplyOptions = {
			messageReference: "",
			failIfNotExists: true,
		};

		// Handle replies
		if (relayInlineReplies && messageReference) {
			const repliedTo = await this.getThreadMessageForMessageId(
				messageReference.messageId || "",
			);
			if (repliedTo) {
				userMessageReference.messageReference = repliedTo.dm_message_id;
			}
		}

		if (allowSnippets && allowInlineSnippets) {
			// Replace {{snippet}} with the corresponding snippet
			// The beginning and end of the variable - {{ and }} - can be changed with the config options
			// config.inlineSnippetStart and config.inlineSnippetEnd
			const allSnippets = await all();

			const unknownSnippets = new Set();
			text = text.replace(
				new RegExp(
					`${inlineSnippetStart}(\\s*\\S+?\\s*)${inlineSnippetEnd}`,
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

			if (errorOnUnknownInlineSnippet && unknownSnippets.size > 0) {
				this.postSystemMessage(
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
					attachment.url = result.url;
					files.push(attachment);
					attachmentLinks.push(result.url);
				}
			}
		}

		const threadMessage = new ThreadMessage({
			thread_id: this.id,
			message_type: ThreadMessageType.ToUser,
			message_number: await this._getAndIncrementNextMessageNumber(),
			user_id: moderator.id,
			user_name: moderatorName,
			body: text,
			is_anonymous: isAnonymous,
			role_name: roleName,
			attachments: attachmentLinks,
		});

		const dmContent = messageContentToAdvancedMessageContent(
			formatters.formatStaffReplyDM(threadMessage),
		);

		if (userMessageReference) {
			dmContent.reply = userMessageReference;
			// dmContent.allowedMentions = userMessageReference;
		}

		const inboxContent = messageContentToAdvancedMessageContent(
			formatters.formatStaffReplyThreadMessage(threadMessage),
		);

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

		// Send the reply DM
		const dmMessage = await this._sendDMToUser(dmContent).catch(async (err) => {
			await threadMessage.deleteFromDb(this.db);
			await this.postSystemMessage(
				`Error while replying to user: ${err.message}`,
			);
		});

		if (!dmMessage) return false;

		threadMessage.dm_message_id = dmMessage.id;

		// Special case: "original" attachments
		if (attachmentStorage === "original") {
			threadMessage.attachments = dmMessage.attachments.map((att) => att.url);
		}

		// Show the reply in the inbox thread
		const inboxMessage = await this._postToThreadChannel({
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
		if (autoAlert) {
			this._startAutoAlertTimer(moderator.id);
		}

		return true;
	}

	async receiveUserReply(msg: Message, skipAlert = false): Promise<void> {
		const user = msg.author;
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

		// Prepare attachments
		const attachmentLinks = [];
		const smallAttachmentLinks = [];
		const attachmentFiles = [];

		let allMessageAttachments = msg.attachments;
		if (msg.messageSnapshots.size > 0) {
			allMessageAttachments = allMessageAttachments.concat(
				(msg.messageSnapshots.first() as MessageSnapshot).attachments,
			);
		}

		for (const [_, attachment] of allMessageAttachments) {
			const savedAttachment = await saveAttachment(attachment);

			console.log(savedAttachment);

			// Forward small attachments (<2MB) as attachments, link to larger ones
			if (
				savedAttachment &&
				relaySmallAttachmentsAsAttachments &&
				attachment.size <= smallAttachmentLimit
			) {
				//        const file = await attachmentToDiscordFileObject(attachment);
				attachmentFiles.push(attachment);
				smallAttachmentLinks.push(savedAttachment.url);
			}

			if (savedAttachment) {
				attachmentLinks.push(savedAttachment.url);
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
					.map((sticker) => {
						return `Sticker **[${sticker.name}](https://media.discordapp.net/stickers/${sticker.id}.webp?size=160)**`;
					})
					.join("\n");
			}

			if (textContent.length === 0)
				textContent = "Message contains only embeds";
			messageContent = `\n\n> -# *↪ Forwarded from ${forward.guild?.name || "direct messages"}*\n> ${textContent}\n> -# [Source](${forward.url})  •  <t:${Math.round(forward.createdTimestamp / 1000)}:f>`;
		}

		// Handle replies
		let messageReply: MessageResolvable = "";
		if (
			relayInlineReplies &&
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

			let activityText = "";
			if (
				msg.activity.type === MessageActivityType.Join ||
				msg.activity.type === MessageActivityType.JoinRequest
			) {
				activityText = "join a game";
			} else if (msg.activity.type === MessageActivityType.Spectate) {
				activityText = "spectate";
			} else if (msg.activity.type === MessageActivityType.Listen) {
				activityText = "listen along";
			} else {
				activityText = "do something";
			}

			messageContent += `\n\n*<This message contains an invite to ${activityText} on ${applicationName}>*`;
			messageContent = messageContent.trim();
		}

		if (msg.stickers) {
			const stickerLines = msg.stickers.map((sticker) => {
				return `*Sent sticker "${sticker.name}":* https://media.discordapp.net/stickers/${sticker.id}.webp?size=160`;
			});

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
			user_name: useDisplaynames
				? msg.author.globalName || msg.author.username
				: msg.author.username,
			body: messageContent,
			is_anonymous: false,
			dm_message_id: msg.id,
			dm_channel_id: msg.channel.id,
			attachments: attachmentLinks,
			small_attachments: smallAttachmentLinks,
			metadata: {
				embeds,
			},
		});

		// Show user reply in the inbox thread
		const inboxContent = messageContentToAdvancedMessageContent(
			formatters.formatUserReplyThreadMessage(threadMessage),
		);

		if (messageReply) {
			inboxContent.reply = {
				messageReference: messageReply,
				failIfNotExists: false,
			};
		}
		const inboxMessage = await this._postToThreadChannel({
			...inboxContent,
			files: attachmentFiles,
			embeds,
		});
		if (inboxMessage) {
			threadMessage.inbox_message_id = inboxMessage.id;
		}

		if (reactOnSeen && reactOnSeenEmoji) {
			await msg.react(reactOnSeenEmoji).catch(noop);
		}

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
				`${mentionsStr}New message from ${this.user_name}`,
				{
					allowedMentions: {
						users: ids,
					},
				},
			);
		}
	}

	async postSystemMessage(
		text: string,
		opts: {
			allowedMentions?: MessageMentionOptions;
			messageReference?: MessageReference;
		} = {},
	): Promise<{
		message: Message;
		threadMessage: ThreadMessage;
	}> {
		const threadMessage = new ThreadMessage({
			thread_id: this.id,
			message_type: ThreadMessageType.System,
			user_id: undefined,
			user_name: "",
			body: text,
			is_anonymous: false,
		});

		const content = messageContentToAdvancedMessageContent(
			formatters.formatSystemThreadMessage(threadMessage),
		);

		content.allowedMentions = opts.allowedMentions;
		if (opts.messageReference) {
			content.reply = {
				messageReference: opts.messageReference.messageId || "",
			};
		}
		const msg = await this._postToThreadChannel(content);

		threadMessage.inbox_message_id = msg.id;
		const finalThreadMessage = await threadMessage.saveToDb(this.db);

		return {
			message: msg,
			threadMessage: finalThreadMessage,
		};
	}

	/**
	 * @param {string} text
	 * @returns {Promise<ThreadMessage>}
	 */
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
		const threadMessage = new ThreadMessage({
			thread_id: this.id,
			message_type: ThreadMessageType.SystemToUser,
			user_name: "",
			body: text,
			is_anonymous: false,
		});

		const user = await bot.users.fetch(this.user_id);
		if (!user || !user.dmChannel) throw "failure!!!";

		const dmContent = formatters.formatSystemToUserDM(threadMessage);
		const dmMessage = await user.send({ content: dmContent });

		if (opts.postToThreadChannel !== false) {
			const inboxContent = {
				content: formatters.formatSystemToUserThreadMessage(threadMessage),
				allowedMentions: opts.allowedMentions,
			};

			const inboxMsg = await this._postToThreadChannel(inboxContent);
			threadMessage.inbox_message_id = inboxMsg.id;
		}

		threadMessage.dm_channel_id = user.dmChannel?.id;
		threadMessage.dm_message_id = dmMessage.id;

		await threadMessage.saveToDb(this.db);
	}

	async postNonLogMessage(
		message: MessageCreateOptions,
	): Promise<Message | null> {
		return this._postToThreadChannel(message);
	}

	async saveChatMessageToLogs(msg: Message): Promise<void> {
		// FIXME: Check if we need to save attachments here !!!

		const threadMessage = new ThreadMessage({
			thread_id: this.id,
			message_type: ThreadMessageType.Chat,
			user_id: msg.author.id,
			user_name: useDisplaynames
				? msg.author.globalName || msg.author.username
				: msg.author.username,
			body: msg.content,
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
			user_name: useDisplaynames
				? msg.author.globalName || msg.author.username
				: msg.author.username,
			body: msg.content,
			dm_message_id: msg.id,
			created_at: new Date(),
			is_anonymous: false,
		});

		return await threadMessage.saveToDb(this.db);
	}

	async updateChatMessageInLogs(msg: Message): Promise<void> {
		await this
			.db`UPDATE thread_messages SET body = ${msg.content} WHERE thread_id = ${this.id} AND dm_message_id = ${msg.id}`;
	}

	async deleteChatMessageFromLogs(messageId: string): Promise<void> {
		await this
			.db`DELETE FROM thread_messages WHERE thread_id = ${this.id} AND dm_message_id = ${messageId}`;
	}

	async getThreadMessages(): Promise<ThreadMessage[]> {
		const threadMessages = await this
			.db`SELECT * FROM thread_messages WHERE thread_id = ${this.id} ORDER BY created_at ASC, id ASC`;

		return threadMessages.map(
			(row: ThreadMessageProps) => new ThreadMessage(row),
		);
	}

	async getThreadMessageForMessageId(
		messageId: string,
	): Promise<ThreadMessage> {
		const data = await this
			.db`SELECT * FROM thread_messages WHERE thread_id = ${this.id} AND (dm_message_id = ${messageId} OR inbox_message_id = ${messageId})`;

		if (data) return new ThreadMessage(data);

		throw "[getThreadMessageForMessageId@Thread.ts:804] could not get thread message";
	}

	async findThreadMessageByDmMessageId(messageId: string) {
		const data = await this
			.db`SELECT * FROM thread_messages WHERE thread_id = ${this.id} AND dm_message_id = ${messageId}`;

		if (data && data.length === 1) return new ThreadMessage(data[0]);

		throw "[findThreadMessageByDmMessageId@Thread.ts:813] could not get thread message";
	}

	async getLatestThreadMessage(): Promise<ThreadMessage> {
		const types = [
			ThreadMessageType.FromUser,
			ThreadMessageType.ToUser,
			ThreadMessageType.SystemToUser,
		];
		const data = await this
			.db`SELECT * FROM thread_messages WHERE thread_id = ${this.id} AND message_type IN ${this.db(types)} ORDER BY created_at DESC, id DESC LIMIT 1`;

		if (data && data.length === 1) return new ThreadMessage(data[0]);

		throw "[getLatestThreadMessage@Thread.ts:827] could not get thread message";
	}

	async findThreadMessageByMessageNumber(
		messageNumber: number,
	): Promise<ThreadMessage> {
		const data = await this
			.db`SELECT * FROM thread_messages WHERE thread_id = ${this.id} AND message_number = ${messageNumber}`;

		if (data && data.length === 1) return new ThreadMessage(data[0]);

		throw "[findThreadMessageByMessageNumber@Thread.ts:838] could not get thread message";
	}

	async close(suppressSystemMessage = false, silent = false): Promise<void> {
		if (!suppressSystemMessage) {
			console.log(`Closing thread ${this.id}`);

			if (silent) {
				await this.postSystemMessage("Closing thread silently...");
			} else {
				await this.postSystemMessage("Closing thread...");
			}
		}

		// Update DB status
		await this
			.db`UPDATE threads SET status = ${ThreadStatus.Closed} WHERE id = ${this.id}`;

		// Delete channel
		const channel = await bot.channels.fetch(this.channel_id);
		if (channel) {
			console.log(`Deleting channel ${this.channel_id}`);
			await channel.delete("Thread closed");
		}

		await callAfterThreadCloseHooks({ threadId: this.id });
	}

	async scheduleClose(
		delay_ms: number,
		user: User,
		silent: boolean,
	): Promise<void> {
		const closed_username = useDisplaynames
			? user.globalName || user.username
			: user.username;

		const delay_micro = delay_ms * 1000;

		await this
			.db`UPDATE threads SET scheduled_close_at = DATE_ADD(NOW(3), INTERVAL ${delay_micro} MICROSECOND), scheduled_close_id = ${user.id}, scheduled_close_name = ${closed_username}, scheduled_close_silent = ${silent} WHERE id = ${this.id}`;

		await callAfterThreadCloseScheduledHooks({ thread: this });
	}

	async cancelScheduledClose(): Promise<void> {
		const new_data = {
			scheduled_close_at: null,
			scheduled_close_id: null,
			scheduled_close_name: null,
			scheduled_close_silent: null,
		};
		await this
			.db`UPDATE threads SET ${this.db(new_data)} WHERE id = ${this.id}`;

		await callAfterThreadCloseScheduleCanceledHooks({ thread: this });
	}

	async suspend(): Promise<void> {
		const new_data = {
			status: ThreadStatus.Suspended,
			scheduled_suspend_at: null,
			scheduled_suspend_id: null,
			scheduled_suspend_name: null,
		};

		await this
			.db`UPDATE threads SET ${this.db(new_data)} WHERE id = ${this.id}`;
	}

	async unsuspend(): Promise<void> {
		await this
			.db`UPDATE threads SET status = ${ThreadStatus.Open} WHERE id = ${this.id}`;
	}

	async scheduleSuspend(delay_ms: number, user: User): Promise<void> {
		const suspend_name = useDisplaynames
			? user.globalName || user.username
			: user.username;

		const delay_micro = delay_ms * 1000;

		await this
			.db`UPDATE threads SET scheduled_suspend_id = ${user.id}, scheduled_suspend_name = ${suspend_name}, scheduled_suspend_at = DATE_ADD(NOW(3), INTERVAL ${delay_micro} MICROSECOND) WHERE id = ${this.id}`;
	}

	async cancelScheduledSuspend(): Promise<void> {
		const new_data = {
			scheduled_suspend_at: null,
			scheduled_suspend_id: null,
			scheduled_suspend_name: null,
		};
		await this
			.db`UPDATE threads SET ${this.db(new_data)} WHERE id = ${this.id}`;
	}

	async addAlert(userId: string): Promise<void> {
		await this.db`UPDATE threads
    SET alert_ids = CASE
      WHEN alert_ids IS NULL THEN ${userId}
      WHEN LENGTH(alert_ids) = 0 THEN ${userId}
      WHEN FIND_IN_SET(${userId}, alert_ids) > 0 THEN alert_ids
      ELSE CONCAT_WS(${","}, alert_ids, ${userId})
    END
    WHERE id = ${this.id}`;
	}

	async removeAlert(userId: string) {
		await this.db`
  UPDATE threads
  SET alert_ids = NULLIF(
    TRIM(BOTH ',' FROM
      REPLACE(CONCAT(',', alert_ids, ','), ${`,${userId},`}, ',')
    ),
    ''
  )
  WHERE id = ${this.id}
    AND FIND_IN_SET(${userId}, alert_ids) > 0`;
	}

	async deleteAlerts(): Promise<void> {
		this.db`UPDATE threads SET alert_ids = NULL WHERE id = ${this.id}`;
	}

	async editStaffReply(
		_moderator: User,
		threadMessage: ThreadMessage,
		newText: string,
		quiet = true,
	): Promise<boolean> {
		const newThreadMessage = new ThreadMessage({
			...threadMessage,
			body: newText,
		});

		const formattedThreadMessage =
			formatters.formatStaffReplyThreadMessage(newThreadMessage);
		const formattedDM = formatters.formatStaffReplyDM(newThreadMessage);

		// Same restriction as in replies. Because edits could theoretically change the number of messages a reply takes, we enforce replies
		// to fit within 1 message to avoid the headache and issues caused by that.
		if (
			!messageContentIsWithinMaxLength(formattedDM) ||
			!messageContentIsWithinMaxLength(formattedThreadMessage)
		) {
			await this.postSystemMessage(
				"Edited reply is too long! Make sure the edit is under 2000 characters total, moderator name in the reply included.",
			);
			return false;
		}

		const { dm_channel_id, dm_message_id, inbox_message_id } = threadMessage;

		// Edit the DM (user side) message
		const threadChannel = await bot.channels.fetch(dm_channel_id);
		if (threadChannel?.isSendable()) {
			const message = await threadChannel.messages.fetch(dm_message_id);
			message.edit(formattedDM);
		}

		// Edit the inbox (mod side) message
		const inboxChannel = await bot.channels.fetch(this.channel_id);
		if (inboxChannel?.isSendable()) {
			const message = await inboxChannel.messages.fetch(inbox_message_id);
			message.edit(formattedThreadMessage);
		}

		if (!quiet) {
			const editThreadMessage = new ThreadMessage({
				thread_id: this.id,
				message_type: ThreadMessageType.ReplyEdited,
				user_name: "",
				body: "",
				is_anonymous: false,
			});
			editThreadMessage.metadata.originalThreadMessage = threadMessage;
			editThreadMessage.metadata.newBody = newText;

			const threadNotification =
				formatters.formatStaffReplyEditNotificationThreadMessage(
					editThreadMessage,
				);
			const inboxMessage = await this._postToThreadChannel({
				content: threadNotification,
			});
			editThreadMessage.inbox_message_id = inboxMessage.id;
			await editThreadMessage.saveToDb(this.db);
		}

		await this
			.db`UPDATE thread_messages SET body = ${newText} WHERE id = ${threadMessage.id}`;
		return true;
	}

	async deleteStaffReply(
		_moderator: User,
		threadMessage: ThreadMessage,
		quiet = false,
	): Promise<void> {
		const dmChannel = await bot.channels.fetch(threadMessage.dm_channel_id);
		if (dmChannel?.isSendable())
			dmChannel.messages.delete(threadMessage.dm_message_id);

		const inboxChannel = await bot.channels.fetch(
			threadMessage.inbox_message_id,
		);
		if (inboxChannel?.isSendable())
			inboxChannel.messages.delete(threadMessage.inbox_message_id);

		if (!quiet) {
			const deletionThreadMessage = new ThreadMessage({
				thread_id: this.id,
				message_type: ThreadMessageType.ReplyDeleted,
				user_name: "",
				body: "",
				is_anonymous: false,
			});

			deletionThreadMessage.metadata.originalThreadMessage = threadMessage;

			const threadNotification =
				formatters.formatStaffReplyDeletionNotificationThreadMessage(
					deletionThreadMessage,
				);
			const inboxMessage = await this._postToThreadChannel({
				content: threadNotification,
			});
			deletionThreadMessage.inbox_message_id = inboxMessage.id;

			await deletionThreadMessage.saveToDb(this.db);
		}

		await threadMessage.deleteFromDb(this.db);
	}

	async updateLogStorageValues(
		storageType: string,
		storageData:
			| {
					fullPath?: string;
					filename: string;
			  }
			| string,
	): Promise<void> {
		this.log_storage_type = storageType;
		this.log_storage_data = storageData;

		await this.db`UPDATE threads SET ${this.db({
			log_storage_type: storageType,
			log_storage_data: JSON.stringify(storageData),
		})} WHERE id = ${this.id}`;
	}
	//
	// /**
	//  * @param {string} key
	//  * @param {*} value
	//  * @return {Promise<void>}
	//  */
	// async setMetadataValue(key: string, value: any): Promise<void> {
	//   this.metadata = this.metadata || {};
	//   this.metadata[key] = value;
	//
	//   await knex("threads").where("id", this.id).update({
	//     metadata: this.getSQLProps().metadata,
	//   });
	// }
	//
	// /**
	//  * @param {string} key
	//  * @returns {*}
	//  */
	// getMetadataValue(key: string): any {
	//   return this.metadata ? this.metadata[key] : null;
	// }

	/**
	 * @returns {boolean}
	 */
	isOpen(): boolean {
		return this.status === ThreadStatus.Open;
	}

	isClosed() {
		return this.status === ThreadStatus.Closed;
	}

	/**
	 * Requests messages sent after last correspondence from Discord API to recover messages lost to downtime
	 */
	async recoverDowntimeMessages() {
		if (await isBlocked(this.user_id)) return;

		const user = await bot.users.fetch(this.user_id);
		const dmChannel = await user.createDM();
		if (!dmChannel) return;

		const lastMessageId = (await this.getLatestThreadMessage()).dm_message_id;

		const messages = await dmChannel.messages.fetch({
			limit: 50,
			after: lastMessageId,
		});

		if (!messages || messages.size === 0) return;

		messages
			.values()
			.toArray()
			.filter((msg) => msg.author.id === this.user_id); // Make sure we're not recovering bot or system messages

		await this.postSystemMessage(
			`📥 Recovering ${messages.size} message(s) sent by user during bot downtime!`,
		);

		let isFirst = true;
		for (const [_, msg] of messages.reverse()) {
			await this.receiveUserReply(msg, !isFirst);
			isFirst = false;
		}
	}

	public async getDMChannel(): Promise<DMChannel> {
		if (this.dm_channel_id) await bot.channels.fetch(this.dm_channel_id);

		const user = await bot.users.fetch(this.user_id);
		const dmChannel = await user.createDM();

		return dmChannel;
	}

	public async getThreadChannel(): Promise<SendableChannels> {
		const channel = await bot.channels.fetch(this.channel_id);

		if (channel?.isSendable()) return channel;

		throw "it was impossible to retrieve the thread channel";
	}
}

export default Thread;
