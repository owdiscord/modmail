import type { ModuleProps } from "../plugins";
import * as utils from "../utils";

export default ({ commands }: ModuleProps) => {
	commands.addInboxThreadCommand(
		"id",
		[],
		async (_msg, _args, thread) => {
			thread.postSystemMessage(thread.user_id);
		},
		{ allowSuspended: true },
	);

	commands.addInboxThreadCommand(
		"dm_channel_id",
		[],
		async (_msg, _args, thread) => {
			const dmChannel = await thread.getDMChannel();
			thread.postSystemMessage(dmChannel.id);
		},
		{ allowSuspended: true },
	);

	commands.addInboxThreadCommand(
		"message",
		"<messageNumber:number>",
		async (_msg, args, thread) => {
			const threadMessage = await thread.findThreadMessageByMessageNumber(
				args.messageNumber,
			);
			if (!threadMessage) {
				thread.postSystemMessage("No message in this thread with that number");
				return;
			}

			const channelId = threadMessage.dm_channel_id;

			// In specific rare cases, such as createThreadOnMention, a thread message may originate from a main server
			const channelIdServer = utils
				.getMainGuilds()
				.find((g) => g.channels.fetch(channelId));

			const messageLink = channelIdServer
				? `https://discord.com/channels/${channelIdServer.id}/${channelId}/${threadMessage.dm_message_id}`
				: `https://discord.com/channels/@me/${channelId}/${threadMessage.dm_message_id}`;

			const parts = [
				`Details for message \`${threadMessage.message_number}\`:`,
				`Channel ID: \`${channelId}\``,
				`Message ID: \`${threadMessage.dm_message_id}\``,
				`Link: <${messageLink}>`,
			];

			thread.postSystemMessage(parts.join("\n"));
		},
		{ allowSuspended: true },
	);
};
