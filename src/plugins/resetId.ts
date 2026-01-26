import { findOpenThreadByChannelId, resetThreadId } from "../data/threads";
import type { ModuleProps } from "../plugins";
import { postLog } from "../utils";

export default ({ db, commands, config }: ModuleProps) => {
	commands.addGlobalCommand(
		"resetid",
		[
			{
				name: "id",
				type: "string",
				required: false,
			},
		],
		async (msg, args, _thread) => {
			const thread = await findOpenThreadByChannelId(db, msg.channelId);
			if (!thread && !args.id) {
				msg.reply(
					"You aren't in a thread and didn't specify an ID, so I don't know what to do next!",
				);
				return;
			}

			const fromId = thread ? thread.id : (args.id as string);
			const newId = await resetThreadId(db, fromId);

			const channel = thread ? await thread.getThreadChannel() : msg.channel;

			if (!channel.isSendable())
				return postLog(
					`We reset thread ${fromId} to ${newId}, but could not respond to the original message.`,
				);

			channel.send(`✓ Thread \`${fromId}\` is now \`${newId}\``);
			if (channel.id !== config.logChannelId)
				postLog(`Thread \`${fromId}\` is now \`${newId}\``);
		},
		{},
	);

	commands.addInboxThreadCommand(
		"id",
		[],
		async (_msg, _args, thread) => {
			if (!thread) return;
			thread.postSystemMessage(thread.user_id);
		},
		{ allowSuspended: true },
	);
};
