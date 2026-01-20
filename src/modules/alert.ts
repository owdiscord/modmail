import type { Message } from "discord.js";
import type Thread from "../data/Thread";
import type { ModuleProps } from "../plugins";

export default ({ config, commands }: ModuleProps) => {
	commands.addInboxThreadCommand(
		"alert",
		"[opt:string]",
		async (msg: Message, args: { opt: string }, thread?: Thread) => {
			if (!thread) return;

			if (args.opt?.startsWith("c")) {
				await thread.removeAlert(msg.author.id);
				await thread.postSystemMessage(
					":red_circle: Cancelled new message alert",
				);
			} else {
				await thread.addAlert(msg.author.id);
				await thread.postSystemMessage(
					`:red_circle: Pinging ${msg.member?.nickname || config.useDisplaynames ? msg.author.globalName || msg.author.username : msg.author.username} when this thread gets a new reply`,
				);
			}
		},
		{ allowSuspended: true },
	);
};
